'use strict';

// Video lessons (public/learn/video.js): a script of steps played on a
// timeline. These check the timeline itself; the player that draws it runs in
// the browser drives, and every real video's selectors and programs are
// checked by course.test.js.

const test = require('node:test');
const assert = require('node:assert');

const Video = require('../public/learn/video.js');

const SCRIPT = {
  steps: [
    { scene: 'Headings', sub: 'big titles' },
    { type: '<h1>Hi</h1>\n', say: 'Type a heading' },
    { say: 'The main heading', mark: '<h1>', point: 'h1' },
    { replace: 'Hi', with: 'Hello' },
    { mark: { text: '<h1>', nth: -1, color: 'pink' }, say: '' }
  ]
};

test('build times every step: title cards, typing, reading', () => {
  const v = Video.build(SCRIPT, { lang: 'html' });
  assert.strictEqual(v.view, 'page');
  assert.deepStrictEqual(v.files, [{ name: 'index.html', content: '' }]);
  assert.strictEqual(v.steps[0].sceneDur, Video.TIMING.scene);
  assert.ok(v.steps[1].actionDur > 0.5, 'typing takes time');
  assert.ok(v.steps[2].holdDur >= 2.2, 'a caption stays long enough to read');
  v.steps.forEach((s, i) => {
    assert.ok(s.end > s.start, `step ${i + 1} lasts`);
    if (i) assert.strictEqual(s.start, v.steps[i - 1].end, 'steps follow one another');
  });
  assert.strictEqual(v.duration, v.steps[v.steps.length - 1].end);
  assert.deepStrictEqual(v.scenes.map((sc) => sc.title), ['Headings']);
  assert.strictEqual(Video.build({ lang: 'cpp', steps: [{ say: 'x' }] }).view, 'console');
});

test('frameAt shows the code being typed, then highlights it', () => {
  const v = Video.build(SCRIPT, { lang: 'html' });
  const card = Video.frameAt(v, 1);
  assert.strictEqual(card.sceneCard.title, 'Headings');
  assert.strictEqual(card.files[0].content, '');

  const typing = v.steps[1];
  const half = Video.frameAt(v, typing.start + typing.actionDur / 2);
  assert.ok(half.typing);
  assert.ok(half.files[0].content.length > 0 && half.files[0].content.length < '<h1>Hi</h1>\n'.length);
  assert.strictEqual(half.say, 'Type a heading');
  assert.deepStrictEqual(half.marks, [], 'no highlights while typing');

  const marked = Video.frameAt(v, v.steps[2].start + 0.1);
  assert.strictEqual(marked.files[0].content, '<h1>Hi</h1>\n');
  assert.deepStrictEqual(marked.marks.map((m) => [m.start, m.end]), [[0, 4]]);
  assert.deepStrictEqual(marked.points.map((p) => p.sel), ['h1']);

  const replacing = v.steps[3];
  const selecting = Video.frameAt(v, replacing.start + 0.3);
  assert.ok(selecting.selection && selecting.selection.start === 4, 'the old text is selected first');
  const end = Video.frameAt(v, v.duration);
  assert.strictEqual(end.files[0].content, '<h1>Hello</h1>\n');
  assert.strictEqual(end.say, '', 'an empty caption clears it');
  assert.strictEqual(end.marks[0].color, 'pink', 'the last step stays on screen at the end');
  assert.ok(end.done);
});

test('steps insert at anchors, erase, and switch files', () => {
  const v = Video.build({
    start: { 'index.html': '<p>Fresh bread</p>', 'style.css': '' },
    steps: [
      { type: '<strong>', before: 'bread' },
      { type: '</strong>', at: 'bread' },
      { erase: 'Fresh ' },
      { file: 'style.css', type: 'p { color: red; }' }
    ]
  });
  const f = Video.frameAt(v, v.duration);
  assert.strictEqual(f.files[0].content, '<p><strong>bread</strong></p>\n', 'a starting file ends with a new line');
  assert.strictEqual(f.active, 'style.css');
  assert.strictEqual(f.files[1].content, 'p { color: red; }');
});

test('console videos print, trace lines and show variables changing', () => {
  const v = Video.build({
    lang: 'js',
    steps: [
      { type: 'let x = 1;\nx = x + 1;\nconsole.log(x);\n' },
      { run: true, line: 1, vars: { x: '1' } },
      { line: 2, vars: { x: '2' } },
      { line: 3, print: '2' },
      { print: '✖ TypeError: nope' }
    ]
  });
  const step2 = Video.frameAt(v, v.steps[2].start + 0.1);
  assert.strictEqual(step2.line, 2);
  assert.deepStrictEqual(step2.vars, [{ name: 'x', value: '2' }]);
  assert.deepStrictEqual(step2.changed, ['x']);
  assert.ok(Video.frameAt(v, v.steps[1].start + 0.1).running, 'the Run button flashes');
  const prog = Video.program(v);
  assert.strictEqual(prog.files[0].name, 'script.js');
  assert.strictEqual(prog.output, '2', 'error lines are not part of what the program prints');
  assert.ok(prog.errors);
});

test('pages: stylesheets are folded in, scripts left out, pictures come from assets', () => {
  const v = Video.build({
    assets: { 'cat.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>' },
    css: 'body { margin: 0; }',
    start: {
      'index.html': '<link rel="stylesheet" href="style.css"><img src="cat.svg" alt="A cat"><a href="b.html">B</a><script>alert(1)</script>',
      'style.css': 'img { width: 50px; }',
      'b.html': '<h1>Page B</h1>'
    },
    steps: [{ click: 'a', show: 'b.html' }]
  });
  const start = Video.pageHtml(Video.frameAt(v, 0), v);
  assert.match(start, /<style>\nimg \{ width: 50px; \}\n+<\/style>/);
  assert.match(start, /src="data:image\/svg\+xml;charset=utf-8,%3Csvg/);
  assert.doesNotMatch(start, /alert/);
  assert.match(start, /body \{ margin: 0; \}/);
  assert.match(Video.pageHtml(Video.frameAt(v, v.duration), v), /Page B/, 'after the click the browser shows b.html');
  assert.deepStrictEqual(Video.targets(v).map((t) => t.sels), [['a']]);
});

test('problems finds mistakes in a script by playing it', () => {
  assert.deepStrictEqual(Video.problems(SCRIPT, { lang: 'html' }), []);
  const bad = Video.problems({
    steps: [
      { type: 'x', at: 'missing' },
      { mark: 'nowhere' },
      { replace: 'x' },
      { colour: 'red' },
      { show: 'other.html' },
      { type: 'y'.repeat(70) }
    ]
  });
  assert.ok(bad.some((p) => /step 1: at "missing"/.test(p)));
  assert.ok(bad.some((p) => /step 2: mark "nowhere"/.test(p)));
  assert.ok(bad.some((p) => /step 3: replace needs with/.test(p)));
  assert.ok(bad.some((p) => /step 4: unknown key "colour"/.test(p)));
  assert.ok(bad.some((p) => /step 5: show "other.html"/.test(p)));
  assert.ok(bad.some((p) => /70 characters/.test(p)));
  assert.deepStrictEqual(Video.problems(null), ['a video needs a script (video:)']);
});

test('the transcript lists scenes and captions with their times', () => {
  const v = Video.build(SCRIPT, { lang: 'html' });
  const lines = Video.transcript(v);
  assert.deepStrictEqual(lines.map((l) => l.scene || l.say), ['Headings', 'Type a heading', 'The main heading']);
  assert.ok(lines[1].at >= Video.TIMING.scene);
});

test('every HTML chapter has a video, and every video in the courses is valid', () => {
  const { loadCourseAt, courseDirs } = require('./web-course-lib.js');
  const loaded = courseDirs().map((dir) => loadCourseAt(dir).course);
  loaded.forEach((course) => {
    course.items.filter((i) => i.type === 'video').forEach((item) => {
      assert.ok(item.video && item.video.duration > 20, `${item.id} has a real script`);
      assert.ok(item.video.duration < 150, `${item.id} stays short`);
      assert.ok(item.body, `${item.id} sums up what it showed`);
      const index = item.chapter.items.indexOf(item);
      assert.ok(item.chapter.items.slice(index + 1).some((next) => next.type === 'lesson' || next.type === 'build' || next.type === 'project'),
        `${item.id} introduces something that follows it`);
    });
  });
  const html = loaded.find((c) => c.id === 'html');
  html.chapters.forEach((ch) => assert.ok(ch.items.some((i) => i.type === 'video'), `${ch.id} has a video`));
  loaded.forEach((c) => assert.ok(c.items.some((i) => i.type === 'video'), `${c.id} has videos`));
});
