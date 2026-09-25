'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const Course = require('../public/learn/course.js');
const MD = require('../public/learn/markdown.js');
const Explain = require('../public/learn/explain.js');

const COURSE_DIR = path.join(__dirname, '..', 'public', 'learn', 'course');

function loadRealCourse() {
  const read = (name) => Course.parseYaml(fs.readFileSync(path.join(COURSE_DIR, name), 'utf8'), name);
  const index = read('course.yml');
  const docs = index.chapters.map((id) => read(`${id}.yml`));
  return Course.buildCourse(index, docs, { glossary: read('glossary.yml') });
}

// ------------------------------------------------------------------ YAML

test('parseYaml reads the subset the course is written in', () => {
  const doc = Course.parseYaml([
    'title: Hello',
    'count: 3.5',
    'flag: true',
    'nothing: null',
    'list: [1, two, "th,ree"]',
    'quoted: "a: b"',
    'half: "starts" but does not end with a quote',
    'block: |',
    '  line one',
    '    indented',
    '  line three',
    'items:',
    '  - id: a',
    '    n: 1',
    '  - plain',
    '# a comment line',
    'after: yes'
  ].join('\n'), 'doc.yml');
  assert.strictEqual(doc.title, 'Hello');
  assert.strictEqual(doc.count, 3.5);
  assert.strictEqual(doc.flag, true);
  assert.strictEqual(doc.nothing, null);
  assert.deepStrictEqual(doc.list, [1, 'two', 'th,ree']);
  assert.strictEqual(doc.quoted, 'a: b');
  assert.strictEqual(doc.half, '"starts" but does not end with a quote');
  assert.strictEqual(doc.block, 'line one\n  indented\nline three');
  assert.deepStrictEqual(doc.items, [{ id: 'a', n: 1 }, 'plain']);
  assert.strictEqual(doc.after, 'yes');
});

test('parseYaml reports mistakes with the file and line', () => {
  assert.throws(() => Course.parseYaml('a: 1\na: 2', 'x.yml'), /x\.yml:2: duplicate key "a"/);
  assert.throws(() => Course.parseYaml('a:\n\tb: 1', 'x.yml'), /x\.yml:2: tabs/);
});

// ------------------------------------------------------------------ course model

function tinyCourse(chapterExtra = {}) {
  const index = {
    title: 'Tiny',
    parts: [{ id: 'p1', title: 'Part' }],
    chapters: ['ch01']
  };
  const chapter = Object.assign({
    id: 'ch01',
    number: 1,
    part: 'p1',
    title: 'One',
    goals: ['Learn'],
    items: [
      {
        type: 'lesson',
        id: 'c1-hello',
        title: 'Hello',
        objectives: ['Print'],
        body: 'Text\n\n{{check q}}\n\n{{task t}}\n',
        checks: [{ id: 'q', type: 'tf', prompt: 'True?', answer: true, why: 'Because.' }],
        tasks: [{ id: 't', title: 'Task', prompt: 'Do it', harness: 'CHECK(f(), 1);', solution: 'int f() { return 1; }' }],
        cards: [{ front: 'Q', back: 'A' }]
      },
      {
        type: 'exam',
        id: 'c1-exam',
        title: 'Exam',
        pick: 1,
        questions: [{ type: 'mcq', prompt: 'Pick', options: ['a', 'b'], answer: 1, why: 'b.' }]
      }
    ]
  }, chapterExtra);
  return Course.buildCourse(index, [chapter], {});
}

test('buildCourse assigns ids and indexes questions, tasks and cards', () => {
  const course = tinyCourse();
  assert.deepStrictEqual(Course.validate(course), []);
  assert.strictEqual(course.chapters.length, 1);
  const lesson = course.byId['c1-hello'];
  assert.strictEqual(lesson.checks[0].id, 'c1-hello/q');
  assert.strictEqual(lesson.tasks[0].id, 'c1-hello/t');
  assert.strictEqual(lesson.tasks[0].mode, 'functions');
  assert.strictEqual(course.cards[0].id, 'c1-hello#1');
  const exam = course.byId['c1-exam'];
  assert.strictEqual(exam.pass, 0.8);
  assert.ok(course.questions['c1-exam/q1']);
});

test('validate catches broken content', () => {
  const course = tinyCourse({
    items: [
      {
        type: 'lesson',
        id: 'c1-bad',
        title: 'Bad',
        objectives: ['x'],
        body: '{{check missing}}',
        checks: [{ id: 'q', type: 'mcq', prompt: 'P', options: ['only one'], answer: 3 }]
      },
      { type: 'exam', id: 'c1-exam', title: 'Exam', pick: 5, questions: [{ type: 'tf', prompt: 'P', answer: 'yes', why: 'w' }] }
    ]
  });
  const problems = Course.validate(course).join('\n');
  assert.match(problems, /placeholder \{\{check missing\}\} names nothing/);
  assert.match(problems, /needs at least two options/);
  assert.match(problems, /answer 3 is not an option index/);
  assert.match(problems, /every question should explain its answer/);
  assert.match(problems, /answer must be true or false/);
  assert.match(problems, /pick is larger than the pool/);
});

test('the real course is complete and consistent', () => {
  const course = loadRealCourse();
  assert.deepStrictEqual(Course.validate(course), []);
  assert.strictEqual(course.chapters.length, 20);
  assert.ok(course.byId['final-exam'], 'the Graduate badge depends on the final exam id');
  const count = (type) => course.items.filter((i) => i.type === type).length;
  assert.ok(count('lesson') >= 100);
  assert.ok(count('challenge') >= 80);
  assert.ok(count('exam') >= 20);
  assert.ok(count('project') >= 5);
  assert.ok(course.cards.length >= 300);
  assert.ok(course.glossary.length >= 150);
  course.chapters.forEach((chapter) => {
    assert.ok(chapter.items.some((i) => i.type === 'exam'), `${chapter.id} has an exam`);
  });
  course.glossary.forEach((term) => {
    assert.ok(term.term && term.def, 'glossary entries have a term and a definition');
    if (term.chapter) assert.ok(course.chapters.some((c) => c.id === term.chapter), `${term.term} links to a real chapter`);
  });
});

test('every course in courses.yml is complete, and ids are unique across courses', () => {
  // Progress is one record for all courses, so no two may share an id.
  const { loadCourseAt, courseDirs } = require('./web-course-lib.js');
  const loaded = courseDirs().map((dir) => loadCourseAt(dir));
  assert.deepStrictEqual(loaded.map(({ course }) => course.id), ['cpp', 'html', 'css', 'js']);
  const owner = {};
  const claim = (id, courseId) => {
    assert.ok(!owner[id] || owner[id] === courseId, `${id} is used by both ${owner[id]} and ${courseId}`);
    owner[id] = courseId;
  };
  loaded.forEach(({ course, missing }) => {
    assert.deepStrictEqual(missing, [], `${course.id} lists chapters that have no file`);
    assert.deepStrictEqual(Course.validate(course), [], `${course.id} is valid`);
    assert.ok(course.final && course.byId[course.final], `${course.id}'s final exam exists`);
    assert.ok(course.glossary.length >= 50, `${course.id} has a glossary`);
    assert.ok(course.items.filter((i) => i.type === 'build').length >= 2, `${course.id} ends with build-anything projects`);
    course.glossary.forEach((term) => {
      if (term.chapter) assert.ok(course.chapters.some((c) => c.id === term.chapter), `${course.id}: ${term.term} links to a real chapter`);
    });
    course.chapters.forEach((chapter) => {
      claim(chapter.id, course.id);
      assert.ok(chapter.items.some((i) => i.type === 'exam'), `${chapter.id} has an exam`);
    });
    course.items.forEach((item) => claim(item.id, course.id));
    Object.keys(course.questions).forEach((id) => claim(id, course.id));
  });
  const web = loaded.filter(({ course }) => course.lang === 'web').map(({ course }) => course);
  assert.deepStrictEqual(web.map((c) => [c.id, c.chapters.length]), [['html', 8], ['css', 12], ['js', 14]]);
});

// ------------------------------------------------------------------ markdown

test('markdown escapes HTML and only allows safe links', () => {
  const html = MD.render([
    '# Title <script>alert(1)</script>',
    '',
    '[bad](javascript:alert) [ok](https://example.com) [local](#/c/ch01) `a<b` **bold** [[Ctrl+Enter]]'
  ].join('\n'), {});
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /javascript:/);
  assert.match(html, /<a href="https:\/\/example\.com" target="_blank" rel="noopener">ok<\/a>/);
  assert.match(html, /<a href="#\/c\/ch01"/);
  assert.match(html, /<code>a&lt;b<\/code>/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<kbd>Ctrl<\/kbd>\+<kbd>Enter<\/kbd>/);
});

test('markdown renders callouts, tables, lists and hands code and slots to hooks', () => {
  const calls = [];
  const html = MD.render([
    '> [!mistake] Classic error',
    '> Forgetting the semicolon.',
    '',
    '| a | b |',
    '|:--|--:|',
    '| 1 | 2 |',
    '',
    '- one',
    '- two',
    '',
    '1. first',
    '2. second',
    '',
    '```cpp static',
    'int x{};',
    '```',
    '',
    '```stdin',
    '5',
    '```',
    '',
    '{{task t1}}'
  ].join('\n'), {
    code: (lang, flags, text, extras) => { calls.push({ lang, flags, text, extras }); return '<pre>code</pre>'; },
    slot: (kind, id) => `<div data-slot="${kind}:${id}"></div>`
  });
  assert.match(html, /<aside class="callout callout-mistake"><div class="callout-title">Classic error<\/div>/);
  assert.match(html, /<table>/);
  assert.match(html, /<ul><li>one<\/li><li>two<\/li><\/ul>/);
  assert.match(html, /<ol><li>first<\/li><li>second<\/li><\/ol>/);
  assert.match(html, /data-slot="task:t1"/);
  assert.strictEqual(calls[0].lang, 'cpp');
  assert.deepStrictEqual(calls[0].flags, ['static']);
  assert.strictEqual(calls[0].text, 'int x{};');
});

// ------------------------------------------------------------------ explanations

test('explain turns compiler messages into beginner hints', () => {
  const [missing] = Explain.diagnostics("main.cpp:3:5: error: expected ';' before 'return'\n    3 |     return 0;");
  assert.strictEqual(missing.line, 3);
  assert.strictEqual(missing.severity, 'error');
  assert.match(missing.hint, /semicolon/);

  const [undeclared] = Explain.diagnostics("main.cpp:4:5: error: 'cout' was not declared in this scope");
  assert.match(undeclared.hint, /std::cout/);
  assert.match(undeclared.hint, /<iostream>/);

  const linker = Explain.diagnostics("/usr/bin/ld: /tmp/ccX.o: in function `main':\nmain.cpp:(.text+0x9): undefined reference to `square(int)'\ncollect2: error: ld returned 1 exit status");
  assert.ok(linker.some((d) => /undefined reference/.test(d.message) && d.hint), 'linker errors are explained');
});

test('explain describes crashes, timeouts and exit codes', () => {
  const base = { stdout: '', stderr: '', timedOut: false, truncated: false, signal: null, exitCode: 0 };
  assert.match(Explain.runtime({ ...base, signal: 'SIGSEGV', exitCode: null }), /memory/i);
  assert.match(Explain.runtime({ ...base, timedOut: true }), /too long/);
  assert.match(Explain.runtime({ ...base, signal: 'SIGABRT', exitCode: null, stderr: "terminate called after throwing an instance of 'std::out_of_range'" }), /out_of_range|range/);
  assert.ok(!Explain.runtime(base), 'a normal run needs no explanation');
});
