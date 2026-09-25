'use strict';

// The pure parts of Learn mode's HTML/CSS/JavaScript runner (public/learn/web.js):
// console formatting, comparing, check translation, loop guards and the
// documents it builds. Running code in a real browser is covered by
// web-course-lib.js (see course.test.js).

const test = require('node:test');
const assert = require('node:assert');

const Web = require('../public/learn/web.js');

test('format prints values the way a browser console does', () => {
  assert.strictEqual(Web.format([1, 'a', { b: 2 }]), "[1, 'a', {b: 2}]");
  assert.strictEqual(Web.format({ x: [1, 2], y: 's' }), "{x: [1, 2], y: 's'}");
  assert.strictEqual(Web.format('top-level strings have no quotes'), 'top-level strings have no quotes');
  assert.strictEqual(Web.format(null), 'null');
  assert.strictEqual(Web.format(undefined), 'undefined');
  assert.strictEqual(Web.format(-0), '-0');
  assert.strictEqual(Web.format(new Map([['k', 1]])), "Map(1) {'k' => 1}");
  assert.strictEqual(Web.format(new Set([1])), 'Set(1) {1}');
  assert.strictEqual(Web.format([1, , 3]), '[1, empty × 1, 3]'); // eslint-disable-line no-sparse-arrays
  class Point { constructor() { this.x = 1; } }
  assert.strictEqual(Web.format(new Point()), 'Point {x: 1}');
  const loop = { name: 'me' };
  loop.self = loop;
  assert.strictEqual(Web.format(loop), "{name: 'me', self: [Circular]}");
  // Check results quote strings, so spaces are visible.
  assert.strictEqual(Web.show('a b'), '"a b"');
});

test('same compares deeply, and numbers with a little tolerance', () => {
  assert.ok(Web.same([1, { a: [2] }], [1, { a: [2] }]));
  assert.ok(Web.same(0.1 + 0.2, 0.3));
  assert.ok(Web.same(NaN, NaN));
  assert.ok(Web.same(new Map([['a', 1]]), new Map([['a', 1]])));
  assert.ok(!Web.same({ a: 1 }, { a: 1, b: 2 }));
  assert.ok(!Web.same('1', 1));
  assert.ok(!Web.same([1, 2], [2, 1]));
});

test('translateHarness turns checks into awaited bridge calls, leaving strings and comments alone', () => {
  const out = Web.translateHarness([
    'check(add(2, 3), 5);',
    'checkThrows(f(-1));',
    '// check(x, 1) in a comment',
    "const s = 'check(no, 1)';",
    "check($$('li').length, 2);"
  ].join('\n'));
  assert.match(out, /^await __au\.check\("add\(2, 3\)", \(\) => \(add\(2, 3\)\), \(\) => \(5\)\);$/m);
  assert.match(out, /^await __au\.throws\("f\(-1\)", async \(\) => \{ f\(-1\); \}\);$/m);
  assert.match(out, /^\/\/ check\(x, 1\) in a comment$/m);
  assert.match(out, /^const s = 'check\(no, 1\)';$/m);
  assert.ok(out.includes("$$('li').length"), 'dollar signs are kept as written');
  assert.deepStrictEqual(Web.splitArgs("a(1, 2), [3, 4], 'x, y'"), ['a(1, 2)', '[3, 4]', "'x, y'"]);
});

test('protectLoops guards every kind of loop, and the result still parses', () => {
  const cases = {
    'for (let i = 0; i < 3; i++) { x(); }': 'for (let i = 0; i < 3; i++) {__au.loop(); x(); }',
    'while (a) { b(); }': 'while (a) {__au.loop(); b(); }',
    'do { n++; } while (n < 5);': 'do {__au.loop(); n++; } while (__au.loop(), (n < 5));',
    'while (a) b();': 'while (__au.loop(), (a)) b();',
    'for (let i = 0; i < 3; i++) x += i;': 'for (let i = 0; __au.loop(), (i < 3); i++) x += i;',
    'for (;;) n++;': 'for (; __au.loop(), (true);) n++;',
    'const s = "while (x) {";': 'const s = "while (x) {";',
    'const whileLoop = 1; // for (;;) {': 'const whileLoop = 1; // for (;;) {'
  };
  for (const [src, want] of Object.entries(cases)) {
    const got = Web.protectLoops(src);
    assert.strictEqual(got, want, src);
    assert.doesNotThrow(() => new Function('__au', got), src); // eslint-disable-line no-new-func
  }
});

test('explain turns common JavaScript errors into hints', () => {
  assert.match(Web.explain('ReferenceError: foo is not defined'), /`foo` doesn't exist/);
  assert.match(Web.explain('TypeError: x.map is not a function'), /`x\.map` is being called like a function/);
  assert.strictEqual(Web.explain('Something nobody has seen before'), '');
});

test('pageDocument puts the bridge first, inlines files, and runs checks last', () => {
  const doc = Web.pageDocument([
    { name: 'index.html', content: '<p>Hi</p>' },
    { name: 'style.css', content: 'p { color: red; }' },
    { name: 'script.js', content: 'console.log("$$ and $&");\nwhile (true) n++;' }
  ], { harness: "check(text('p'), 'Hi');" });
  const bridge = doc.indexOf('__au');
  assert.ok(bridge > -1 && bridge < doc.indexOf('<p>Hi</p>'), 'the bridge comes before the content');
  assert.ok(doc.includes('p { color: red; }'), 'the stylesheet is inlined');
  assert.ok(doc.includes('console.log("$$ and $&")'), 'replacement patterns are not interpreted');
  assert.ok(doc.includes('while (__au.loop(), (true)) n++;'), 'page scripts get loop guards');
  assert.ok(doc.indexOf('//# sourceURL=checks.js') > doc.indexOf('//# sourceURL=script.js'), 'checks run after the page script');
  for (const name of Web.PAGE_HELPERS) {
    assert.ok(doc.includes('__au.dom.' + name), `the ${name} helper is passed to the checks`);
  }
});

test('workerSource reports where the learner code starts and offers printed() and capture()', () => {
  const job = Web.workerSource('const a = 1;\nconst b = 2;', 'check(a + b, 3);', {});
  assert.strictEqual(job.lines, 2);
  assert.strictEqual(job.source.split('\n')[job.offset], 'const a = 1;');
  assert.match(job.source, /const printed = __au\.printed, capture = __au\.capture;/);
});

test('the bridge records what was printed, for printed() and capture()', async () => {
  const messages = [];
  const scope = { console: {}, setTimeout, clearTimeout, setInterval, clearInterval };
  const api = Web.AU_BRIDGE(scope, (m) => messages.push(m), {});
  scope.console.log('first', [1, 2]);
  assert.strictEqual(api.capture(() => scope.console.log('inside')), 'inside');
  const later = await api.capture(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    scope.console.log('async');
  });
  assert.strictEqual(later, 'async');
  assert.strictEqual(api.printed(), 'first [1, 2]\ninside\nasync');
  assert.deepStrictEqual(messages.filter((m) => m.kind === 'log').map((m) => m.text), ['first [1, 2]', 'inside', 'async']);

  const ok = await api.check('1 + 1', () => 1 + 1, () => 2);
  const bad = await api.check('"a"', () => 'a', () => 'b');
  assert.deepStrictEqual([ok, bad], [true, false]);
  assert.deepStrictEqual(messages.filter((m) => m.kind === 'check').map((m) => [m.ok, m.got, m.want]), [[true, '2', '2'], [false, '"a"', '"b"']]);
});
