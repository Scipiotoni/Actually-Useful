# Actually Useful

An HTML editor with a live preview and one-click page deploy. Write HTML, CSS
and JS in the browser, watch it render as you type, then publish it to a real
URL served by the app itself.

No build step, no npm dependencies — `node server/index.js` and you're editing.

![Editor with live preview](docs/screenshot.png)

## Run it

```bash
git clone https://github.com/Scipiotoni/Actually-Useful.git
cd Actually-Useful
npm start          # → http://127.0.0.1:3000
```

Requires Node.js 18 or newer. Nothing to install.

Then open **http://127.0.0.1:3000** in your browser — that is the editor. Pages
you deploy from it live at `http://127.0.0.1:3000/p/<name>`.

You *can* open `public/index.html` straight off disk and the editor and preview
will work, but **Deploy** needs the server running, so it is disabled in that
mode and the app tells you so.

## What it does

**Editor** — three panes (HTML / CSS / JS) with syntax highlighting, line
numbers, the active line marked, and a status bar showing where the caret is.
Native undo, selection and IME all still work, because the editor is a real
`<textarea>` with a highlighted layer painted underneath it.

**Find and replace** — `Ctrl+F` opens it, `Ctrl+H` starts on the replace field.
Every hit is highlighted at once with the current one picked out, `Enter` and
`Shift+Enter` step through them, `Aa` toggles case sensitivity, and *All*
replaces the lot. Whatever you had selected becomes the search term.

**Live preview** — renders into a sandboxed iframe, debounced while you type
(or on demand with Auto-run off). Resize the split, or preview at 1024 / 768 /
375 px to check a layout. `console.log` and uncaught errors from your page are
forwarded to a console panel.

**Deploy** — one click publishes the composed page to `/p/<slug>`, served live
by the same server. Deploying again to the same slug replaces it and bumps the
version; the URL never changes. The **Pages** drawer lists everything you have
deployed, and can reopen any of them back into the editor or delete them.

**Download** — saves the composed page as a standalone `.html` file with the
CSS and JS inlined.

Your draft is autosaved to `localStorage`, so a reload picks up where you left
off. The preview URL says whether what you see matches what is live
(`· live`) or whether you have `· unpublished changes`.

### Keyboard

The **Shortcuts** button in the status bar lists these in the app. `Ctrl` on
Windows and Linux, `Cmd` on a Mac.

| Shortcut | Action |
| --- | --- |
| `Tab` / `Shift`+`Tab` | Indent / outdent every line the selection touches |
| `Ctrl`+`/` | Comment or uncomment the lines, in the pane's language |
| `Alt`+`↑` / `Alt`+`↓` | Move the lines up or down |
| `Ctrl`+`D` | Duplicate the line, or the selection |
| `Ctrl`+`Shift`+`K` | Delete the line |
| `Home` | Jump to the first character, then to the margin |
| `Ctrl`+`F` / `Ctrl`+`H` | Find / find and replace |
| `Enter` / `Shift`+`Enter` | Next and previous result |
| `Ctrl`+`G` | Go to a line number |
| `Ctrl`+`Enter` | Render the preview now |
| `Ctrl`+`S` | Deploy |
| `Esc` | Close the find bar or any drawer |

Enter keeps the current indent, and adds a level inside a bracket or between a
tag pair. Brackets and quotes close themselves; typing the closer skips over it
instead of doubling it, and backspace between an empty pair removes both.

**Wrap** in the status bar turns on soft wrapping, which helps on a phone. The
line-number gutter is hidden while it is on, since wrapped lines and a 1:1
gutter cannot both be honest.

## How a page is composed

`public/compose.js` turns the three panes into one document, and it is the
*same* module the browser uses for the preview and the server uses for the
deploy — so what you preview is byte-for-byte what gets published.

If your HTML is a fragment, it is wrapped in a full document with the CSS in
`<head>` and the JS before `</body>`. If it is already a complete document
(it contains an `<html>` tag), your markup is left alone and the CSS and JS
are injected into it instead. That means you can paste an entire page in and
it will still work.

## HTTP API

The UI is just a client of this API.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/deploys` | List deployed pages, newest first (includes source) |
| `POST` | `/api/deploys` | Deploy. Body: `{name, slug?, html, css, js}` |
| `GET` | `/api/deploys/:slug` | Fetch one page and its source |
| `DELETE` | `/api/deploys/:slug` | Remove a deployed page |
| `GET` | `/p/:slug` | The deployed page itself |
| `GET` | `/api/assets` | List uploaded images |
| `POST` | `/api/assets` | Upload. Body: `{name, data}` where data is a data: URL |
| `DELETE` | `/api/assets/:name` | Remove an image |
| `GET` | `/assets/:name` | The image itself (public) |

Omit `slug` on `POST` to create a new page — the slug is derived from the name
and de-duplicated (`my-page`, `my-page-2`, …). Pass `slug` to overwrite that
page in place.

```bash
curl -X POST localhost:3000/api/deploys \
  -H 'content-type: application/json' \
  -d '{"name":"From curl","html":"<h1>hi</h1>","css":"h1{color:rebeccapurple}"}'
# {"slug":"from-curl", ... ,"url":"http://localhost:3000/p/from-curl"}
```

## Images

The **Images** drawer takes uploads by button or drag-and-drop and stores them
next to your pages. Each one reports a path like `../assets/my-photo.png`,
which you drop into an `<img src="...">` — *Insert* puts the whole tag in your
HTML for you.

That path is relative on purpose, because a published page is served from two
places and both have to work:

```
the app          /p/<slug>                     → ../assets/x.png = /assets/x.png
GitHub Pages     /published/<slug>/index.html  → ../assets/x.png = /published/assets/x.png
```

The live preview gets a matching `<base>`, so what you see while editing is what
the published page shows.

PNG, JPEG, GIF, WebP, AVIF and SVG are accepted, up to 5 MB each. Uploads are
identified by their actual bytes rather than by filename, so renaming something
to `.png` will not get it in. SVG is served with a `sandbox` CSP, since an SVG
can carry script and would otherwise run on the editor's own origin.

Images live in `published/assets/` in the repository (GitHub storage) or
`_assets/` beside the pages (disk storage), and they are public, like the pages
that embed them.

## Password protection

Set `AU_PASSWORD` and the editor asks for it:

```bash
AU_PASSWORD="something long and private" npm start
```

**Published pages stay public** — that is the point of publishing them. Only the
editor and the write API are locked, so you can share a `/p/<slug>` link with
anyone while nobody else can deploy, overwrite or delete your pages.

Signing in sets a signed, `HttpOnly`, 7-day cookie. Wrong guesses are throttled
per IP, with the lockout growing after five failures.

With no `AU_PASSWORD` set the app runs open, which is the sensible default on
`127.0.0.1`. Because that is *not* sensible on a public address, the server
**refuses to start** if `HOST` is non-loopback and no password is set. Override
with `AU_ALLOW_PUBLIC_WRITES=1` if you really mean it.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3000` | Port to listen on |
| `HOST` | `127.0.0.1` | Bind address — set to `0.0.0.0` to expose it |
| `AU_PASSWORD` | *(unset)* | Password for the editor. Unset means no login |
| `AU_DATA_DIR` | `./data/sites` | Where deployed pages are stored on disk |
| `AU_GITHUB_TOKEN` | *(unset)* | Fine-grained token; enables GitHub storage |
| `AU_GITHUB_REPO` | *(unset)* | `owner/repo` to store published pages in |
| `AU_GITHUB_BRANCH` | *(repo default)* | Branch to commit pages to |
| `AU_ALLOW_PUBLIC_WRITES` | *(unset)* | Permit a public bind with no password |

## Open it on your phone

On the same Wi-Fi, bind to every interface and set a password (the server
refuses a non-loopback bind without one):

```bash
AU_PASSWORD="a password" HOST=0.0.0.0 npm start
```

It prints the address to type on the other device:

```
Actually Useful is running. Open one of these:
  On this computer   http://127.0.0.1:3000
  On the same Wi-Fi  http://192.168.1.42:3000
```

Both devices must be on the same network, and your firewall has to allow the
port. This does not reach beyond the local network — for that, publish it.

## Never lose a published page

By default pages are written to `data/sites/` on local disk. On a host with an
ephemeral filesystem — Render's free plan among them — that disk is wiped on
every restart, taking the published pages with it.

Point the app at a GitHub repository instead and they stop being erasable:

```bash
AU_GITHUB_TOKEN="github_pat_..." AU_GITHUB_REPO="owner/repo" npm start
```

Each publish becomes one commit writing three files:

```
published/index.json          the list of pages
published/<slug>/page.json    metadata and the three editor panes
published/<slug>/index.html   the composed page
```

So you also get a full history: every version of every page is a commit you can
read or restore. Everything is cached in memory after the first read, so serving
a page costs no API calls.

Turn on **GitHub Pages** for the repository and those pages are served straight
from GitHub, permanently and without a cold start, at
`https://<owner>.github.io/<repo>/published/<slug>/`. The app reports that
address as `permanentUrl` and the editor links to it. GitHub Pages rebuilds
[about ten times an hour](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits),
so publishing in a tight loop makes the last few appear late — nothing is lost.

The token should be a **fine-grained** personal access token, scoped to that one
repository, with **Contents: read and write** and nothing else. Note that pages
published this way are stored in the repository, so on a public repo they are
publicly readable — which is what publishing means, but worth knowing.

## Put it on the internet

`render.yaml` is a ready Render Blueprint: **New → Blueprint**, point it at this
repository, set `AU_PASSWORD` when prompted.

**Know this before you rely on it.** Render's free plan gives every service an
[ephemeral filesystem](https://render.com/docs/disks) and
[spins it down after 15 minutes without traffic](https://render.com/docs/free).
Deployed pages live on that filesystem, so **they are erased on every spin-down
and redeploy**. Your editor draft is kept in the browser, so nothing you were
writing is lost — but the published URLs go 404 until you press Deploy again.

To keep pages permanently you need a paid instance type with a persistent disk
(disks cannot be attached to free services). `render.yaml` has the lines to
uncomment.

Any host that runs Node works the same way: it needs `HOST=0.0.0.0`, whatever
`PORT` the platform provides, and `AU_PASSWORD`.

Each deploy is a directory holding the rendered `index.html` and a `meta.json`
with the original panes, so nothing is locked inside the app.

## Tests

```bash
npm test
```

Covers deploy/redeploy/versioning, slug collisions, listing and deletion, path
traversal (including percent-encoded attempts) and payload limits, the password
gate, image upload and serving, GitHub storage against a stand-in API, the
compose rules (fragment wrapping, full-document injection, `</script>`
escaping), and every editing command — indent, comment, move, duplicate,
delete and find — as pure functions over text and a selection, so their edge
cases (blank lines, the last line, no trailing newline) are pinned down without
needing a browser.

## Security notes

The default bind address is loopback, and this is built as a local tool for
pages you write yourself. Two things to know before exposing it:

- **The API is unauthenticated.** Anyone who can reach the port can deploy,
  overwrite or delete pages. Put it behind a reverse proxy with auth if it
  needs to be public.
- **Deployed pages run on the app's own origin.** A page you deploy can script
  against `/api/deploys`. Only deploy code you trust — which, since you wrote
  it in the editor, is normally the point.

Slugs are validated against `^[a-z0-9][a-z0-9-]{0,59}$` and resolved paths are
checked against the data root, so a slug cannot escape it. Request bodies are
capped at 8 MB and each pane at 2 MB.

## Layout

```
server/index.js    HTTP server: static files, JSON API, /p/<slug> hosting
server/store.js    File-backed deploy storage, slugging and validation
server/github-store.js  The same, backed by commits to a GitHub repository
server/auth.js     Optional password gate: cookies, throttling, login page
server/assets.js   Image validation: format sniffing, naming, size limits
public/compose.js  Panes → one HTML document (shared by client and server)
public/editor.js   MiniEditor: highlighting, find, and the editing commands
public/app.js      Editor wiring: tabs, preview, console, deploy, drawer
public/styles.css  Everything visual
test/api.test.js   node:test suite over the API, auth and compose rules
test/editor.test.js        The editor's text operations, as pure functions
test/github-store.test.js  GitHub storage, against a stand-in GitHub API
```

## License

MIT
