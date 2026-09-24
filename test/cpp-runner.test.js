'use strict';

// Runs real programs with the local compiler. Skipped when there is no g++.

const test = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');

const { createRunner } = require('../server/cpp.js');
const Engine = require('../public/learn/engine.js');

let hasCompiler = true;
try {
  execFileSync(process.env.AU_CXX || 'g++', ['--version'], { stdio: 'ignore' });
} catch {
  hasCompiler = false;
}
const options = { skip: hasCompiler ? false : 'no C++ compiler installed' };

const runner = createRunner({ backend: 'local', pch: false });

test('compiles and runs a program with input', options, async () => {
  const data = await runner.run({
    source: '#include <iostream>\nint main() { int a{}, b{}; std::cin >> a >> b; std::cout << a + b << "\\n"; }',
    inputs: ['2 3', '10 -4']
  });
  assert.strictEqual(data.backend, 'local');
  assert.strictEqual(data.compile.ok, true);
  assert.deepStrictEqual(data.runs.map((r) => r.stdout), ['5\n', '6\n']);
  assert.deepStrictEqual(data.runs.map((r) => r.exitCode), [0, 0]);
});

test('reports compile errors without running anything', options, async () => {
  const data = await runner.run({ source: 'int main() { return 0 }' });
  assert.strictEqual(data.compile.ok, false);
  assert.match(data.compile.output, /error/);
  assert.deepStrictEqual(data.runs, []);
});

test('builds several files together', options, async () => {
  const data = await runner.run({
    files: [
      { name: 'main.cpp', content: '#include <iostream>\n#include "util.h"\nint main() { std::cout << twice(21); }' },
      { name: 'util.h', content: '#pragma once\nint twice(int x);' },
      { name: 'util.cpp', content: '#include "util.h"\nint twice(int x) { return 2 * x; }' }
    ]
  });
  assert.strictEqual(data.compile.ok, true, data.compile.output);
  assert.strictEqual(data.runs[0].stdout, '42');
});

test('stops endless loops and runaway output', options, async () => {
  const loop = await runner.run({ source: 'int main() { volatile int x = 0; while (true) { ++x; } }', timeoutMs: 1000 });
  assert.strictEqual(loop.runs[0].timedOut, true);

  const flood = await runner.run({ source: '#include <iostream>\nint main() { while (true) std::cout << "spam spam spam\\n"; }', timeoutMs: 3000 });
  assert.strictEqual(flood.runs[0].truncated, true);
  assert.ok(flood.runs[0].stdout.length <= 70 * 1024);
});

test('crashes are reported as signals', options, async () => {
  const data = await runner.run({ source: '#include <vector>\nint main() { std::vector<int> v(2); return v[5]; }' });
  assert.strictEqual(data.compile.ok, true);
  assert.ok(data.runs[0].signal || data.runs[0].exitCode !== 0, 'bounds checking stops the program');
});

test('the checker harness reports each CHECK', options, async () => {
  const code = 'int twice(int x) { return x + x; }\nint broken(int x) { return x; }';
  const harness = 'CHECK(twice(4), 8);\nCHECK(broken(4), 8);\nCHECK((std::vector<int>{1, 2}), (std::vector<int>{1, 2}));';
  const data = await runner.run({ source: Engine.buildChecked(code, harness) });
  assert.strictEqual(data.compile.ok, true, data.compile.output);
  const parsed = Engine.parseChecked(data.runs[0].stdout);
  assert.strictEqual(parsed.done, true);
  assert.deepStrictEqual(parsed.checks.map((c) => c.ok), [true, false, true]);
  assert.strictEqual(parsed.checks[1].expr, 'broken(4)');
  assert.strictEqual(parsed.checks[1].got, '4');
  assert.strictEqual(parsed.checks[1].want, '8');
});

test('the same program compiled twice comes from the cache', options, async () => {
  const source = '#include <cstdio>\nint main() { std::puts("cached"); }';
  await runner.run({ source });
  const again = await runner.run({ source });
  assert.strictEqual(again.compile.cached, true);
  assert.strictEqual(again.runs[0].stdout, 'cached\n');
});
