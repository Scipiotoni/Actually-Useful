'use strict';

// A second, independent account (AU_ALT_PASSWORD): signing in with its own
// password gives it its own pages, images and learning progress, and it can
// publish just like the main account — without either seeing the other's.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createApp } = require('../server/index.js');

const MAIN = 'the main password';
const ALT = 'a different code';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

async function withApp(options, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'au-accounts-'));
  const app = createApp({ dataDir: dir, password: MAIN, altPassword: ALT, ...options });
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  const at = `http://127.0.0.1:${app.address().port}`;
  try {
    await fn(at, dir, app);
  } finally {
    app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function signIn(at, password) {
  const res = await fetch(`${at}/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password }).toString(),
    redirect: 'manual'
  });
  const cookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [res.headers.get('set-cookie') || ''];
  const session = (cookies.find((c) => c.startsWith('au_session=')) || '').split(';')[0];
  const hint = cookies.find((c) => c.startsWith('au_account=')) || '';
  const call = (url, init = {}) => fetch(at + url, {
    ...init,
    redirect: 'manual',
    headers: { cookie: session, 'content-type': 'application/json', ...(init.headers || {}) }
  });
  return { res, session, hint, call };
}

const publish = (who, name, html) => who.call('/api/deploys', { method: 'POST', body: JSON.stringify({ name, html }) });

test('each password opens its own account', async () => {
  await withApp({}, async (at) => {
    const main = await signIn(at, MAIN);
    const alt = await signIn(at, ALT);
    const wrong = await signIn(at, 'nope');
    assert.strictEqual(main.res.status, 303);
    assert.strictEqual(alt.res.status, 303);
    assert.strictEqual(wrong.res.status, 401);
    assert.strictEqual((await (await main.call('/api/config')).json()).account, 'main');
    const config = await (await alt.call('/api/config')).json();
    assert.strictEqual(config.account, 'alt');
    assert.strictEqual(config.pages, '/a/');
    // The pages learn which account they are in, to keep its drafts apart.
    assert.match(alt.hint, /^au_account=alt;/);
    assert.doesNotMatch(alt.hint, /HttpOnly/);
    assert.match(main.hint, /^au_account=;.*Max-Age=0/);
  });
});

test('the two accounts publish independently, even under the same name', async () => {
  await withApp({}, async (at) => {
    const main = await signIn(at, MAIN);
    const alt = await signIn(at, ALT);
    const a = await (await publish(main, 'My Page', '<h1>Main account</h1>')).json();
    const b = await (await publish(alt, 'My Page', '<h1>Second account</h1>')).json();
    assert.strictEqual(a.slug, 'my-page');
    assert.strictEqual(b.slug, 'my-page');
    assert.strictEqual(a.url, `${at}/p/my-page/`);
    assert.strictEqual(b.url, `${at}/a/my-page/`);

    // Both are public, each at its own address.
    assert.match(await (await fetch(`${at}/p/my-page/`)).text(), /Main account/);
    assert.match(await (await fetch(`${at}/a/my-page/`)).text(), /Second account/);
    assert.strictEqual((await fetch(`${at}/a/my-page`, { redirect: 'manual' })).headers.get('location'), '/a/my-page/');

    // Each lists only its own.
    const mine = async (who) => (await (await who.call('/api/deploys')).json()).deploys.map((d) => d.url);
    assert.deepStrictEqual(await mine(main), [`${at}/p/my-page/`]);
    assert.deepStrictEqual(await mine(alt), [`${at}/a/my-page/`]);

    // Deleting in one leaves the other alone.
    assert.strictEqual((await alt.call('/api/deploys/my-page', { method: 'DELETE' })).status, 200);
    assert.strictEqual((await fetch(`${at}/a/my-page/`)).status, 404);
    assert.strictEqual((await fetch(`${at}/p/my-page/`)).status, 200);
    assert.strictEqual((await main.call('/api/deploys/zzz', { method: 'DELETE' })).status, 404);
  });
});

test('images and learning progress are kept apart too', async () => {
  await withApp({}, async (at) => {
    const main = await signIn(at, MAIN);
    const alt = await signIn(at, ALT);
    const up = await (await alt.call('/api/assets', { method: 'POST', body: JSON.stringify({ name: 'dot.png', data: PNG }) })).json();
    assert.strictEqual(up.path, '../assets/dot.png');
    assert.strictEqual((await fetch(`${at}/a/assets/dot.png`)).status, 200);
    assert.strictEqual((await fetch(`${at}/assets/dot.png`)).status, 404, 'not in the main account');
    assert.deepStrictEqual((await (await main.call('/api/assets')).json()).assets, []);

    const progress = { items: { 'html1-web': { status: 'done', xp: 20, at: new Date().toISOString() } } };
    await alt.call('/api/learn/progress', { method: 'PUT', body: JSON.stringify({ progress }) });
    const altRead = await (await alt.call('/api/learn/progress')).json();
    const mainRead = await (await main.call('/api/learn/progress')).json();
    assert.ok(altRead.progress.items['html1-web']);
    assert.deepStrictEqual(mainRead.progress.items, {});
  });
});

test('a session belongs to the account that signed in, and signing out ends it', async () => {
  await withApp({}, async (at) => {
    const alt = await signIn(at, ALT);
    const out = await alt.call('/logout');
    const cleared = typeof out.headers.getSetCookie === 'function' ? out.headers.getSetCookie() : [];
    assert.ok(cleared.some((c) => /^au_account=;.*Max-Age=0/.test(c)), 'the account hint is cleared');
    assert.strictEqual((await fetch(`${at}/api/deploys`, { headers: { cookie: 'au_session=forged.value' } })).status, 401);
  });
});

test('without a second password, /a/ addresses are not pages', async () => {
  await withApp({ altPassword: '' }, async (at, dir, app) => {
    assert.strictEqual(app.accounts.length, 1);
    assert.notStrictEqual((await fetch(`${at}/a/anything/`, { redirect: 'manual' })).status, 200);
    assert.strictEqual((await signIn(at, ALT)).res.status, 401);
  });
  // The same password twice, or a second one with no first, is ignored.
  await withApp({ altPassword: MAIN }, async (at, dir, app) => assert.strictEqual(app.accounts.length, 1));
  await withApp({ password: '', altPassword: ALT }, async (at, dir, app) => assert.strictEqual(app.accounts.length, 1));
});

test('the main account keeps its pages where they always were', async () => {
  await withApp({}, async (at, dir) => {
    const main = await signIn(at, MAIN);
    const alt = await signIn(at, ALT);
    await publish(main, 'Old', '<p>x</p>');
    await publish(alt, 'New', '<p>y</p>');
    assert.ok(fs.existsSync(path.join(dir, 'old', 'meta.json')), 'main pages stay at the top of the data folder');
    assert.ok(fs.existsSync(path.join(dir, '_alt', 'new', 'meta.json')), 'the second account has a folder of its own');
    assert.deepStrictEqual((await (await main.call('/api/deploys')).json()).deploys.map((d) => d.slug), ['old']);
  });
});
