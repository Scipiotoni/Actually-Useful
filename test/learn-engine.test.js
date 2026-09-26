'use strict';

const test = require('node:test');
const assert = require('node:assert');

const Engine = require('../public/learn/engine.js');

const MARK = '\u001e';
const SEP = '\u001f';

test('compareOutput ignores trailing spaces and final newlines but not the rest', () => {
  assert.deepStrictEqual(Engine.compareOutput('a  \nb\n\n', 'a\nb'), { ok: true });
  assert.deepStrictEqual(Engine.compareOutput('a\r\nb', 'a\nb'), { ok: true });
  const diff = Engine.compareOutput('a\nx\n', 'a\nb\nc');
  assert.strictEqual(diff.ok, false);
  assert.strictEqual(diff.line, 2);
  assert.strictEqual(diff.got, 'x');
  assert.strictEqual(diff.want, 'b');
  assert.strictEqual(Engine.compareOutput('a', 'a\nb').want, 'b');
  assert.strictEqual(Engine.compareOutput('a', 'a\nb').got, null);
  assert.strictEqual(Engine.compareOutput(' a', 'a').ok, false, 'leading spaces matter');
});

test('checkedExpression keeps the expression and drops the expected value', () => {
  assert.strictEqual(Engine.checkedExpression('add(2, 3), 5'), 'add(2, 3)');
  assert.strictEqual(Engine.checkedExpression('f({1, 2}), (std::vector<int>{1, 2})'), 'f({1, 2})');
  assert.strictEqual(Engine.checkedExpression('join("a,b", \',\'), "a,b"'), 'join("a,b", \',\')');
  assert.strictEqual(Engine.checkedExpression('alone'), 'alone');
});

test('parseChecked separates check results from ordinary output', () => {
  const stdout = [
    'hello',
    `${MARK}PASS${SEP}add(2, 3), 5${SEP}5${SEP}5`,
    '',
    `${MARK}FAIL${SEP}name(), "Ada"${SEP}"Bob\u001dsmith"${SEP}"Ada"`,
    `${MARK}DONE`
  ].join('\n');
  const parsed = Engine.parseChecked(stdout);
  assert.strictEqual(parsed.done, true);
  assert.strictEqual(parsed.output, 'hello');
  assert.deepStrictEqual(parsed.checks, [
    { ok: true, expr: 'add(2, 3)', got: '5', want: '5' },
    { ok: false, expr: 'name()', got: '"Bob\nsmith"', want: '"Ada"' }
  ]);
  assert.strictEqual(Engine.parseChecked('crashed before the end').done, false);
});

test('buildChecked puts the learner code first and the harness in main', () => {
  const program = Engine.buildChecked('int twice(int x) { return 2 * x; }', 'CHECK(twice(2), 4);', 'struct Extra {};');
  assert.ok(program.startsWith('int twice'));
  assert.ok(program.indexOf('#line 1 "checks.cpp"') > program.indexOf('int twice'));
  assert.ok(program.indexOf('struct Extra {};') < program.indexOf('int main()'));
  assert.match(program, /int main\(\) \{\nCHECK\(twice\(2\), 4\);/);
  assert.match(program, /DONE/);
});

test('learnerDiagnostics hides messages that point into the checker', () => {
  const text = [
    "main.cpp:3:5: error: expected ';' before 'return'",
    '    3 |     return 0;',
    "checks.cpp:12:1: note: in expansion of macro 'CHECK'",
    '   12 | CHECK(x, 1);'
  ].join('\n');
  const shown = Engine.learnerDiagnostics(text);
  assert.match(shown, /main\.cpp:3:5/);
  assert.doesNotMatch(shown, /checks\.cpp/);
});

test('checkAnswer marks every question type', () => {
  assert.ok(Engine.checkAnswer({ type: 'mcq', answer: 1 }, 1).ok);
  assert.ok(!Engine.checkAnswer({ type: 'mcq', answer: 1 }, 2).ok);
  assert.ok(Engine.checkAnswer({ type: 'mcq', answer: [0, 2] }, [2, 0]).ok);
  assert.ok(!Engine.checkAnswer({ type: 'mcq', answer: [0, 2] }, [0]).ok);

  assert.ok(Engine.checkAnswer({ type: 'tf', answer: false }, false).ok);
  assert.ok(!Engine.checkAnswer({ type: 'tf', answer: false }, undefined).ok, 'no answer is not "false"');

  assert.ok(Engine.checkAnswer({ type: 'output', answer: '1 2\n3\n' }, '1 2  \n3').ok);
  assert.ok(!Engine.checkAnswer({ type: 'output', answer: '1 2' }, '12').ok);

  const fill = { type: 'fill', blanks: [['typename', 'class'], ['std::cout << x;']] };
  assert.ok(Engine.checkAnswer(fill, ['class', 'std::cout<<x']).ok, 'spacing and a final ; do not matter');
  assert.ok(!Engine.checkAnswer(fill, ['struct', 'std::cout << x']).ok);
  assert.ok(!Engine.checkAnswer(fill, ['', 'std::cout << x']).ok);
  const quoted = { type: 'fill', blanks: [['"a b"']] };
  assert.ok(!Engine.checkAnswer(quoted, ['"ab"']).ok, 'spaces inside quotes matter');

  const order = { type: 'order', lines: ['a', 'b', 'c'], alternatives: [[1, 0, 2]] };
  assert.ok(Engine.checkAnswer(order, [0, 1, 2]).ok);
  assert.ok(Engine.checkAnswer(order, [1, 0, 2]).ok);
  assert.ok(!Engine.checkAnswer(order, [2, 1, 0]).ok);

  assert.ok(Engine.checkAnswer({ type: 'spot', answer: 4 }, '4').ok);
  assert.ok(Engine.checkAnswer({ type: 'spot', answer: [4, 5] }, 5).ok);
  assert.ok(!Engine.checkAnswer({ type: 'mystery' }, 1).ok);
});

test('dates: day keys, adding days and counting between them', () => {
  assert.strictEqual(Engine.dayKey(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
  assert.strictEqual(Engine.addDays('2026-02-27', 2), '2026-03-01');
  assert.strictEqual(Engine.addDays('2024-02-28', 1), '2024-02-29');
  assert.strictEqual(Engine.addDays('2026-01-01', -1), '2025-12-31');
  assert.strictEqual(Engine.daysBetween('2026-03-01', '2026-03-31'), 30);
});

test('spaced repetition: remembered cards drift out, forgotten ones come back today', () => {
  const now = new Date(2026, 5, 1, 12).getTime();
  const today = Engine.dayKey(now);
  let card = Engine.newCard(today);
  assert.ok(Engine.isDue(card, now));

  card = Engine.schedule(card, 'good', now);
  assert.strictEqual(card.interval, 1);
  assert.strictEqual(card.due, Engine.addDays(today, 1));
  assert.ok(!Engine.isDue(card, now));

  card = Engine.schedule(card, 'good', now);
  assert.strictEqual(card.interval, 3);
  card = Engine.schedule(card, 'good', now);
  assert.ok(card.interval >= 7, 'third success waits about a week');

  const forgotten = Engine.schedule(card, 'again', now);
  assert.strictEqual(forgotten.interval, 0);
  assert.strictEqual(forgotten.due, today);
  assert.strictEqual(forgotten.reps, 0);
  assert.strictEqual(forgotten.lapses, 1);
  assert.ok(forgotten.ease < card.ease);

  const easy = Engine.schedule(Engine.newCard(today), 3, now);
  assert.strictEqual(easy.interval, 3);
  assert.ok(easy.ease > 2.5);

  let long = Engine.newCard(today);
  for (let i = 0; i < 20; i += 1) long = Engine.schedule(long, 'easy', now);
  assert.strictEqual(long.interval, 365, 'intervals are capped at a year');

  let floor = Engine.newCard(today);
  for (let i = 0; i < 20; i += 1) floor = Engine.schedule(floor, 'again', now);
  assert.strictEqual(floor.ease, 1.3, 'ease never drops below 1.3');
});

test('levels and streaks', () => {
  assert.strictEqual(Engine.levelFor(0).level, 1);
  assert.strictEqual(Engine.levelFor(0).title, Engine.LEVELS[0].title);
  const top = Engine.LEVELS[Engine.LEVELS.length - 1];
  assert.strictEqual(Engine.levelFor(top.xp + 1).next, null);
  assert.strictEqual(Engine.levelFor(top.xp + 1).progress, 1);
  const mid = Engine.levelFor(Engine.LEVELS[1].xp);
  assert.strictEqual(mid.level, 2);
  assert.strictEqual(mid.progress, 0);

  const now = new Date(2026, 5, 10, 9).getTime();
  const today = Engine.dayKey(now);
  const days = {};
  days[Engine.addDays(today, -1)] = 10;
  days[Engine.addDays(today, -2)] = 5;
  days[Engine.addDays(today, -4)] = 5;
  assert.strictEqual(Engine.streak(days, now), 2, 'today is still open, so yesterday counts');
  days[today] = 3;
  assert.strictEqual(Engine.streak(days, now), 3);
  assert.strictEqual(Engine.streak({}, now), 0);
});

test('mergeProgress never loses what was earned', () => {
  const a = Engine.emptyProgress();
  const b = Engine.emptyProgress();
  a.items.lesson1 = { status: 'done', best: 1, xp: 20, at: '2026-01-01T00:00:00Z', doneAt: '2026-01-01T00:00:00Z' };
  b.items.lesson1 = { status: 'started', best: 0.5, xp: 0, at: '2026-02-01T00:00:00Z' };
  b.items.quiz1 = { status: 'done', best: 0.9, xp: 25, at: '2026-02-01T00:00:00Z' };
  a.code.task = { src: 'old', at: '2026-01-01T00:00:00Z' };
  b.code.task = { src: 'new', at: '2026-01-02T00:00:00Z' };
  a.days['2026-01-01'] = 40;
  b.days['2026-01-01'] = 25;
  b.days['2026-01-02'] = 10;
  a.exams.e = [{ score: 0.6, at: '2026-01-01T00:00:00Z' }];
  b.exams.e = [{ score: 0.6, at: '2026-01-01T00:00:00Z' }, { score: 0.9, at: '2026-01-03T00:00:00Z' }];
  a.unlocked.ch02 = '2026-01-05T00:00:00Z';
  b.unlocked.ch02 = '2026-01-03T00:00:00Z';

  const merged = Engine.mergeProgress(a, b);
  assert.strictEqual(merged.items.lesson1.status, 'done', 'done is sticky');
  assert.strictEqual(merged.items.lesson1.best, 1, 'best only rises');
  assert.strictEqual(merged.items.lesson1.xp, 20);
  assert.strictEqual(merged.items.quiz1.status, 'done');
  assert.strictEqual(merged.code.task.src, 'new', 'newer code wins');
  assert.deepStrictEqual(merged.days, { '2026-01-01': 40, '2026-01-02': 10 });
  assert.strictEqual(merged.exams.e.length, 2, 'duplicate attempts are merged');
  assert.strictEqual(merged.unlocked.ch02, '2026-01-03T00:00:00Z', 'earliest unlock kept');
  assert.deepStrictEqual(Engine.mergeProgress(b, a).items, merged.items, 'order does not matter');
  assert.strictEqual(Engine.totalXp(merged), 45);
});

test('mergeProgress honours a reset on either side', () => {
  const old = Engine.emptyProgress();
  old.items.lesson1 = { status: 'done', xp: 20, at: '2026-01-01T00:00:00Z' };
  old.days['2026-01-01'] = 20;
  const fresh = Engine.emptyProgress();
  fresh.resetAt = '2026-03-01T00:00:00Z';
  fresh.items.lesson2 = { status: 'done', xp: 20, at: '2026-03-02T00:00:00Z' };
  fresh.days['2026-03-02'] = 20;

  const merged = Engine.mergeProgress(old, fresh);
  assert.strictEqual(merged.resetAt, '2026-03-01T00:00:00Z');
  assert.strictEqual(merged.items.lesson1, undefined, 'work from before the reset is gone');
  assert.strictEqual(merged.items.lesson2.status, 'done');
  assert.deepStrictEqual(merged.days, { '2026-03-02': 20 });
});

test('shuffle is a reproducible permutation for a given seed', () => {
  const list = Array.from({ length: 30 }, (_, i) => i);
  const one = Engine.shuffle(list, 12345);
  assert.deepStrictEqual(Engine.shuffle(list, 12345), one);
  assert.notDeepStrictEqual(Engine.shuffle(list, 999), one);
  assert.deepStrictEqual(one.slice().sort((x, y) => x - y), list);
  assert.deepStrictEqual(list, Array.from({ length: 30 }, (_, i) => i), 'input untouched');
});

test('readsInput looks at code, not comments or strings', () => {
  assert.ok(Engine.readsInput('int x; std::cin >> x;'));
  assert.ok(Engine.readsInput('std::getline(std::cin, line);'));
  assert.ok(!Engine.readsInput('// std::cin >> x;\nstd::cout << "use cin";'));
  assert.ok(!Engine.readsInput('/* cin */ int main() {}'));
});

test('answers typed with phone or autocorrect punctuation are still marked right', () => {
  const fill = (lang, blanks, typed) => Engine.checkAnswer({ type: 'fill', lang, blanks }, typed).ok;
  assert.ok(fill('js', [["'hi'"]], ['‘hi’']), 'curly single quotes');
  assert.ok(fill('cpp', [['"Hello"']], ['“Hello”']), 'curly double quotes');
  assert.ok(fill('js', [['i--']], ['i—']), 'two hyphens turned into a long dash');
  assert.ok(fill('js', [['a + b']], ['a + b']), 'non-breaking spaces');
  assert.ok(fill('js', [['map']], ['ma​p']), 'invisible characters');
  assert.ok(fill('js', [['(x)']], ['（x）']), 'full-width characters');
  // Quote styles mean the same in JavaScript, not in C++ (a char vs a string).
  assert.ok(fill('js', [["'hi'"]], ['"hi"']));
  assert.ok(fill('js', [["'hi'"]], ['`hi`']));
  assert.ok(!fill('cpp', [["'a'"]], ['"a"']));
  // HTML and CSS don't care about case outside quotes; JavaScript does.
  assert.ok(fill('css', [['text-align']], ['Text-Align']));
  assert.ok(!fill('js', [['log']], ['Log']));
  assert.ok(!fill('js', [['x']], ['   ']), 'an empty blank is never right');

  const output = (answer, typed) => Engine.checkAnswer({ type: 'output', answer }, typed).ok;
  assert.ok(output("It's fine", 'It’s fine'));
  assert.ok(output('Soup — 4', 'Soup - 4'), 'any dash for a dash');
  assert.ok(output('a\nb', '\n\na\nb\n'), 'blank lines around the answer');
  assert.ok(!output('a b', 'ab'), 'spacing inside a line still counts');

  // A difference is reported as it was really written.
  assert.deepStrictEqual(Engine.compareOutput('A — B\nx', 'A — B\ny'), { ok: false, line: 2, got: 'x', want: 'y' });
});

test('streak freezes cover one or two missed days, and count towards the streak', () => {
  const now = new Date('2026-09-25T12:00:00');
  const key = (n) => Engine.addDays('2026-09-25', -n);
  const days = {};
  [2, 3, 4, 5, 6, 7, 8].forEach((n) => { days[key(n)] = 10; });
  assert.strictEqual(Engine.streak(days, now), 0, 'yesterday was missed: the streak is broken');
  assert.deepStrictEqual(Engine.missedDays(days, {}, now), [key(1)]);
  const frozen = { [key(1)]: 'x' };
  assert.strictEqual(Engine.streak(days, now, frozen), 8);
  assert.deepStrictEqual(Engine.missedDays(days, frozen, now), []);
  // Three missed days is too many to save; nothing ever done has nothing to save.
  const old = { [key(4)]: 5, [key(5)]: 5 };
  assert.deepStrictEqual(Engine.missedDays(old, {}, now), []);
  assert.deepStrictEqual(Engine.missedDays({}, {}, now), []);
  // Freezes merge from two devices like the rest of the progress.
  const merged = Engine.mergeProgress({ frozen: { a: '2026-01-02' } }, { frozen: { a: '2026-01-01', b: '2026-01-03' } });
  assert.deepStrictEqual(merged.frozen, { a: '2026-01-01', b: '2026-01-03' });
});

test('retake cooldowns count from the latest attempt, and never lock for longer than the cooldown', () => {
  const now = Date.parse('2026-03-10T12:00:00Z');
  const minute = 60000;
  assert.strictEqual(Engine.cooldownLeft([], 30, now), 0, 'never taken: open');
  assert.strictEqual(Engine.cooldownLeft(['2026-03-10T11:50:00Z'], 30, now), 20 * minute);
  assert.strictEqual(Engine.cooldownLeft(['2026-03-10T11:00:00Z', '2026-03-10T11:58:00Z', undefined], 5, now), 3 * minute, 'the latest counts');
  assert.strictEqual(Engine.cooldownLeft(['2026-03-10T11:00:00Z'], 30, now), 0, 'long enough ago');
  assert.strictEqual(Engine.cooldownLeft(['2026-03-11T12:00:00Z'], 30, now), 30 * minute, 'a clock that jumped back locks for the cooldown at most');
  assert.strictEqual(Engine.cooldownLeft(['2026-03-10T11:59:00Z'], 0, now), 0, 'no cooldown');
  assert.strictEqual(Engine.cooldownLeft(['not a date'], 30, now), 0);
  assert.ok(Engine.COOLDOWN.exam > Engine.COOLDOWN.quiz, 'quizzes wait less than exams');
  assert.strictEqual(Engine.formatWait(4 * minute + 5000), '4:05');
  assert.strictEqual(Engine.formatWait(62 * minute + 9000), '1:02:09');
  assert.strictEqual(Engine.formatWait(400), '0:01', 'rounds up, so 0:00 means open');
  assert.strictEqual(Engine.XP.video, 10);
});

test('resetting one course drops only that course, everywhere, and stale copies cannot bring it back', () => {
  const before = '2026-01-01T10:00:00.000Z';
  const reset = '2026-01-02T10:00:00.000Z';
  const later = '2026-01-03T10:00:00.000Z';
  const old = Object.assign(Engine.emptyProgress(), {
    items: {
      'c3-intdiv': { status: 'done', xp: 20, at: before },
      'js2-variables': { status: 'done', xp: 20, at: before },
      'html1-web': { status: 'done', xp: 20, at: before },
      'final-exam': { status: 'done', xp: 100, at: before }
    },
    cards: { 'c3-intdiv#1': { due: '2026-01-05', at: before }, 'html1-web#1': { due: '2026-01-05', at: before } },
    mistakes: { 'js2-quiz1/q1': { count: 1, at: before } },
    exams: { 'ch03-exam': [{ score: 1, passed: true, at: before }] },
    unlocked: { ch04: before, html02: before },
    badges: { graduate: before, 'part-p1': before, 'graduate-html': before, 'lesson-1': before },
    stats: { runs: 50 },
    days: { '2026-01-01': 200 }
  });
  const cleared = Engine.mergeProgress(old, { resets: { cpp: reset, js: reset } });
  assert.deepStrictEqual(Object.keys(cleared.items), ['html1-web']);
  assert.deepStrictEqual(Object.keys(cleared.cards), ['html1-web#1']);
  assert.deepStrictEqual(cleared.mistakes, {});
  assert.deepStrictEqual(Object.keys(cleared.unlocked), ['html02']);
  assert.deepStrictEqual(Object.keys(cleared.badges).sort(), ['graduate-html', 'lesson-1']);
  assert.strictEqual(cleared.stats.runs, 50, 'counters stay unless they are reset too');

  // Another device still has the old copy: merging it changes nothing.
  assert.deepStrictEqual(Object.keys(Engine.mergeProgress(cleared, old).items), ['html1-web']);
  // Work done after the reset counts again.
  const redone = Engine.mergeProgress(cleared, { items: { 'c3-intdiv': { status: 'done', xp: 20, at: later } } });
  assert.ok(redone.items['c3-intdiv']);

  // A counters reset drops XP-by-day, stats and overall badges from stale copies too.
  const fresh = Engine.mergeProgress(old, { resets: { counters: reset } });
  assert.deepStrictEqual(fresh.stats, {});
  assert.deepStrictEqual(fresh.days, {});
  assert.ok(!fresh.badges['lesson-1'] && fresh.badges.graduate, 'overall badges go, course badges stay');
  assert.deepStrictEqual(Engine.mergeProgress(fresh, old).stats, {});
});

test('stars and saved lessons sync between devices: the latest click wins', () => {
  const t1 = '2026-02-01T10:00:00.000Z';
  const t2 = '2026-02-02T10:00:00.000Z';
  const reset = '2026-02-03T10:00:00.000Z';
  const phone = Object.assign(Engine.emptyProgress(), {
    starred: { ard: { on: true, at: t1 }, js: { on: true, at: t2 } },
    saved: { 'ard3-millis': { on: true, at: t1 }, 'c3-intdiv': { on: true, at: t1 } }
  });
  const laptop = Object.assign(Engine.emptyProgress(), {
    starred: { ard: { on: false, at: t2 }, css: { on: true, at: t1 } },
    saved: { 'html1-web': { on: true, at: t2 } }
  });
  const both = Engine.mergeProgress(phone, laptop);
  assert.deepStrictEqual(Object.keys(both.starred).filter((k) => both.starred[k].on).sort(), ['css', 'js'], 'unstarring later wins over an older star');
  assert.deepStrictEqual(Object.keys(both.saved).sort(), ['ard3-millis', 'c3-intdiv', 'html1-web']);
  assert.deepStrictEqual(Engine.mergeProgress(laptop, phone).starred, both.starred, 'the order of merging does not matter');

  // Resetting a course drops the lessons saved from it; its star stays.
  const cleared = Engine.mergeProgress(both, { resets: { ard: reset } });
  assert.deepStrictEqual(Object.keys(cleared.saved).sort(), ['c3-intdiv', 'html1-web']);
  assert.ok(cleared.starred.js.on);
});

test('every id in every course belongs to its own course', () => {
  const { loadCourseAt, courseDirs } = require('./web-course-lib.js');
  courseDirs().map((dir) => loadCourseAt(dir).course).forEach((course) => {
    const ids = [].concat(
      course.items.map((i) => i.id),
      course.chapters.map((c) => c.id),
      course.parts.map((p) => 'part-' + p.id),
      Object.keys(course.questions),
      course.cards.map((c) => c.id),
      [course.id === 'cpp' ? 'graduate' : 'graduate-' + course.id]
    );
    course.items.forEach((i) => (i.tasks || []).concat(i.milestones || []).forEach((t) => ids.push(t.id)));
    ids.forEach((id) => assert.strictEqual(Engine.courseOf(id), course.id, `${id} is in ${course.id}`));
  });
  ['lesson-1', 'hello', 'streak-7'].forEach((id) => assert.strictEqual(Engine.courseOf(id), ''));
});
