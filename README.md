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

## What it does

**Editor** — three panes (HTML / CSS / JS) with syntax highlighting, line
numbers, auto-indent, bracket and tag closing, and block indent/outdent with
Tab. Native undo, selection and IME still work, because the editor is a real
`<textarea>` with a highlighted layer painted underneath it.

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

| Shortcut | Action |
| --- | --- |
| `Ctrl`/`Cmd` + `Enter` | Render the preview |
| `Ctrl`/`Cmd` + `S` | Deploy |
| `Tab` / `Shift`+`Tab` | Indent / outdent the selection |
| `Esc` | Close the Pages drawer |

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

Omit `slug` on `POST` to create a new page — the slug is derived from the name
and de-duplicated (`my-page`, `my-page-2`, …). Pass `slug` to overwrite that
page in place.

```bash
curl -X POST localhost:3000/api/deploys \
  -H 'content-type: application/json' \
  -d '{"name":"From curl","html":"<h1>hi</h1>","css":"h1{color:rebeccapurple}"}'
# {"slug":"from-curl", ... ,"url":"http://localhost:3000/p/from-curl"}
```

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3000` | Port to listen on |
| `HOST` | `127.0.0.1` | Bind address — set to `0.0.0.0` to expose it |
| `AU_DATA_DIR` | `./data/sites` | Where deployed pages are stored |

Each deploy is a directory holding the rendered `index.html` and a `meta.json`
with the original panes, so nothing is locked inside the app.

## Tests

```bash
npm test
```

Covers deploy/redeploy/versioning, slug collisions, listing and deletion, path
traversal and payload limits, and the compose rules (fragment wrapping,
full-document injection, `</script>` escaping).

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
public/compose.js  Panes → one HTML document (shared by client and server)
public/editor.js   MiniEditor: the dependency-free highlighting editor
public/app.js      Editor wiring: tabs, preview, console, deploy, drawer
public/styles.css  Everything visual
test/api.test.js   node:test suite over the API and compose rules
```

## License

MIT
