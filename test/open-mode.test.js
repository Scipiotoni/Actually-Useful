'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createApp } = require('../server/index.js');
const Backup = require('../public/backup.js');
const Engine = require('../public/learn/engine.js');

let server;
let base;
let dataDir;
const godboltCalls = [];

// Compiler Explorer's reply, simulated: the open version must not run code locally.
const fakeGodbolt = async (url, init) => {
  godboltCalls.push(url);
  const body = JSON.parse(init.body);
  return {
    ok: true,
    status: 200,
    json: async () => ({
      code: 0,
      didExecute: true,
      buildResult: { code: 0, stdout: [], stderr: [] },
      stdout: [{ text: `ran with ${body.options.executeParameters.stdin}` }],
      stderr: []
    })
  };
};

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'au-open-'));
  server = createApp({
    dataDir,
    open: true,
    password: 'this is ignored in the open version',
    githubToken: 'ignored-too',
    githubRepo: 'someone/somewhere',
    openRunLimit: 3,
    cpp: { fetchImpl: fakeGodbolt }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const send = (method, url, body) => fetch(base + url, {
  method,
  headers: { 'content-type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body)
});

test('the open version needs no password and says it is open', async () => {
  const page = await fetch(base + '/', { redirect: 'manual' });
  assert.strictEqual(page.status, 200, 'no login redirect');
  const config = await (await fetch(`${base}/api/config`)).json();
  assert.deepStrictEqual(config, { auth: false, open: true, storage: 'none', account: 'main', pages: '/p/' });
  assert.strictEqual((await fetch(`${base}/learn/`)).status, 200);
});

test('publishing, deleting and uploading are refused', async () => {
  const files = [{ name: 'index.html', content: '<h1>hi</h1>' }];
  const cases = [
    ['POST', '/api/deploys', { name: 'Nope', files }],
    ['DELETE', '/api/deploys/anything'],
    ['POST', '/api/assets', { name: 'a.png', data: 'data:image/png;base64,AAAA' }],
    ['DELETE', '/api/assets/a.png'],
    ['PUT', '/api/learn/progress', { progress: Engine.emptyProgress() }]
  ];
  for (const [method, url, body] of cases) {
    const res = await send(method, url, body);
    assert.strictEqual(res.status, 403, `${method} ${url}`);
    assert.match((await res.json()).error, /open version/);
  }
  const saved = fs.readdirSync(dataDir, { recursive: true }).filter((f) => !String(f).startsWith('.') && f !== '_assets');
  assert.deepStrictEqual(saved, [], 'nothing was written');
});

test('lists are empty and progress is left to the browser', async () => {
  assert.deepStrictEqual(await (await fetch(`${base}/api/deploys`)).json(), { deploys: [] });
  assert.deepStrictEqual(await (await fetch(`${base}/api/assets`)).json(), { assets: [] });
  const progress = await (await fetch(`${base}/api/learn/progress`)).json();
  assert.strictEqual(progress.storage, 'local');
  assert.deepStrictEqual(progress.progress.items, {});
});

test('C++ runs on Compiler Explorer, with a per-visitor limit', async () => {
  const status = await (await fetch(`${base}/api/cpp/status`)).json();
  assert.strictEqual(status.backend, 'godbolt');

  const first = await (await send('POST', '/api/cpp/run', { source: 'int main() {}', stdin: '7' })).json();
  assert.strictEqual(first.backend, 'godbolt');
  assert.strictEqual(first.runs[0].stdout, 'ran with 7');
  assert.ok(godboltCalls.length >= 1);

  await send('POST', '/api/cpp/run', { source: 'int main() {}' });
  await send('POST', '/api/cpp/run', { source: 'int main() {}' });
  const limited = await send('POST', '/api/cpp/run', { source: 'int main() {}' });
  assert.strictEqual(limited.status, 429);
  assert.match((await limited.json()).error, /Too many runs/);
});

test('the normal version is unchanged: it still asks for the password', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'au-closed-'));
  const closed = createApp({ dataDir: dir, open: false, password: 'secret' });
  await new Promise((resolve) => closed.listen(0, '127.0.0.1', resolve));
  try {
    const res = await fetch(`http://127.0.0.1:${closed.address().port}/`, { redirect: 'manual' });
    assert.strictEqual(res.status, 302);
    assert.match(res.headers.get('location'), /^\/login/);
  } finally {
    closed.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------ backup files

test('a backup holds the project and the learning progress, and reads back', () => {
  const editor = { name: 'My page', files: [{ name: 'index.html', content: '<h1>hi</h1>' }], active: 'index.html' };
  const learn = Engine.emptyProgress();
  learn.items['c1-hello'] = { status: 'done', xp: 20, at: '2026-01-01T00:00:00Z' };

  const doc = Backup.create({ editor, learn }, new Date(2026, 8, 25, 10));
  assert.strictEqual(doc.format, 'actually-useful-backup');
  assert.strictEqual(doc.version, 1);
  const back = Backup.parse(JSON.stringify(doc));
  assert.deepStrictEqual(back.editor, editor);
  assert.deepStrictEqual(back.learn, learn);
  assert.strictEqual(Backup.fileName(new Date(2026, 8, 5)), 'actually-useful-backup-2026-09-05.json');
  assert.strictEqual(Backup.describe(back), 'the project "My page" (1 file) and learning progress (1 item)');
});

test('collect reads both parts from browser storage', () => {
  const store = {
    [Backup.KEYS.editor]: JSON.stringify({ name: 'Draft', files: [] }),
    [Backup.KEYS.learn]: JSON.stringify(Engine.emptyProgress())
  };
  const doc = Backup.collect({ getItem: (key) => (key in store ? store[key] : null) });
  assert.strictEqual(doc.editor.name, 'Draft');
  assert.ok(doc.learn.items);
  const empty = Backup.collect({ getItem: () => 'not json' });
  assert.strictEqual(empty.editor, null);
  assert.strictEqual(empty.learn, null);
});

test('older Learn exports still restore, and bad files are explained', () => {
  const progress = Engine.emptyProgress();
  assert.deepStrictEqual(Backup.parse(JSON.stringify({ progress })).learn, progress);
  assert.deepStrictEqual(Backup.parse(JSON.stringify(progress)).learn, progress);

  assert.throws(() => Backup.parse('nope'), /not JSON/);
  assert.throws(() => Backup.parse('[1, 2]'), /not a backup/);
  assert.throws(() => Backup.parse('{"hello": 1}'), /not an Actually Useful backup/);
  assert.throws(() => Backup.parse(JSON.stringify({ format: Backup.FORMAT, version: 99, learn: progress })), /newer version/);
  assert.throws(() => Backup.parse(JSON.stringify({ format: Backup.FORMAT, version: 1 })), /empty/);
  assert.throws(() => Backup.parse(JSON.stringify({ format: Backup.FORMAT, version: 1, editor: { name: 'x' } })), /damaged/);
});
