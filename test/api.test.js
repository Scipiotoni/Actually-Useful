'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createApp } = require('../server/index.js');
const { compose, slugify } = require('../public/compose.js');
const { DeployStore } = require('../server/store.js');

let server;
let base;
let dataDir;

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'au-test-'));
  server = createApp({ dataDir });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const post = (body) =>
  fetch(`${base}/api/deploys`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });

test('serves the editor at /', async () => {
  const res = await fetch(base);
  assert.strictEqual(res.status, 200);
  assert.match(await res.text(), /Actually Useful/);
});

test('deploys a page and serves it at its slug', async () => {
  const res = await post({ name: 'My Test Page', html: '<h1>hi</h1>', css: 'h1{color:red}', js: 'console.log(1)' });
  assert.strictEqual(res.status, 201);
  const site = await res.json();
  assert.strictEqual(site.slug, 'my-test-page');
  assert.strictEqual(site.version, 1);
  assert.strictEqual(site.url, `${base}/p/my-test-page/`);
  assert.deepStrictEqual(site.files, ['index.html', 'styles.css', 'app.js']);

  const page = await fetch(site.url);
  assert.strictEqual(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);
  const html = await page.text();
  assert.match(html, /<h1>hi<\/h1>/);
  assert.match(html, /<title>My Test Page<\/title>/);

  // The stylesheet and script are siblings the page links to, not inlined.
  assert.match(html, /href="styles\.css"/);
  assert.match(html, /src="app\.js"/);

  const sheet = await fetch(`${base}/p/my-test-page/styles.css`);
  assert.strictEqual(sheet.status, 200);
  assert.match(sheet.headers.get('content-type'), /text\/css/);
  assert.strictEqual(await sheet.text(), 'h1{color:red}');

  const script = await fetch(`${base}/p/my-test-page/app.js`);
  assert.match(script.headers.get('content-type'), /javascript/);
  assert.strictEqual(await script.text(), 'console.log(1)');
});

test('the slug without a trailing slash redirects, so siblings resolve', async () => {
  await post({ name: 'Redirects', html: '<p>x</p>', css: 'p{}' });
  const res = await fetch(`${base}/p/redirects`, { redirect: 'manual' });
  assert.strictEqual(res.status, 302);
  assert.strictEqual(res.headers.get('location'), '/p/redirects/');

  // Without the redirect, "styles.css" in the page would resolve to /p/styles.css.
  assert.strictEqual(new URL('styles.css', `${base}/p/redirects/`).pathname, '/p/redirects/styles.css');
});

test('redeploying the same slug bumps the version instead of forking', async () => {
  const first = await (await post({ name: 'Versioned', html: '<p>v1</p>' })).json();
  const second = await (await post({ name: 'Versioned', slug: first.slug, html: '<p>v2</p>' })).json();

  assert.strictEqual(second.slug, first.slug);
  assert.strictEqual(second.version, 2);
  assert.strictEqual(second.createdAt, first.createdAt);
  assert.match(await (await fetch(second.url)).text(), /<p>v2<\/p>/);
});

test('a new deploy with a taken name gets a distinct slug', async () => {
  const a = await (await post({ name: 'Collide', html: '<p>a</p>' })).json();
  const b = await (await post({ name: 'Collide', html: '<p>b</p>' })).json();
  assert.strictEqual(a.slug, 'collide');
  assert.strictEqual(b.slug, 'collide-2');
});

test('lists deploys newest first and can delete one', async () => {
  await post({ name: 'Listed Page', html: '<p>x</p>' });
  const { deploys } = await (await fetch(`${base}/api/deploys`)).json();
  assert.ok(deploys.length >= 1);
  assert.strictEqual(deploys[0].slug, 'listed-page');
  assert.ok(deploys[0].source.some((file) => file.content.includes('<p>x</p>')));

  const del = await fetch(`${base}/api/deploys/listed-page`, { method: 'DELETE' });
  assert.strictEqual(del.status, 200);
  assert.strictEqual((await fetch(`${base}/p/listed-page`)).status, 404);
  assert.strictEqual((await fetch(`${base}/api/deploys/listed-page`, { method: 'DELETE' })).status, 404);
});

test('rejects path traversal in slugs', async () => {
  const before = fs.readdirSync(dataDir).sort();

  for (const slug of ['../../etc', '..', 'a/b', '.hidden', 'UPPER']) {
    const res = await post({ name: 'Escape', slug, html: '<p>no</p>' });
    assert.strictEqual(res.status, 400, `slug ${slug} should be rejected`);
  }

  // Denied either as an unknown page or by the static guard; both are fine.
  assert.ok([403, 404].includes((await fetch(`${base}/p/..%2F..%2Fetc`)).status));
  assert.deepStrictEqual(fs.readdirSync(dataDir).sort(), before, 'no directory was created');

  const store = new DeployStore(dataDir);
  assert.strictEqual(store.dirFor('../escape'), null);
  assert.strictEqual(store.dirFor('a/b'), null);
  assert.strictEqual(store.dirFor('ok-slug'), path.join(dataDir, 'ok-slug'));
});

test('rejects oversized sources and non-string panes', async () => {
  assert.strictEqual((await post({ name: 'Huge', html: 'x'.repeat(2 * 1024 * 1024 + 1) })).status, 413);
  assert.strictEqual((await post({ name: 'Wrong', html: { nope: true } })).status, 400);
});

test('static files are not readable outside public/', async () => {
  const res = await fetch(`${base}/../server/store.js`);
  assert.ok(res.status === 403 || res.status === 404);
});

test('percent-encoded traversal cannot escape public/', async () => {
  // fetch() normalises a literal "../", so the encoded forms are the ones
  // that actually reach the server — and the ones that used to get through.
  const attempts = [
    '/assets/..%2F..%2Fpackage.json',
    '/..%2Fserver%2Fauth.js',
    '/..%2F..%2F..%2Fetc%2Fpasswd',
    '/%2e%2e%2fserver%2findex.js',
    '/public%2F..%2F..%2FREADME.md',
    '/..%2fdata'
  ];

  for (const attempt of attempts) {
    const res = await fetch(`${base}${attempt}`);
    assert.ok(res.status === 403 || res.status === 404, `${attempt} returned ${res.status}`);
    const body = await res.text();
    assert.ok(!body.includes('actually-useful'), `${attempt} leaked package.json`);
    assert.ok(!body.includes('use strict'), `${attempt} leaked server source`);
  }
});

test('the editor\'s own assets still load', async () => {
  for (const file of ['/', '/app.js', '/styles.css', '/editor.js', '/compose.js']) {
    assert.strictEqual((await fetch(`${base}${file}`)).status, 200, `${file} should be served`);
  }
});

test('compose wraps fragments and injects into full documents', () => {
  const wrapped = compose({ html: '<p>hi</p>', css: 'p{color:red}', js: 'var a=1', title: 'T' });
  assert.match(wrapped, /^<!doctype html>/);
  assert.match(wrapped, /<title>T<\/title>/);

  const full = compose({
    html: '<!doctype html><html><head><title>Mine</title></head><body><p>x</p></body></html>',
    css: 'p{color:blue}',
    js: 'var b=2'
  });
  assert.strictEqual(full.match(/<html/g).length, 1);
  assert.match(full, /<title>Mine<\/title>/);
  assert.ok(full.indexOf('color:blue') < full.indexOf('</head>'));
  assert.ok(full.indexOf('var b=2') < full.indexOf('</body>'));
});

test('compose escapes a closing script tag inside user JS', () => {
  const out = compose({ html: '', js: 'var s = "</script>";' });
  assert.ok(!out.includes('"</script>";'));
  assert.match(out, /<\\\/script>/);
});

test('slugify falls back to a usable slug', () => {
  assert.strictEqual(slugify('  Héllo Wörld!! '), 'hello-world');
  assert.strictEqual(slugify('***'), 'page');
  assert.strictEqual(slugify(''), 'page');
});

// --------------------------------------------------------------------------
// Password protection (AU_PASSWORD). Published pages must stay public.
// --------------------------------------------------------------------------

const PASSWORD = 'correct horse battery staple';

async function withLockedApp(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'au-auth-'));
  const app = createApp({ dataDir: dir, password: PASSWORD });
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  const at = `http://127.0.0.1:${app.address().port}`;
  try {
    await fn(at);
  } finally {
    app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const signIn = async (at, password = PASSWORD) => {
  const res = await fetch(`${at}/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password }).toString(),
    redirect: 'manual'
  });
  return { res, cookie: (res.headers.get('set-cookie') || '').split(';')[0] };
};

test('with a password set, the editor and API are closed', async () => {
  await withLockedApp(async (at) => {
    const editor = await fetch(at, { redirect: 'manual' });
    assert.strictEqual(editor.status, 302);
    assert.match(editor.headers.get('location'), /^\/login/);

    const list = await fetch(`${at}/api/deploys`);
    assert.strictEqual(list.status, 401);

    const write = await fetch(`${at}/api/deploys`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Sneaky', html: '<p>x</p>' })
    });
    assert.strictEqual(write.status, 401);

    assert.strictEqual((await fetch(`${at}/login`)).status, 200);
  });
});

test('the right password opens it, the wrong one does not', async () => {
  await withLockedApp(async (at) => {
    const bad = await signIn(at, 'guess');
    assert.strictEqual(bad.res.status, 401);
    assert.ok(!bad.res.headers.get('set-cookie'));

    const good = await signIn(at);
    assert.strictEqual(good.res.status, 303);
    assert.match(good.cookie, /^au_session=/);
    const setCookie = good.res.headers.get('set-cookie');
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Lax/);

    const list = await fetch(`${at}/api/deploys`, { headers: { cookie: good.cookie } });
    assert.strictEqual(list.status, 200);

    const config = await (await fetch(`${at}/api/config`, { headers: { cookie: good.cookie } })).json();
    assert.strictEqual(config.auth, true);
  });
});

test('a forged or tampered cookie is rejected', async () => {
  await withLockedApp(async (at) => {
    for (const cookie of ['au_session=nonsense', `au_session=${Date.now() + 9e6}.deadbeef`]) {
      const res = await fetch(`${at}/api/deploys`, { headers: { cookie } });
      assert.strictEqual(res.status, 401, `cookie "${cookie}" must be rejected`);
    }
  });
});

test('published pages stay readable without signing in', async () => {
  await withLockedApp(async (at) => {
    const { cookie } = await signIn(at);
    const site = await (await fetch(`${at}/api/deploys`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'Public Page', html: '<h1>shared</h1>' })
    })).json();

    const anonymous = await fetch(`${at}/p/${site.slug}`);
    assert.strictEqual(anonymous.status, 200);
    assert.match(await anonymous.text(), /<h1>shared<\/h1>/);
  });
});

test('repeated wrong guesses get throttled', async () => {
  await withLockedApp(async (at) => {
    let last;
    for (let i = 0; i < 6; i += 1) last = (await signIn(at, 'wrong')).res;
    assert.strictEqual(last.status, 429);
    // The lockout applies to the right password too, so guessing cannot be raced.
    assert.strictEqual((await signIn(at)).res.status, 429);
  });
});

test('signing out clears the cookie', async () => {
  await withLockedApp(async (at) => {
    const { cookie } = await signIn(at);
    const res = await fetch(`${at}/logout`, { headers: { cookie }, redirect: 'manual' });
    assert.strictEqual(res.status, 303);
    assert.match(res.headers.get('set-cookie'), /au_session=;/);
    assert.match(res.headers.get('set-cookie'), /Max-Age=0/);
  });
});

test('without a password the login page just redirects home', async () => {
  const res = await fetch(`${base}/login`, { redirect: 'manual' });
  assert.strictEqual(res.status, 302);
  assert.strictEqual(res.headers.get('location'), '/');
  assert.strictEqual((await (await fetch(`${base}/api/config`)).json()).auth, false);
});

test('behind an HTTPS proxy the session cookie is marked Secure', async () => {
  await withLockedApp(async (at) => {
    const plain = await fetch(`${at}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ password: PASSWORD }).toString(),
      redirect: 'manual'
    });
    assert.ok(!/Secure/.test(plain.headers.get('set-cookie')), 'plain http must not claim Secure');

    // Render and friends terminate TLS and forward this header.
    const proxied = await fetch(`${at}/login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-forwarded-proto': 'https'
      },
      body: new URLSearchParams({ password: PASSWORD }).toString(),
      redirect: 'manual'
    });
    assert.match(proxied.headers.get('set-cookie'), /Secure/);
  });
});

// --------------------------------------------------------------------------
// Uploaded images
// --------------------------------------------------------------------------

const PIXEL = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('not a real image body, but the signature is what counts')
]);

const upload = (name, buffer = PIXEL, mime = 'image/png') =>
  fetch(`${base}/api/assets`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, data: `data:${mime};base64,${buffer.toString('base64')}` })
  });

test('an uploaded image is stored and served back byte for byte', async () => {
  const res = await upload('Mi Foto.png');
  assert.strictEqual(res.status, 201);
  const asset = await res.json();
  assert.strictEqual(asset.name, 'mi-foto.png');
  assert.strictEqual(asset.path, '../assets/mi-foto.png');

  const served = await fetch(`${base}/assets/mi-foto.png`);
  assert.strictEqual(served.status, 200);
  assert.strictEqual(served.headers.get('content-type'), 'image/png');
  assert.strictEqual(served.headers.get('x-content-type-options'), 'nosniff');
  assert.ok(Buffer.from(await served.arrayBuffer()).equals(PIXEL));
});

test('the path an image reports resolves from a published page', async () => {
  await upload('enlace.png');
  const site = await (await fetch(`${base}/api/deploys`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Usa Imagen', html: '<img src="../assets/enlace.png">' })
  })).json();

  // "../assets/x" from /p/<slug> is /assets/x, which the server serves.
  const resolved = new URL('../assets/enlace.png', `${base}/p/${site.slug}`);
  assert.strictEqual(resolved.pathname, '/assets/enlace.png');
  assert.strictEqual((await fetch(resolved)).status, 200);
});

test('an SVG is served with a sandbox so it cannot script the editor', async () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  const asset = await (await upload('icono.svg', svg, 'image/svg+xml')).json();
  const served = await fetch(`${base}/assets/${asset.name}`);
  assert.strictEqual(served.headers.get('content-type'), 'image/svg+xml');
  assert.strictEqual(served.headers.get('content-security-policy'), 'sandbox');
});

test('non-images and oversized uploads are refused', async () => {
  const notAnImage = await upload('trampa.png', Buffer.from('MZ definitely an executable'));
  assert.strictEqual(notAnImage.status, 415);

  const huge = await upload('enorme.png', Buffer.concat([PIXEL, Buffer.alloc(5 * 1024 * 1024)]));
  assert.strictEqual(huge.status, 413);

  assert.strictEqual((await fetch(`${base}/api/assets`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'x.png', data: 'not-a-data-url' })
  })).status, 400);
});

test('images are listed and can be deleted', async () => {
  await upload('listada.png');
  const { assets } = await (await fetch(`${base}/api/assets`)).json();
  assert.ok(assets.some((a) => a.name === 'listada.png'));

  assert.strictEqual((await fetch(`${base}/api/assets/listada.png`, { method: 'DELETE' })).status, 200);
  assert.strictEqual((await fetch(`${base}/assets/listada.png`)).status, 404);
  assert.strictEqual((await fetch(`${base}/api/assets/listada.png`, { method: 'DELETE' })).status, 404);
});

test('image names cannot escape the assets directory', async () => {
  for (const name of ['..%2F..%2Fpackage.json', '.hidden', 'UPPER.png']) {
    const res = await fetch(`${base}/assets/${name}`);
    assert.ok([403, 404].includes(res.status), `${name} returned ${res.status}`);
  }
});


// --------------------------------------------------------------------------
// Projects with more than one file
// --------------------------------------------------------------------------

const SITE = [
  { name: 'index.html', content: '<h1>Home</h1><a href="about.html">About</a>' },
  { name: 'about.html', content: '<h1>About</h1><a href="index.html">Home</a>' },
  { name: 'styles.css', content: 'h1 { color: rebeccapurple }' },
  { name: 'app.js', content: 'console.log("hi")' }
];

test('a project can publish several pages, each at its own address', async () => {
  const site = await (await post({ name: 'Mini Site', files: SITE })).json();
  assert.deepStrictEqual(site.files, ['index.html', 'about.html', 'styles.css', 'app.js']);
  assert.strictEqual(site.entry, 'index.html');

  const home = await fetch(`${base}/p/mini-site/`);
  assert.match(await home.text(), /<h1>Home<\/h1>/);

  const about = await fetch(`${base}/p/mini-site/about.html`);
  assert.strictEqual(about.status, 200);
  assert.match(await about.text(), /<h1>About<\/h1>/);

  // A link written as a plain file name resolves to its sibling.
  assert.strictEqual(
    new URL('about.html', `${base}/p/mini-site/`).toString(),
    `${base}/p/mini-site/about.html`
  );
});

test('every page in a project links the project stylesheets and scripts', async () => {
  await post({ name: 'Linked', files: SITE });
  for (const page of ['', 'about.html']) {
    const html = await (await fetch(`${base}/p/linked/${page}`)).text();
    assert.match(html, /href="styles\.css"/, `${page || 'index.html'} should link the stylesheet`);
    assert.match(html, /src="app\.js"/, `${page || 'index.html'} should link the script`);
  }
});

test('a full HTML document is published as written, with no tags added', async () => {
  const mine = '<!doctype html><html><head><title>Mine</title></head><body><p>as written</p></body></html>';
  await post({
    name: 'Full Doc',
    files: [{ name: 'index.html', content: mine }, { name: 'styles.css', content: 'p{}' }]
  });
  const html = await (await fetch(`${base}/p/full-doc/`)).text();
  assert.strictEqual(html, mine);
  assert.ok(!html.includes('href="styles.css"'), 'a full document controls its own links');
});

test('renaming a file removes the old one from the deploy', async () => {
  await post({ name: 'Renamed', files: [
    { name: 'index.html', content: '<p>x</p>' },
    { name: 'old.html', content: '<p>old</p>' }
  ] });
  assert.strictEqual((await fetch(`${base}/p/renamed/old.html`)).status, 200);

  await post({ name: 'Renamed', slug: 'renamed', files: [
    { name: 'index.html', content: '<p>x</p>' },
    { name: 'new.html', content: '<p>new</p>' }
  ] });
  assert.strictEqual((await fetch(`${base}/p/renamed/new.html`)).status, 200);
  assert.strictEqual((await fetch(`${base}/p/renamed/old.html`)).status, 404, 'the old file must be gone');
});

test('an image path resolves the same from a page as it does on GitHub Pages', async () => {
  await upload('compartida.png');
  await post({ name: 'Con Imagen', files: [
    { name: 'index.html', content: '<img src="../assets/compartida.png">' }
  ] });

  // /p/<slug>/ + ../assets/x mirrors /published/<slug>/ + ../assets/x
  const resolved = new URL('../assets/compartida.png', `${base}/p/con-imagen/`);
  assert.strictEqual(resolved.pathname, '/p/assets/compartida.png');
  assert.strictEqual((await fetch(resolved)).status, 200);
});

test('bad file names and duplicates are refused', async () => {
  const cases = [
    [[{ name: '../escape.html', content: '' }], 'a path'],
    [[{ name: 'no-extension', content: '' }], 'no extension'],
    [[{ name: 'thing.php', content: '' }], 'an unsupported type'],
    [[{ name: 'a.html', content: '' }, { name: 'a.html', content: '' }], 'a duplicate'],
    [[{ name: 'styles.css', content: 'p{}' }], 'no HTML file at all']
  ];
  for (const [files, why] of cases) {
    const res = await post({ name: 'Bad', files });
    assert.strictEqual(res.status, 400, `should reject ${why}`);
  }

  const tooMany = Array.from({ length: 61 }, (_, i) => ({ name: `p${i}.html`, content: '' }));
  assert.strictEqual((await post({ name: 'Many', files: tooMany })).status, 413);

  // A project with icons and fonts needs room, so 60 is fine.
  const plenty = Array.from({ length: 60 }, (_, i) => ({ name: `p${i}.html`, content: '' }));
  assert.strictEqual((await post({ name: 'Plenty', files: plenty })).status, 201);
});

test('a project published before multi-file still loads and serves', async () => {
  const legacy = await (await post({ name: 'Legacy', html: '<p>old</p>', css: 'p{color:red}' })).json();
  assert.deepStrictEqual(legacy.files, ['index.html', 'styles.css']);

  const fetched = await (await fetch(`${base}/api/deploys/${legacy.slug}`)).json();
  assert.ok(Array.isArray(fetched.source));
  assert.strictEqual(fetched.source[0].name, 'index.html');
  assert.match(await (await fetch(`${base}/p/${legacy.slug}/`)).text(), /<p>old<\/p>/);
});

// --------------------------------------------------------------------------
// Binaries, folders, and a project that is a real PWA
// --------------------------------------------------------------------------

const ICON = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('icon bytes')
]);

const PWA = [
  {
    name: 'index.html',
    content: '<!doctype html><html><head><link rel="manifest" href="manifest.json">' +
      '</head><body><h1>App</h1><script src="sw-register.js"></script></body></html>'
  },
  { name: 'sw.js', content: "self.addEventListener('fetch', function () {});" },
  { name: 'sw-register.js', content: "navigator.serviceWorker.register('sw.js');" },
  { name: 'manifest.json', content: '{"name":"App","start_url":".","icons":[{"src":"icons/icon-192.png"}]}' },
  { name: 'icons/icon-192.png', content: ICON.toString('base64') },
  { name: 'notes.md', content: '# Notes' }
];

test('a PWA deploys with every file at the path shown in the panel', async () => {
  const site = await (await post({ name: 'My App', files: PWA })).json();
  assert.deepStrictEqual(site.files, PWA.map((file) => file.name));

  // The service worker has to sit beside index.html, or its scope is wrong.
  const worker = await fetch(`${base}/p/my-app/sw.js`);
  assert.strictEqual(worker.status, 200);
  assert.match(worker.headers.get('content-type'), /javascript/);
  assert.match(await worker.text(), /addEventListener/);

  const manifest = await fetch(`${base}/p/my-app/manifest.json`);
  assert.match(manifest.headers.get('content-type'), /application\/json/);
  assert.deepStrictEqual((await manifest.json()).name, 'App');

  const markdown = await fetch(`${base}/p/my-app/notes.md`);
  assert.match(markdown.headers.get('content-type'), /text\/markdown/);
  assert.strictEqual(await markdown.text(), '# Notes');
});

test('a binary file survives the round trip byte for byte', async () => {
  await post({ name: 'With Icon', files: PWA });
  const icon = await fetch(`${base}/p/with-icon/icons/icon-192.png`);
  assert.strictEqual(icon.status, 200);
  assert.strictEqual(icon.headers.get('content-type'), 'image/png');
  assert.ok(Buffer.from(await icon.arrayBuffer()).equals(ICON), 'the bytes must come back unchanged');
});

test('a full HTML document keeps its own manifest and script tags', async () => {
  await post({ name: 'Untouched', files: PWA });
  const html = await (await fetch(`${base}/p/untouched/`)).text();
  assert.match(html, /rel="manifest" href="manifest\.json"/);
  // Nothing auto-linked into a complete document.
  assert.ok(!html.includes('<link rel="stylesheet"'));
});

test('a file path cannot climb out of the project', async () => {
  for (const name of ['../escape.html', 'icons/../../escape.png', '/abs.html', 'a//b.png']) {
    const res = await post({ name: 'Escape', files: [{ name: 'index.html', content: '' }, { name, content: '' }] });
    assert.strictEqual(res.status, 400, `${name} must be refused`);
  }
});

test('a binary file that is not really base64 is refused', async () => {
  const res = await post({
    name: 'Broken',
    files: [{ name: 'index.html', content: '' }, { name: 'logo.png', content: '!!!not base64!!!' }]
  });
  assert.strictEqual(res.status, 400);
});
