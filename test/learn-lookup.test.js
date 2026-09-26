'use strict';

// "I don't know this" (public/learn/lookup.js): which part of which lesson
// teaches what a quiz question asks.

const test = require('node:test');
const assert = require('node:assert');

const Course = require('../public/learn/course.js');
const MD = require('../public/learn/markdown.js');
const Lookup = require('../public/learn/lookup.js');

function tinyCourse() {
  const index = { id: 't', title: 'T', parts: [{ id: 'p', title: 'P' }] };
  const chapter = {
    id: 'ch1',
    title: 'One',
    part: 'p',
    goals: ['x'],
    items: [
      {
        type: 'lesson',
        id: 'l-lists',
        title: 'Lists',
        objectives: ['Make lists'],
        body: 'Intro text about pages.\n\n## Bullet lists\n\nA `<ul>` is an unordered list. Each item is an `<li>`.\n\n## Numbered lists\n\nAn `<ol>` numbers its items. Use it for steps.'
      },
      {
        type: 'lesson',
        id: 'l-links',
        title: 'Links',
        objectives: ['Link pages'],
        body: '## The a element\n\nA link is an `<a>` element. Its `href` says where it goes.\n\nThe constructor of a page is you.'
      },
      {
        type: 'quiz',
        id: 'q1',
        title: 'Quiz',
        questions: [
          { type: 'mcq', prompt: 'Which element numbers its items?', options: ['`<ul>`', '`<ol>`'], answer: 1, why: '`<ol>` is an ordered list.' },
          { type: 'tf', prompt: 'The `href` attribute says where a link goes.', answer: true, why: 'Yes.' },
          { type: 'tf', prompt: 'A constructor is a thing.', answer: true, why: 'Words like constructor are fine.', see: 'l-lists#bullet' }
        ]
      }
    ]
  };
  return Course.buildCourse(index, [chapter], {});
}

test('find points at the section and the sentence that teach a question', () => {
  const course = tinyCourse();
  const idx = Lookup.index(course);
  const quiz = course.byId.q1;
  const ol = Lookup.find(idx, quiz.questions[0], quiz);
  assert.strictEqual(ol.lesson, 'l-lists');
  assert.strictEqual(ol.heading, 'Numbered lists');
  assert.strictEqual(ol.sentence, 'An <ol> numbers its items.');
  // The block number is the one render({number: true}) gives that paragraph.
  const html = MD.render(course.byId['l-lists'].body, { number: true });
  assert.match(html, new RegExp('<p data-b="' + ol.block + '">An <code>&lt;ol&gt;</code> numbers'));

  const href = Lookup.find(idx, quiz.questions[1], quiz);
  assert.strictEqual(href.lesson, 'l-links');
  assert.match(href.sentence, /href/);
});

test('see: names the lesson (and heading) by hand, and words like "constructor" are safe', () => {
  const course = tinyCourse();
  const idx = Lookup.index(course);
  const quiz = course.byId.q1;
  const r = Lookup.find(idx, quiz.questions[2], quiz);
  assert.strictEqual(r.lesson, 'l-lists');
  assert.strictEqual(r.heading, 'Bullet lists');
  assert.ok(Number.isFinite(Lookup.questionTerms(quiz.questions[2]).constructor), 'a token map has no inherited names');
  assert.deepStrictEqual(Course.validate(course), []);
});

test('validate checks see: and cooldown', () => {
  const course = tinyCourse();
  course.byId.q1.questions[2].see = 'nope';
  course.byId.q1.cooldown = -3;
  const problems = Course.validate(course);
  assert.ok(problems.some((p) => /see: nope is not a lesson/.test(p)));
  assert.ok(problems.some((p) => /cooldown must be a number of minutes/.test(p)));
});

test('every quiz question in every course can be traced to a lesson', () => {
  const { loadCourseAt, courseDirs } = require('./web-course-lib.js');
  courseDirs().map((dir) => loadCourseAt(dir).course).forEach((course) => {
    const idx = Lookup.index(course);
    let sameChapter = 0;
    let total = 0;
    course.items.filter((i) => i.type === 'quiz').forEach((quiz) => {
      quiz.questions.forEach((q) => {
        const r = Lookup.find(idx, q, quiz);
        assert.ok(r, `${q.id} is taught somewhere`);
        assert.strictEqual(course.byId[r.lesson].type, 'lesson');
        assert.ok(r.block !== null, `${q.id} points at a part of the lesson`);
        total += 1;
        if (course.byId[r.lesson].chapter === quiz.chapter) sameChapter += 1;
      });
    });
    // Quizzes are about the lessons just before them.
    assert.ok(sameChapter / total > 0.9, `${course.id}: ${sameChapter}/${total} questions are traced to their own chapter`);
  });
});

test('markdown blocks line up with the numbers render gives them', () => {
  const body = 'Para **one**.\n\n## Head\n\n- a\n- b\n\n```html\n<p>x</p>\n```\n\n> [!tip]\n> Inner\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n{{check q}}\n\nLast.';
  const blocks = MD.blocks(body);
  assert.deepStrictEqual(blocks.map((b) => b.kind), ['p', 'h', 'list', 'code', 'callout', 'table', 'slot', 'p']);
  const html = MD.render(body, { number: true, slot: () => '<div class="slot"></div>' });
  blocks.forEach((b, n) => assert.match(html, new RegExp('data-b="' + n + '"'), `block ${n} is numbered`));
  assert.doesNotMatch(MD.render(body), /data-b/, 'numbers only when asked');
  assert.strictEqual(MD.plain('Use `<p>` and **bold** [a link](https://x.example) [[Ctrl+S]] *now*'), 'Use <p> and bold a link Ctrl+S now');
});
