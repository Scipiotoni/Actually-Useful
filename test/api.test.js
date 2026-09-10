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
  assert.strictEqual(site.url, `${base}/p/my-test-page`);

  const page = await fetch(site.url);
  assert.strictEqual(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);
  const html = await page.text();
  assert.match(html, /<h1>hi<\/h1>/);
  assert.match(html, /color:red/);
  assert.match(html, /console\.log\(1\)/);
  assert.match(html, /<title>My Test Page<\/title>/);
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
  assert.ok(deploys[0].source.html.includes('<p>x</p>'));

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

  assert.strictEqual((await fetch(`${base}/p/..%2F..%2Fetc`)).status, 404);
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
