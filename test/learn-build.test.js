'use strict';

// "Build anything" projects (public/learn/build.js): the ingredients a
// learner's own project must use, checked in their code and on the page.

const test = require('node:test');
const assert = require('node:assert');

const Build = require('../public/learn/build.js');

test('comments never count as using an ingredient', () => {
  assert.strictEqual(Build.stripComments('for (x) // while (y)\n/* if (z) */ s = "// kept";', 'js'), 'for (x) \n  s = "// kept";');
  assert.strictEqual(Build.stripComments('a { color: red; } /* display: grid */', 'css'), 'a { color: red; } ');
  assert.strictEqual(Build.stripComments('<p>x</p><!-- <table> -->', 'html'), '<p>x</p>');
});

test('sources gathers each language, including CSS and JavaScript written inside the HTML', () => {
  const files = [
    { name: 'index.html', content: '<style>.a { display: flex; }</style><p style="color: red">x</p><script>let a = [1, 2].map((x) => x);</script><script src="script.js"></script>' },
    { name: 'script.js', content: 'function f() {}' },
    { name: 'style.css', content: 'body { margin: 0; }' }
  ];
  assert.match(Build.sources(files, 'css'), /display: flex/);
  assert.match(Build.sources(files, 'css'), /color: red/);
  assert.match(Build.sources(files, 'css'), /margin: 0/);
  assert.match(Build.sources(files, 'js'), /\.map\(/);
  assert.match(Build.sources(files, 'js'), /function f/);
  assert.ok(Build.codeMet({ code: 'display\\s*:\\s*flex', in: 'css' }, files));
  assert.ok(!Build.codeMet({ code: '\\bwhile\\b', in: 'js' }, files));
  assert.ok(Build.codeMet({ code: '<SCRIPT', in: 'html' }, files), 'HTML and CSS patterns ignore case');
});

test('grade marks each ingredient, and running without errors', () => {
  const reqs = [
    { text: 'A list', check: "count('li') >= 3" },
    { text: 'Flexbox', code: 'display\\s*:\\s*flex', in: 'css' },
    { text: 'Grid', code: 'display\\s*:\\s*grid', in: 'css', hint: 'Use `display: grid`.' },
    { text: 'Prints', output: '\\S' }
  ];
  assert.strictEqual(Build.harness(reqs), "check(Boolean(count('li') >= 3), true);");
  const files = [{ name: 'style.css', content: '.row { display: flex; }' }];
  const g = Build.grade(reqs, files, { checks: [{ ok: true }], clean: true, output: 'hello' });
  assert.deepStrictEqual(g.checks.map((c) => [c.expr, c.ok]), [['A list', true], ['Flexbox', true], ['Grid', false], ['Prints', true], ['It runs without errors', true]]);
  assert.strictEqual(g.checks[2].note, 'Use `display: grid`.');
  assert.strictEqual(g.ok, false);
  const broken = Build.grade(reqs.slice(0, 2), files, { checks: [{ ok: true }], clean: false });
  assert.strictEqual(broken.ok, false, 'a project with errors is not finished');
});

test('problems catches badly written ingredients', () => {
  assert.deepStrictEqual(Build.problems([{ text: 'ok', code: 'a' }]), []);
  assert.strictEqual(Build.problems([{ text: 'no test' }]).length, 1);
  assert.strictEqual(Build.problems([{ text: 'bad', code: '(' }]).length, 1);
  assert.strictEqual(Build.problems([{ text: 'where', code: 'a', in: 'python' }]).length, 1);
});
