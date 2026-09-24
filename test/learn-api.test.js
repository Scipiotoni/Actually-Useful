'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createApp } = require('../server/index.js');
const { createRunner, normalizeRequest, flatten, GodboltBackend, WandboxBackend } = require('../server/cpp.js');
const Engine = require('../public/learn/engine.js');

let server;
let base;
let dataDir;
const runs = [];

// A stand-in compiler: the API is tested here, the real compiler in cpp-runner.test.js.
const fakeRunner = {
  async status() { return { available: true, backend: 'fake', compiler: 'fake g++', std: 'c++20' }; },
  async run(body) {
    const request = normalizeRequest(body);
    runs.push(request);
    return {
      backend: 'fake',
      compiler: 'fake g++',
      std: 'c++20',
      compile: { ok: true, output: '', ms: 1, cached: false },
      runs: request.inputs.map((input) => ({ stdout: `echo:${input}`, stderr: '', exitCode: 0, signal: null, timedOut: false, truncated: false, ms: 1 }))
    };
  }
};

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'au-learn-'));
  server = createApp({ dataDir, runner: fakeRunner });
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

test('/learn redirects to the Learn app, which is served with its course files', async () => {
  const redirect = await fetch(`${base}/learn`, { redirect: 'manual' });
  assert.strictEqual(redirect.status, 301);
  assert.strictEqual(redirect.headers.get('location'), '/learn/');

  const page = await fetch(`${base}/learn/`);
  assert.strictEqual(page.status, 200);
  assert.match(await page.text(), /engine\.js/);

  const yml = await fetch(`${base}/learn/course/course.yml`);
  assert.strictEqual(yml.status, 200);
  assert.match(yml.headers.get('content-type'), /yaml|text/);
  assert.match(await yml.text(), /Learn C\+\+ from Zero/);
});

test('the editor links to Learn mode', async () => {
  const html = await (await fetch(base)).text();
  assert.match(html, /href="learn\/"/);
});

test('C++ status and run go through the runner', async () => {
  const status = await (await fetch(`${base}/api/cpp/status`)).json();
  assert.strictEqual(status.available, true);

  const res = await send('POST', '/api/cpp/run', { source: 'int main() {}', inputs: ['a', 'b'] });
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.deepStrictEqual(data.runs.map((r) => r.stdout), ['echo:a', 'echo:b']);
  assert.strictEqual(runs.at(-1).files[0].name, 'main.cpp');
});

test('bad C++ requests are refused with a clear message', async () => {
  const cases = [
    [{}, 400, /source/],
    [{ files: [{ name: '../evil.cpp', content: '' }] }, 400, /file name/],
    [{ files: [{ name: 'a.h', content: '' }] }, 400, /no \.cpp file/],
    [{ source: 'x'.repeat(300 * 1024) }, 413, /too large/]
  ];
  for (const [body, status, message] of cases) {
    const res = await send('POST', '/api/cpp/run', body);
    assert.strictEqual(res.status, status, JSON.stringify(body).slice(0, 60));
    assert.match((await res.json()).error, message);
  }
});

test('learning progress is stored and merged, never overwritten', async () => {
  const first = await (await fetch(`${base}/api/learn/progress`)).json();
  assert.strictEqual(first.storage, 'disk');
  assert.deepStrictEqual(first.progress.items, {});

  const deviceA = Engine.emptyProgress();
  deviceA.items['c1-hello'] = { status: 'done', xp: 20, at: '2026-01-01T00:00:00Z' };
  let res = await send('PUT', '/api/learn/progress', { progress: deviceA });
  assert.strictEqual(res.status, 200);

  const deviceB = Engine.emptyProgress();
  deviceB.items['c1-quiz'] = { status: 'done', xp: 25, at: '2026-01-02T00:00:00Z' };
  res = await send('PUT', '/api/learn/progress', { progress: deviceB });
  const merged = (await res.json()).progress;
  assert.deepStrictEqual(Object.keys(merged.items).sort(), ['c1-hello', 'c1-quiz']);

  const onDisk = JSON.parse(fs.readFileSync(path.join(dataDir, '.learn', 'progress.json'), 'utf8'));
  assert.deepStrictEqual(Object.keys(onDisk.items).sort(), ['c1-hello', 'c1-quiz']);

  const bad = await send('PUT', '/api/learn/progress', { progress: [1, 2] });
  assert.strictEqual(bad.status, 400);
});

test('a runner with no backend reports it instead of failing', async () => {
  const runner = createRunner({ backend: 'off' });
  const status = await runner.status();
  assert.strictEqual(status.available, false);
  await assert.rejects(runner.run({ source: 'int main() {}' }), (err) => err.status === 503);
  await assert.rejects(runner.run({}), (err) => err.status === 400);
});

test('normalizeRequest applies the limits', () => {
  const r = normalizeRequest({ source: 'int main() {}', stdin: '5', timeoutMs: 999999 });
  assert.deepStrictEqual(r.inputs, ['5']);
  assert.ok(r.runMs <= 15000);
  assert.throws(() => normalizeRequest({ files: [{ name: 'a.cpp', content: '' }, { name: 'a.cpp', content: '' }] }), /Two files/);
  assert.throws(() => normalizeRequest({ source: '', inputs: Array(50).fill('') }), /inputs/);
});

test('flatten joins several files into one source for remote compilers', () => {
  const source = flatten([
    { name: 'main.cpp', content: '#include "util.h"\nint main() { return twice(1); }' },
    { name: 'util.h', content: '#pragma once\nint twice(int x);' },
    { name: 'util.cpp', content: '#include "util.h"\nint twice(int x) { return 2 * x; }' }
  ]);
  assert.match(source, /==== main\.cpp/);
  assert.match(source, /==== util\.cpp/);
  assert.match(source, /int twice\(int x\);/);
  assert.doesNotMatch(source, /#include "util\.h"/);
});

// Remote services can't be reached from the test machine, so their answers are
// simulated with the shapes their public APIs document.
function fakeFetch(reply, seen) {
  return async (url, init) => {
    seen.push({ url, body: JSON.parse(init.body) });
    return { ok: true, status: 200, json: async () => (typeof reply === 'function' ? reply(JSON.parse(init.body)) : reply) };
  };
}

test('Compiler Explorer backend: request and reply mapping', async () => {
  const seen = [];
  const backend = new GodboltBackend({
    fetchImpl: fakeFetch((body) => ({
      code: 0,
      didExecute: true,
      buildResult: { code: 0, stdout: [], stderr: [{ text: 'main.cpp:1: warning: unused' }] },
      stdout: [{ text: `got ${body.options.executeParameters.stdin}` }],
      stderr: [],
      execTime: '3'
    }), seen)
  });
  const result = await backend.run({ files: [{ name: 'main.cpp', content: 'int main(){}' }], inputs: ['1', '2'], runMs: 1000 });
  assert.match(seen[0].url, /\/api\/compiler\/g132\/compile$/);
  assert.strictEqual(seen[0].body.options.compilerOptions.executorRequest, true);
  assert.match(seen[0].body.options.userArguments, /-std=c\+\+20/);
  assert.strictEqual(result.compile.ok, true);
  assert.match(result.compile.output, /warning: unused/);
  assert.deepStrictEqual(result.runs.map((r) => r.stdout), ['got 1', 'got 2']);

  const failing = new GodboltBackend({
    fetchImpl: fakeFetch({ code: -1, didExecute: false, buildResult: { code: 1, stdout: [], stderr: [{ text: 'main.cpp:1:1: error: nope' }] } }, [])
  });
  const failed = await failing.run({ files: [{ name: 'main.cpp', content: 'x' }], inputs: [''], runMs: 1000 });
  assert.strictEqual(failed.compile.ok, false);
  assert.match(failed.compile.output, /error: nope/);
  assert.deepStrictEqual(failed.runs, []);
});

test('Wandbox backend: request and reply mapping', async () => {
  const seen = [];
  const backend = new WandboxBackend({
    fetchImpl: fakeFetch((body) => ({ status: '0', compiler_output: '', program_output: `in=${body.stdin}` }), seen)
  });
  const result = await backend.run({
    files: [{ name: 'util.h', content: '' }, { name: 'main.cpp', content: 'int main(){}' }, { name: 'util.cpp', content: '' }],
    inputs: ['x'],
    runMs: 1000
  });
  assert.match(seen[0].url, /\/api\/compile\.json$/);
  assert.strictEqual(seen[0].body.code, 'int main(){}');
  assert.deepStrictEqual(seen[0].body.codes.map((c) => c.file).sort(), ['util.cpp', 'util.h']);
  assert.match(seen[0].body['compiler-option-raw'], /util\.cpp/);
  assert.strictEqual(result.compile.ok, true);
  assert.strictEqual(result.runs[0].stdout, 'in=x');

  const failing = new WandboxBackend({
    fetchImpl: fakeFetch({ status: '1', compiler_error: 'prog.cc:1:1: error: nope' }, [])
  });
  const failed = await failing.run({ files: [{ name: 'main.cpp', content: 'x' }], inputs: [''], runMs: 1000 });
  assert.strictEqual(failed.compile.ok, false);
});
