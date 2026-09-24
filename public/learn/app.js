/*
 * Learn mode: a C++ course inside Actually Useful.
 *
 * The course text lives in course/*.yml; this file turns it into pages —
 * lessons with runnable examples, quick checks, coding tasks, quizzes, exams,
 * challenges, projects, spaced-repetition review, a playground — and keeps
 * your progress (on this device at once, and on the server so it follows you).
 */
(function () {
  'use strict';

  const Engine = window.LearnEngine;
  const Course = window.LearnCourse;
  const MD = window.LearnMarkdown;
  const Explain = window.LearnExplain;
  const MiniEditor = window.MiniEditor;

  const STORE_KEY = 'au-learn-progress-v1';
  const LINE_PX = 21.6;
  const DAILY_GOAL = 60;

  const main = document.getElementById('main');
  const outline = document.getElementById('outline');
  const syncState = document.getElementById('sync-state');

  let course = null;
  let P = Engine.emptyProgress();
  let compiler = { available: true, pending: true };
  let view = { cleanup: [], guard: null };

  // ================================================================ utilities

  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach((k) => {
        const v = props[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'class') el.className = v;
        else if (k === 'html') el.innerHTML = v;
        else if (k === 'text') el.textContent = v;
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else el.setAttribute(k, v === true ? '' : v);
      });
    }
    append(el, kids);
    return el;
  }

  function append(el, kids) {
    (Array.isArray(kids) ? kids : [kids]).forEach((kid) => {
      if (kid === null || kid === undefined || kid === false) return;
      if (Array.isArray(kid)) { append(el, kid); return; }
      el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    });
  }

  const esc = MD.escapeHtml;
  const iso = () => new Date().toISOString();
  const today = () => Engine.dayKey();
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const plural = (n, word, many) => n + ' ' + (n === 1 ? word : (many || word + 's'));
  const pct = (x) => Math.round(x * 100) + '%';

  function md(text, hooks) {
    return h('div', { class: 'prose', html: MD.render(text, hooks || { code: staticCode }) });
  }

  function mdInline(text) {
    return h('span', { html: MD.inline(text) });
  }

  function highlight(code) {
    return MiniEditor.highlight('cpp', code);
  }

  function staticCode(lang, flags, code) {
    if (lang === 'cpp' || lang === 'c++') return '<pre class="q-code">' + highlight(code) + '</pre>';
    return '<pre class="plain">' + esc(code) + '</pre>';
  }

  function toast(message, kind, ms) {
    const node = h('div', { class: 'toast' + (kind ? ' is-' + kind : ''), html: message });
    document.getElementById('toasts').appendChild(node);
    setTimeout(() => node.remove(), ms || 4200);
  }

  function celebrate(icon, title, text, action) {
    const layer = h('div', { class: 'celebrate', role: 'dialog', 'aria-modal': 'true' });
    const close = () => layer.remove();
    layer.append(h('div', { class: 'celebrate-card' },
      h('div', { class: 'c-icon' }, icon),
      h('h2', null, title),
      h('p', { html: MD.inline(text) }),
      h('div', { class: 'row-actions', style: { justifyContent: 'center' } },
        action ? h('button', { class: 'btn btn-primary', onclick: () => { close(); action.run(); } }, action.label) : null,
        h('button', { class: 'btn', onclick: close }, action ? 'Later' : 'Nice!'))));
    layer.addEventListener('click', (e) => { if (e.target === layer) close(); });
    document.body.appendChild(layer);
    const first = layer.querySelector('button');
    if (first) first.focus();
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => toast('Copied', 'ok', 1500), () => toast('Could not copy', 'err'));
    }
  }

  function typeIcon(type) {
    return { lesson: '📖', quiz: '❓', challenge: '🧩', review: '🔁', exam: '🎓', project: '🏗️' }[type] || '•';
  }

  function typeName(type) {
    return { lesson: 'Lesson', quiz: 'Quiz', challenge: 'Challenge', review: 'Review', exam: 'Exam', project: 'Project' }[type] || type;
  }

  function stars(n) {
    const out = h('span', { class: 'stars', title: ['', 'Warm-up', 'Solid', 'Hard'][n] || '' });
    for (let i = 1; i <= 3; i += 1) out.append(h('span', { class: i <= n ? '' : 'off' }, '★'));
    return out;
  }

  // ================================================================ progress

  function loadLocal() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* private mode or corrupt: start empty */ }
    return null;
  }

  function persistLocal() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(P)); } catch (e) { /* storage full or blocked */ }
  }

  const sync = { dirty: false, timer: null, busy: false, storage: null, online: null };

  function setSync(state, text) {
    syncState.className = 'lt-side-foot is-' + state;
    syncState.textContent = text;
  }

  async function pull() {
    try {
      const res = await fetch('/api/learn/progress', { cache: 'no-store' });
      if (res.status === 401) { signIn(); return; }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      sync.storage = data.storage;
      const merged = Engine.mergeProgress(P, data.progress);
      const serverHasAll = JSON.stringify(Engine.mergeProgress(data.progress, {})) === JSON.stringify(merged);
      P = merged;
      persistLocal();
      sync.online = true;
      if (!serverHasAll) { sync.dirty = true; push(); } else setSync('ok', syncLabel());
    } catch (e) {
      sync.online = false;
      setSync('off', 'Offline — progress is saved on this device');
    }
  }

  function syncLabel() {
    return sync.storage === 'github' ? 'Progress synced to GitHub' : 'Progress saved on the server';
  }

  async function push() {
    if (sync.busy || !sync.dirty) return;
    sync.busy = true;
    sync.dirty = false;
    setSync('busy', 'Saving progress…');
    try {
      const res = await fetch('/api/learn/progress', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ progress: P })
      });
      if (res.status === 401) { signIn(); return; }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      sync.storage = data.storage;
      P = Engine.mergeProgress(P, data.progress);
      persistLocal();
      sync.online = true;
      setSync('ok', syncLabel());
    } catch (e) {
      sync.dirty = true;
      sync.online = false;
      setSync('off', 'Not synced yet — saved on this device');
    } finally {
      sync.busy = false;
      if (sync.dirty) schedulePush(15000);
    }
  }

  function schedulePush(ms) {
    clearTimeout(sync.timer);
    sync.timer = setTimeout(push, ms);
  }

  /** Records a change: stored locally at once, sent to the server shortly. */
  function save(options) {
    P.updatedAt = iso();
    persistLocal();
    sync.dirty = true;
    schedulePush(6000);
    if (!(options && options.quiet)) afterChange();
  }

  function signIn() {
    location.href = '/login?next=' + encodeURIComponent(location.pathname + location.hash);
  }

  function rec(id) { return P.items[id] || null; }
  function isDone(id) { const r = P.items[id]; return Boolean(r && r.status === 'done'); }

  function touch(id, patch) {
    const cur = P.items[id] || { status: 'started', attempts: 0, best: 0, xp: 0 };
    P.items[id] = Object.assign({}, cur, patch || {}, { at: iso() });
    return P.items[id];
  }

  /** Marks something finished, crediting only XP it has not earned before. */
  function complete(id, opts) {
    opts = opts || {};
    const cur = P.items[id] || { attempts: 0, best: 0, xp: 0 };
    const xp = Math.round(opts.xp || 0);
    const gained = Math.max(0, xp - (cur.xp || 0));
    P.items[id] = Object.assign({}, cur, opts.extra || {}, {
      status: 'done',
      best: Math.max(cur.best || 0, opts.best === undefined ? 1 : opts.best),
      xp: Math.max(cur.xp || 0, xp),
      at: iso(),
      doneAt: cur.doneAt || iso()
    });
    if (gained) addDayXp(gained);
    const hour = new Date().getHours();
    if (hour >= 0 && hour < 4) bump('nightOwl');
    return gained;
  }

  function addDayXp(xp) {
    const key = today();
    P.days[key] = (P.days[key] || 0) + xp;
  }

  function bump(stat, by) {
    P.stats[stat] = (Number(P.stats[stat]) || 0) + (by || 1);
  }

  function totalXp() { return Engine.totalXp(P); }

  // ================================================================ course logic

  function examOf(ch) { return ch.items.find((i) => i.type === 'exam'); }
  function chapterAt(i) { return course.chapters[i]; }
  function indexOfChapter(ch) { return course.chapters.indexOf(ch); }

  function isUnlocked(ch) {
    const i = indexOfChapter(ch);
    if (i <= 0 || P.unlocked[ch.id]) return true;
    const prev = chapterAt(i - 1);
    const gate = examOf(prev);
    if (gate) return isDone(gate.id);
    return prev.items.every((it) => it.type === 'challenge' || isDone(it.id));
  }

  function chapterStats(ch) {
    const of = (type) => ch.items.filter((i) => i.type === type);
    const frac = (list) => (list.length ? list.filter((i) => isDone(i.id)).length / list.length : null);
    const lessons = of('lesson');
    const quizzes = of('quiz').concat(of('review'));
    const challenges = of('challenge');
    const projects = of('project');
    const exam = examOf(ch);
    const examRec = exam ? rec(exam.id) : null;
    const examScore = exam ? (isDone(exam.id) ? 1 : ((examRec && examRec.best) || 0) * 0.6) : null;
    const parts = [
      [0.4, frac(lessons)], [0.1, frac(quizzes)], [0.2, frac(challenges)],
      [0.1, frac(projects)], [0.2, examScore]
    ].filter((p) => p[1] !== null);
    const weight = parts.reduce((s, p) => s + p[0], 0) || 1;
    const mastery = parts.reduce((s, p) => s + p[0] * p[1], 0) / weight;
    return {
      lessons: [lessons.filter((i) => isDone(i.id)).length, lessons.length],
      challenges: [challenges.filter((i) => isDone(i.id)).length, challenges.length],
      exam,
      examPassed: exam ? isDone(exam.id) : false,
      mastery,
      mastered: (!exam || isDone(exam.id)) && lessons.every((i) => isDone(i.id))
    };
  }

  /** The next thing to do on the main path (challenges are extra practice). */
  function nextUp() {
    for (const ch of course.chapters) {
      if (!isUnlocked(ch)) return null;
      for (const item of ch.items) {
        if (item.type === 'challenge') continue;
        if (!isDone(item.id)) return item;
      }
    }
    return null;
  }

  function neighbours(item) {
    const all = course.items;
    const i = all.indexOf(item);
    return { prev: all[i - 1] || null, next: all[i + 1] || null };
  }

  function itemLabel(item) {
    const ch = item.chapter;
    if (item.type === 'lesson') {
      const n = ch.items.filter((i) => i.type === 'lesson').indexOf(item) + 1;
      return 'Lesson ' + ch.number + '.' + n;
    }
    return typeName(item.type);
  }

  function dueCards() {
    const now = today();
    return Object.keys(P.cards).filter((id) => P.cards[id] && P.cards[id].due <= now && cardById(id));
  }

  let cardIndex = null;
  function cardById(id) {
    if (!cardIndex) {
      cardIndex = {};
      course.cards.forEach((c) => { cardIndex[c.id] = c; });
    }
    return cardIndex[id] || null;
  }

  function openMistakes() {
    return Object.keys(P.mistakes).filter((id) => {
      const m = P.mistakes[id];
      return m && !m.cleared && course.questions[id];
    });
  }

  // ================================================================ badges

  function counts() {
    const done = (type) => course.items.filter((i) => i.type === type && isDone(i.id));
    const exams = course.items.filter((i) => i.type === 'exam');
    return {
      lessons: done('lesson').length,
      challenges: done('challenge'),
      projects: done('project').length,
      exams: done('exam').length,
      perfect: exams.some((e) => (P.exams[e.id] || []).some((a) => a.score >= 1)),
      streak: Engine.streak(P.days),
      reviews: Number(P.stats.reviews) || 0,
      runs: Number(P.stats.runs) || 0,
      compileErrors: Number(P.stats.compileErrors) || 0,
      cleared: Number(P.stats.cleared) || 0,
      notes: Object.keys(P.notes).filter((k) => P.notes[k] && P.notes[k].text && P.notes[k].text.trim()).length
    };
  }

  function badgeList() {
    const list = [
      { id: 'hello', icon: '👋', name: 'Hello, World', desc: 'Ran your first program', test: (c) => c.runs >= 1 },
      { id: 'first-error', icon: '🧯', name: 'Met the Compiler', desc: 'Got your first compile error — every programmer does, daily', test: (c) => c.compileErrors >= 1 },
      { id: 'lesson-1', icon: '📘', name: 'First Lesson', desc: 'Completed a lesson', test: (c) => c.lessons >= 1 },
      { id: 'lesson-10', icon: '📚', name: 'Bookworm', desc: 'Completed 10 lessons', test: (c) => c.lessons >= 10 },
      { id: 'lesson-50', icon: '🏛️', name: 'Scholar', desc: 'Completed 50 lessons', test: (c) => c.lessons >= 50 },
      { id: 'challenge-1', icon: '🧩', name: 'Problem Solver', desc: 'Solved a challenge', test: (c) => c.challenges.length >= 1 },
      { id: 'challenge-10', icon: '⚙️', name: 'Tinkerer', desc: 'Solved 10 challenges', test: (c) => c.challenges.length >= 10 },
      { id: 'challenge-40', icon: '🚀', name: 'Machine', desc: 'Solved 40 challenges', test: (c) => c.challenges.length >= 40 },
      { id: 'hard-1', icon: '💎', name: 'Diamond Mind', desc: 'Solved a ★★★ challenge', test: (c) => c.challenges.some((i) => i.difficulty >= 3) },
      { id: 'no-hints', icon: '🥷', name: 'No Hints Needed', desc: 'Solved a ★★+ challenge without hints or the solution', test: (c) => c.challenges.some((i) => i.difficulty >= 2 && !(rec(i.id) || {}).helped) },
      { id: 'exam-1', icon: '🎓', name: 'Examined', desc: 'Passed your first exam', test: (c) => c.exams >= 1 },
      { id: 'exam-perfect', icon: '💯', name: 'Flawless', desc: 'Scored 100% on an exam', test: (c) => c.perfect },
      { id: 'project-1', icon: '🏗️', name: 'Builder', desc: 'Finished a project', test: (c) => c.projects >= 1 },
      { id: 'streak-3', icon: '🔥', name: 'On Fire', desc: 'Learned 3 days in a row', test: (c) => c.streak >= 3 },
      { id: 'streak-7', icon: '📅', name: 'Week Warrior', desc: 'Learned 7 days in a row', test: (c) => c.streak >= 7 },
      { id: 'streak-30', icon: '⚡', name: 'Unstoppable', desc: 'Learned 30 days in a row', test: (c) => c.streak >= 30 },
      { id: 'reviews-50', icon: '🧠', name: 'Memory Palace', desc: 'Reviewed 50 flashcards', test: (c) => c.reviews >= 50 },
      { id: 'reviews-500', icon: '🗝️', name: 'Total Recall', desc: 'Reviewed 500 flashcards', test: (c) => c.reviews >= 500 },
      { id: 'mistakes-10', icon: '🔁', name: 'Learns from Mistakes', desc: 'Cleared 10 questions from your mistake bank', test: (c) => c.cleared >= 10 },
      { id: 'notes-5', icon: '✍️', name: 'Note Taker', desc: 'Wrote notes on 5 lessons', test: (c) => c.notes >= 5 },
      { id: 'night-owl', icon: '🦉', name: 'Night Owl', desc: 'Finished something after midnight', test: () => (Number(P.stats.nightOwl) || 0) >= 1 }
    ];
    course.parts.forEach((part) => {
      list.push({
        id: 'part-' + part.id,
        icon: '🏆',
        name: part.title,
        desc: 'Mastered every chapter in ' + part.title,
        test: () => part.chapters.length > 0 && part.chapters.every((ch) => chapterStats(ch).mastered)
      });
    });
    list.push({ id: 'graduate', icon: '👑', name: 'C++ Graduate', desc: 'Passed the final exam', test: () => isDone('final-exam') });
    return list;
  }

  let lastLevel = null;

  function afterChange() {
    const c = counts();
    badgeList().forEach((b) => {
      if (P.badges[b.id]) return;
      let earned = false;
      try { earned = b.test(c); } catch (e) { earned = false; }
      if (earned) {
        P.badges[b.id] = iso();
        persistLocal();
        toast('<b>' + b.icon + ' Badge earned: ' + esc(b.name) + '</b><br>' + esc(b.desc), 'ok', 5500);
      }
    });
    const level = Engine.levelFor(totalXp());
    if (lastLevel !== null && level.level > lastLevel) {
      celebrate('⭐', 'Level ' + level.level + ': ' + level.title, 'You now have **' + totalXp() + ' XP**. Keep going!');
    }
    lastLevel = level.level;
    refreshChrome();
  }

  function refreshChrome() {
    if (!course) return;
    const level = Engine.levelFor(totalXp());
    const lv = document.getElementById('level');
    lv.textContent = 'Lv ' + level.level + ' · ' + level.xp + ' XP';
    lv.title = level.title + (level.next ? ' — ' + (level.next - level.xp) + ' XP to the next level' : '');
    const s = Engine.streak(P.days);
    const streakEl = document.getElementById('streak');
    streakEl.textContent = '🔥 ' + s;
    streakEl.classList.toggle('is-hot', s > 0 && Boolean(P.days[today()]));
    const due = dueCards().length + openMistakes().length;
    const dueEl = document.getElementById('due-count');
    dueEl.textContent = String(due);
    dueEl.className = 'pill' + (due ? '' : ' pill-quiet');
    renderOutline();
  }

  // ================================================================ running C++

  async function loadCompilerStatus() {
    try {
      const res = await fetch('/api/cpp/status', { cache: 'no-store' });
      if (res.status === 401) { signIn(); return; }
      compiler = await res.json();
    } catch (e) {
      compiler = { available: false, reason: 'The server could not be reached.' };
    }
  }

  async function runCpp(payload) {
    let res;
    try {
      res = await fetch('/api/cpp/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } catch (e) {
      throw new Error('Could not reach the server. Are you online?');
    }
    if (res.status === 401) { signIn(); throw new Error('Please sign in again.'); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || ('The server answered ' + res.status));
    bump('runs');
    if (data.compile && !data.compile.ok) bump('compileErrors');
    save();
    return data;
  }

  function spinner(text) {
    return h('div', { class: 'out-spin' }, h('span', { class: 'spinner' }), text || 'Compiling and running…');
  }

  /** Compiler messages, filtered and explained, as DOM. */
  function diagnosticsView(output, editor, options) {
    options = options || {};
    const wrap = h('div');
    let diags = Explain.diagnostics(output).filter((d) => d.severity !== 'note');
    // Warnings inside the checker are noise; its errors mean a signature mismatch.
    diags = diags.filter((d) => !(d.file === 'checks.cpp' && d.severity === 'warning'));
    const errors = diags.filter((d) => d.severity === 'error');
    const warnings = diags.filter((d) => d.severity === 'warning');
    const shown = (options.warningsOnly ? warnings : errors.concat(warnings)).slice(0, 6);

    shown.forEach((d) => {
      const inChecker = d.file === 'checks.cpp';
      const box = h('div', { class: 'diag' + (d.severity === 'warning' ? ' is-warning' : '') });
      const head = h('div', { class: 'diag-head' });
      if (d.line && !inChecker) {
        head.append(h('button', {
          class: 'diag-line',
          title: editor ? 'Jump to this line' : '',
          onclick: () => { if (editor) { editor.gotoLine(d.line); editor.focus(); } }
        }, 'line ' + d.line));
      } else if (inChecker) {
        head.append(h('span', { class: 'diag-line' }, 'checker'));
      }
      head.append(h('span', null, (d.severity === 'warning' ? 'warning: ' : 'error: ') + d.message));
      box.append(head);
      if (d.detail) box.append(h('pre', { class: 'diag-detail' }, d.detail));
      let hint = d.hint;
      if (inChecker && !hint) {
        hint = 'The checker could not use your code as written. Make sure the function\'s **name**, **parameters** and **return type** are exactly as the task asks.';
      }
      if (hint) box.append(h('div', { class: 'diag-hint', html: MD.inline(hint) }));
      wrap.append(box);
    });

    const hidden = (options.warningsOnly ? warnings.length : errors.length + warnings.length) - shown.length;
    if (hidden > 0) wrap.append(h('p', { class: 'out-mismatch' }, '…and ' + plural(hidden, 'more message') + '. Fix the first one first — later ones are often caused by it.'));
    if (!options.warningsOnly) {
      wrap.append(h('details', { class: 'raw-toggle' },
        h('summary', null, 'Show the compiler\'s full output'),
        h('pre', null, output)));
    }
    return wrap;
  }

  /**
   * Shows how a run went: compile errors, warnings, output, what went wrong.
   * @param {HTMLElement} box
   * @param {object} data   the /api/cpp/run reply
   * @param {{expected?: string, editor?: MiniEditor, run?: number}} opts
   */
  function showRun(box, data, opts) {
    opts = opts || {};
    box.innerHTML = '';
    if (!data.compile.ok) {
      box.append(h('div', { class: 'out-head' }, h('b', { style: { color: 'var(--err)' } }, 'Didn\'t compile'),
        h('span', { class: 'out-time' }, 'Read the first error — it is usually the real one')));
      box.append(diagnosticsView(data.compile.output, opts.editor));
      return;
    }
    const run = data.runs[opts.run || 0] || {};
    if (data.compile.output && /warning:/.test(data.compile.output)) {
      const warns = diagnosticsView(data.compile.output, opts.editor, { warningsOnly: true });
      if (warns.childNodes.length) {
        box.append(h('details', { class: 'raw-toggle', style: { marginTop: '10px' } },
          h('summary', null, '⚠ The compiler has warnings — worth reading'), warns));
      }
    }
    box.append(h('div', { class: 'out-head' }, h('b', null, 'Output'),
      h('span', { class: 'out-time' }, (data.compile.cached ? 'cached build · ' : data.compile.ms ? 'built in ' + data.compile.ms + ' ms · ' : '') + 'ran in ' + (run.ms || 0) + ' ms')));
    const printed = run.stdout || '';
    box.append(h('pre', { class: 'out-text' + (printed ? '' : ' is-empty') }, printed || '(the program printed nothing)'));
    if (run.stderr) box.append(h('pre', { class: 'out-text out-err' }, run.stderr));
    const why = Explain.runtime(run);
    if (why) box.append(h('div', { class: 'out-note', html: MD.inline(why) }));
    if (typeof opts.expected === 'string') {
      const cmp = Engine.compareOutput(printed, opts.expected);
      if (cmp.ok) box.append(h('div', { class: 'out-match' }, '✓ Matches the expected output'));
      else if (!opts.quietMismatch) {
        box.append(h('div', { class: 'out-mismatch' }, 'Differs from the original output at line ' + cmp.line +
          (opts.edited ? ' — fine if you changed the code on purpose.' : '.')));
      }
    }
  }

  function showRunError(box, err) {
    box.innerHTML = '';
    box.append(h('div', { class: 'out-note' }, err.message || String(err)));
  }

  function compilerBanner() {
    if (compiler.available || compiler.pending) return null;
    return h('div', { class: 'banner', html: MD.inline('**C++ can\'t run on this server right now.** ' + esc(compiler.reason || '') +
      ' You can still read, answer quizzes and review. To run code, the server needs `g++` or internet access to godbolt.org — see the README.') });
  }

  // ================================================================ editors

  /** A C++ editor that grows with its content. */
  function codeEditor(value, opts) {
    opts = opts || {};
    const host = h('div', { class: 'ed-host' });
    let ed = null;
    const fit = () => {
      const n = MiniEditor.text.countNewlines(ed.getValue()) + 1;
      const lines = clamp(n + 1, opts.minLines || 5, opts.maxLines || 26);
      host.style.height = Math.round(lines * LINE_PX + 28) + 'px';
      ed.refresh();
    };
    ed = new MiniEditor(host, {
      mode: 'cpp',
      value: value || '',
      ariaLabel: opts.label || 'C++ code',
      onChange: () => { fit(); if (opts.onChange) opts.onChange(ed.getValue()); }
    });
    host.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        if (opts.onRun) opts.onRun();
      }
    }, true);
    requestAnimationFrame(fit);
    return { host, ed, fit, set: (text) => { ed.setValue(text); fit(); } };
  }

  // ================================================================ examples

  function exampleWidget(code, flags, extras) {
    const isStatic = flags.indexOf('static') !== -1;
    const isError = flags.indexOf('error') !== -1;
    const fig = h('figure', { class: 'ex' });
    const out = h('div', { class: 'out' });
    let editor = null;
    let stdinBox = null;
    const codeView = h('pre', { class: 'ex-code', html: highlight(code) });
    const codeSlot = h('div', null, codeView);

    const label = isStatic ? 'Snippet' : isError ? 'Has an error on purpose — run it and read the message' : 'Example';
    const runBtn = h('button', { class: 'mini-btn is-run', title: 'Run (Ctrl+Enter while editing)' }, '▶ Run');
    const editBtn = h('button', { class: 'mini-btn' }, 'Edit');
    const bar = h('div', { class: 'ex-bar' },
      h('span', { class: 'ex-label' + (isError ? ' is-error' : '') }, label));
    if (!isStatic) bar.append(runBtn, editBtn);
    bar.append(h('button', { class: 'mini-btn', title: 'Copy the code', onclick: () => copyText(editor ? editor.ed.getValue() : code) }, 'Copy'));
    if (!isStatic) {
      bar.append(h('button', {
        class: 'mini-btn',
        title: 'Open a copy in the Playground',
        onclick: () => openInPlayground(editor ? editor.ed.getValue() : code, stdinBox ? stdinBox.value : (extras.stdin || ''))
      }, 'Playground'));
    }
    fig.append(bar, codeSlot);

    const needsInput = extras.stdin !== undefined || (!isStatic && Engine.readsInput(code));
    let stdinView = null;
    if (needsInput) {
      stdinView = h('div', { class: 'ex-io ex-stdin' }, h('div', { class: 'ex-io-label' }, 'Input (what you type)'));
      if (extras.stdin !== undefined) stdinView.append(h('pre', null, extras.stdin));
      else {
        stdinBox = h('textarea', { spellcheck: 'false', placeholder: 'This program reads input — type it here, one value per line or separated by spaces.' });
        stdinView.append(stdinBox);
      }
      fig.append(stdinView);
    }
    if (extras.output !== undefined) {
      fig.append(h('div', { class: 'ex-io' }, h('div', { class: 'ex-io-label' }, 'Output'), h('pre', null, extras.output)));
    }
    fig.append(out);

    const run = async () => {
      if (!compiler.available && !compiler.pending) { toast('C++ can\'t run on this server right now.', 'err'); return; }
      const source = editor ? editor.ed.getValue() : code;
      const stdin = stdinBox ? stdinBox.value : (extras.stdin || '');
      runBtn.disabled = true;
      out.innerHTML = '';
      out.append(spinner());
      try {
        const data = await runCpp({ source, stdin });
        const edited = source !== code;
        showRun(out, data, {
          editor: editor && editor.ed,
          expected: extras.output,
          edited,
          quietMismatch: false
        });
      } catch (err) {
        showRunError(out, err);
      } finally {
        runBtn.disabled = false;
      }
    };
    runBtn.addEventListener('click', run);

    editBtn.addEventListener('click', () => {
      if (!editor) {
        editor = codeEditor(code, { onRun: run, minLines: 4 });
        codeSlot.replaceChildren(editor.host);
        editor.fit();
        editor.ed.focus();
        if (extras.stdin !== undefined && stdinView) {
          stdinBox = h('textarea', { spellcheck: 'false' });
          stdinBox.value = extras.stdin;
          stdinView.querySelector('pre').replaceWith(stdinBox);
        }
        editBtn.textContent = 'Reset';
        editBtn.title = 'Put the original code back';
      } else {
        editor.set(code);
        if (stdinBox && extras.stdin !== undefined) stdinBox.value = extras.stdin;
        out.innerHTML = '';
      }
    });
    return fig;
  }

  // ================================================================ questions

  const LETTERS = 'ABCDEFGH';

  /**
   * One question.
   * mode 'instant': has its own Check button and explains itself at once.
   * mode 'deferred': the owner (an exam) grades and reveals it later.
   */
  function questionWidget(q, opts) {
    opts = opts || {};
    const mode = opts.mode || 'instant';
    const box = h('section', { class: 'q' + (q.multi ? ' multi' : ''), 'data-q': q.id });
    const kickerState = h('span', { class: 'q-state' });
    const kicker = h('div', { class: 'q-kicker' },
      h('span', null, opts.kicker || kickerFor(q)), kickerState);
    box.append(kicker);
    if (q.prompt) box.append(h('div', { class: 'q-prompt' }, md(q.prompt)));

    const feedback = h('div');
    const actions = h('div', { class: 'q-actions' });
    let revealed = false;
    let firstTry = true;
    let impl;

    const api = {
      el: box,
      q,
      answered: () => impl.answered(),
      response: () => impl.response(),
      grade: () => impl.grade(),
      reveal: (result) => reveal(result),
      revealed: () => revealed
    };

    function reveal(result) {
      revealed = true;
      box.classList.toggle('is-right', result.ok);
      box.classList.toggle('is-wrong', !result.ok);
      kickerState.textContent = result.ok ? '✓ Correct' : '✗ Not quite';
      if (impl.lock) impl.lock(result);
      feedback.innerHTML = '';
      const fb = h('div', { class: 'q-feedback ' + (result.ok ? 'is-right' : 'is-wrong') },
        h('div', { class: 'q-feedback-title' }, result.ok ? pick(['Correct!', 'Exactly right.', 'Yes!', 'Nailed it.']) : 'Not quite.'));
      if (impl.expected && !result.ok) fb.append(impl.expected());
      if (q.why) fb.append(md(q.why));
      if (impl.after) fb.append(impl.after());
      feedback.append(fb);
    }

    const check = h('button', { class: 'mini-btn is-primary', disabled: true }, 'Check');
    const onInput = () => { check.disabled = !impl.answered() || revealed; };

    check.addEventListener('click', async () => {
      if (!impl.answered() || revealed) return;
      check.disabled = true;
      const result = await impl.grade();
      reveal(result);
      check.remove();
      if (opts.onAnswered) opts.onAnswered(result, firstTry);
      firstTry = false;
    });

    // A code question checks itself; in a quiz or lesson that counts as answering.
    const onCodeChecked = (result) => {
      if (mode !== 'instant') return;
      box.classList.toggle('is-right', result.ok);
      box.classList.toggle('is-wrong', !result.ok);
      kickerState.textContent = result.ok ? '✓ Solved' : '✗ Not yet';
      if (opts.onAnswered) opts.onAnswered(result, firstTry);
      firstTry = false;
    };

    impl = buildQuestion(q, box, onInput, Object.assign({}, opts, { onCodeChecked }));
    if (mode === 'instant' && q.type !== 'code') {
      actions.append(check);
      box.append(actions);
    }
    box.append(feedback);
    return api;
  }

  function pick(list) { return list[Math.floor(Math.random() * list.length)]; }

  function kickerFor(q) {
    return {
      mcq: q.multi ? 'Choose all that apply' : 'Choose one',
      tf: 'True or false?',
      output: 'Predict the output',
      fill: 'Fill in the blanks',
      order: 'Put the lines in order',
      spot: 'Find the bug',
      code: 'Write the code'
    }[q.type] || 'Question';
  }

  function buildQuestion(q, box, changed, opts) {
    switch (q.type) {
      case 'mcq': return buildChoice(q, box, changed, q.options, q.multi);
      case 'tf': return buildChoice(q, box, changed, ['True', 'False'], false, true);
      case 'output': return buildOutput(q, box, changed);
      case 'fill': return buildFill(q, box, changed);
      case 'order': return buildOrder(q, box, changed);
      case 'spot': return buildSpot(q, box, changed);
      case 'code': return buildCodeQuestion(q, box, changed, opts);
      default:
        box.append(h('p', null, 'Unknown question type.'));
        return { answered: () => false, response: () => null, grade: () => ({ ok: false }) };
    }
  }

  function buildChoice(q, box, changed, options, multi, tf) {
    if (q.code) box.append(h('pre', { class: 'q-code', html: highlight(q.code) }));
    const chosen = new Set();
    const wrap = h('div', { class: tf ? 'tf-row' : 'q-options' });
    const buttons = options.map((text, i) => {
      const btn = h('button', { class: 'q-option', type: 'button' },
        tf ? null : h('span', { class: 'q-letter' }, LETTERS[i]),
        h('span', { html: MD.inline(String(text)) }));
      btn.addEventListener('click', () => {
        if (multi) {
          if (chosen.has(i)) chosen.delete(i); else chosen.add(i);
        } else {
          chosen.clear();
          chosen.add(i);
        }
        buttons.forEach((b, j) => b.classList.toggle('is-picked', chosen.has(j)));
        changed();
      });
      wrap.append(btn);
      return btn;
    });
    box.append(wrap);
    const response = () => {
      const list = Array.from(chosen).sort();
      if (tf) return list.length ? list[0] === 0 : null;
      return multi ? list : list[0];
    };
    return {
      answered: () => chosen.size > 0,
      response,
      grade: () => Engine.checkAnswer(q, response()),
      lock: () => {
        const right = tf ? [q.answer ? 0 : 1] : [].concat(q.answer);
        buttons.forEach((b, j) => {
          b.disabled = true;
          b.classList.remove('is-picked');
          if (right.indexOf(j) !== -1) b.classList.add('is-right');
          else if (chosen.has(j)) b.classList.add('is-wrong');
        });
      }
    };
  }

  function buildOutput(q, box, changed) {
    box.append(h('pre', { class: 'q-code', html: highlight(q.code) }));
    if (q.stdin) box.append(h('div', { class: 'ex-io-label', style: { padding: '0 0 4px' } }, 'Input typed by the user'), h('pre', { class: 'q-expected' }, q.stdin));
    const area = h('textarea', {
      class: 'q-answer-box',
      spellcheck: 'false',
      placeholder: 'Type exactly what it prints. Each line of output on its own line.'
    });
    area.addEventListener('input', changed);
    box.append(area);
    return {
      answered: () => area.value.trim() !== '' || q.answer.trim() === '',
      response: () => area.value,
      grade: () => Engine.checkAnswer(q, area.value),
      lock: () => { area.readOnly = true; },
      expected: () => h('div', null, h('div', { style: { fontSize: '13px', color: 'var(--text-dim)' } }, 'It prints:'),
        h('pre', { class: 'q-expected' }, q.answer || '(nothing)')),
      after: () => {
        const out = h('div', { class: 'out', style: { borderRadius: '6px', marginTop: '8px' } });
        const btn = h('button', { class: 'mini-btn is-run' }, '▶ Run it and see');
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          out.replaceChildren(spinner());
          try { showRun(out, await runCpp({ source: q.code, stdin: q.stdin }), { expected: q.answer }); } catch (err) { showRunError(out, err); }
          btn.disabled = false;
        });
        return h('div', { style: { marginTop: '10px' } }, btn, out);
      }
    };
  }

  function buildFill(q, box, changed) {
    const parts = q.code.split('___');
    let marked = '';
    parts.forEach((part, i) => {
      marked += part;
      if (i < parts.length - 1) marked += '__AUBLANK' + i + '__';
    });
    let html = highlight(marked);
    const inputs = [];
    html = html.replace(/__AUBLANK(\d+)__/g, (_, i) => '<input class="blank" data-i="' + i + '" spellcheck="false" autocomplete="off" autocapitalize="off">');
    const pre = h('pre', { class: 'q-code fill-code', html });
    pre.querySelectorAll('input.blank').forEach((input) => {
      const i = Number(input.dataset.i);
      const size = Math.max(3, ...q.blanks[i].map((a) => a.length)) + 1;
      input.style.width = size + 'ch';
      input.setAttribute('aria-label', 'Blank ' + (i + 1));
      input.addEventListener('input', changed);
      inputs[i] = input;
    });
    box.append(pre);
    const response = () => inputs.map((x) => x.value);
    return {
      answered: () => inputs.every((x) => x.value.trim() !== ''),
      response,
      grade: () => Engine.checkAnswer(q, response()),
      lock: () => {
        inputs.forEach((input, i) => {
          input.readOnly = true;
          const ok = q.blanks[i].some((a) => Engine.squash(a) === Engine.squash(input.value));
          input.classList.add(ok ? 'is-right' : 'is-wrong');
        });
      },
      expected: () => h('div', null, h('div', { style: { fontSize: '13px', color: 'var(--text-dim)' } }, 'One right answer:'),
        h('pre', { class: 'q-expected', html: highlight(fillIn(q.code, q.blanks.map((b) => b[0]))) }))
    };
  }

  function fillIn(code, answers) {
    const parts = code.split('___');
    return parts.map((p, i) => p + (i < answers.length ? answers[i] : '')).join('');
  }

  function buildOrder(q, box, changed) {
    let order = q.lines.map((_, i) => i);
    // Scramble, but never hand over the answer already solved.
    for (let tries = 0; tries < 10; tries += 1) {
      order = Engine.shuffle(order);
      if (!Engine.checkAnswer(q, order).ok) break;
    }
    const list = h('ol', { class: 'order-list' });
    let dragging = null;
    let moved = false;
    const draw = () => {
      list.replaceChildren();
      order.forEach((lineIndex, pos) => {
        const li = h('li', { draggable: 'true', 'data-pos': pos },
          h('pre', { html: highlight(q.lines[lineIndex]) || '&nbsp;' }),
          h('button', { class: 'ord-btn', type: 'button', title: 'Move up', 'aria-label': 'Move up', onclick: () => move(pos, -1) }, '↑'),
          h('button', { class: 'ord-btn', type: 'button', title: 'Move down', 'aria-label': 'Move down', onclick: () => move(pos, 1) }, '↓'));
        li.addEventListener('dragstart', () => { dragging = pos; li.classList.add('is-dragging'); });
        li.addEventListener('dragend', () => { li.classList.remove('is-dragging'); });
        li.addEventListener('dragover', (e) => { e.preventDefault(); li.classList.add('is-over'); });
        li.addEventListener('dragleave', () => li.classList.remove('is-over'));
        li.addEventListener('drop', (e) => {
          e.preventDefault();
          li.classList.remove('is-over');
          if (dragging === null || dragging === pos) return;
          const [taken] = order.splice(dragging, 1);
          order.splice(pos, 0, taken);
          dragging = null;
          moved = true;
          draw();
          changed();
        });
        list.append(li);
      });
    };
    const move = (pos, delta) => {
      const to = pos + delta;
      if (to < 0 || to >= order.length || list.classList.contains('is-locked')) return;
      const t = order[pos]; order[pos] = order[to]; order[to] = t;
      moved = true;
      draw();
      changed();
    };
    draw();
    box.append(h('p', { style: { margin: '0 0 8px', fontSize: '13px', color: 'var(--text-dim)' } }, 'Drag the lines, or use ↑ ↓, until the program is in the right order.'));
    box.append(list);
    return {
      answered: () => moved,
      response: () => order.slice(),
      grade: () => Engine.checkAnswer(q, order),
      lock: (result) => {
        list.classList.add('is-locked', result.ok ? 'is-right' : 'is-wrong');
        list.querySelectorAll('button').forEach((b) => { b.disabled = true; });
        list.querySelectorAll('li').forEach((li) => li.setAttribute('draggable', 'false'));
      },
      expected: () => h('div', null, h('div', { style: { fontSize: '13px', color: 'var(--text-dim)' } }, 'The right order:'),
        h('pre', { class: 'q-expected', html: highlight(q.lines.join('\n')) }))
    };
  }

  function buildSpot(q, box, changed) {
    const lines = q.code.split('\n');
    let chosen = null;
    const wrap = h('div', { class: 'spot-code' });
    const buttons = lines.map((line, i) => {
      const btn = h('button', { class: 'spot-line', type: 'button' },
        h('span', { class: 'ln' }, String(i + 1)), h('span', { html: highlight(line) || ' ' }));
      btn.addEventListener('click', () => {
        chosen = i + 1;
        buttons.forEach((b, j) => b.classList.toggle('is-picked', j === i));
        changed();
      });
      wrap.append(btn);
      return btn;
    });
    box.append(h('p', { style: { margin: '0 0 8px', fontSize: '13px', color: 'var(--text-dim)' } }, 'Click the line with the bug.'));
    box.append(wrap);
    return {
      answered: () => chosen !== null,
      response: () => chosen,
      grade: () => Engine.checkAnswer(q, chosen),
      lock: () => {
        const right = [].concat(q.answer);
        buttons.forEach((b, j) => {
          b.disabled = true;
          b.classList.remove('is-picked');
          if (right.indexOf(j + 1) !== -1) b.classList.add('is-right');
          else if (chosen === j + 1) b.classList.add('is-wrong');
        });
      }
    };
  }

  function buildCodeQuestion(q, box, changed, opts) {
    const deferred = opts.mode === 'deferred';
    const widget = taskWidget(q.task, {
      kind: 'exam',
      codeKey: opts.codeKey || null,
      showPrompt: false,
      noHelp: deferred,
      noCheck: deferred,
      onChange: changed,
      onChecked: deferred ? null : opts.onCodeChecked
    });
    box.append(widget.el);
    return {
      answered: () => widget.code().trim() !== '' && widget.code() !== q.task.starter,
      response: () => widget.code(),
      grade: () => widget.check(),
      lock: () => { if (deferred) widget.lock(); }
    };
  }

  // ================================================================ coding tasks

  /**
   * Runs a task's tests against some code.
   * @returns {Promise<{ok, data, tests?, checks?, crashed?, output?}>}
   */
  async function gradeTask(task, code) {
    if (task.harness) {
      const source = Engine.buildChecked(code, task.harness, task.harnessPre);
      const data = await runCpp({ source });
      if (!data.compile.ok) return { ok: false, data, compileFailed: true };
      const run = data.runs[0];
      const parsed = Engine.parseChecked(run.stdout);
      const ok = parsed.done && parsed.checks.length > 0 && parsed.checks.every((c) => c.ok);
      return { ok, data, checks: parsed.checks, crashed: !parsed.done, output: parsed.output, run };
    }
    const data = await runCpp({ source: code, inputs: task.tests.map((t) => t.input) });
    if (!data.compile.ok) return { ok: false, data, compileFailed: true };
    const tests = task.tests.map((t, i) => {
      const run = data.runs[i] || {};
      const cmp = Engine.compareOutput(run.stdout, t.output);
      return { test: t, run, cmp, ok: cmp.ok && !run.timedOut && !run.signal };
    });
    return { ok: tests.every((t) => t.ok), data, tests };
  }

  function ioBox(label, text, bad) {
    return h('div', { class: 'io-box' + (bad ? ' is-bad' : '') }, h('b', null, label), h('pre', null, text === '' ? ' ' : text));
  }

  function resultsView(result, editor) {
    const wrap = h('div');
    if (result.compileFailed) {
      const out = h('div', { class: 'out' });
      showRun(out, result.data, { editor });
      wrap.append(out);
      return wrap;
    }
    const list = result.checks || result.tests || [];
    const passed = list.filter((x) => x.ok).length;
    wrap.append(h('div', { class: 'summary-bar ' + (result.ok ? 'is-ok' : 'is-bad') },
      result.ok ? '✓ All ' + list.length + ' tests pass' : '✗ ' + passed + ' of ' + list.length + ' tests pass' +
        (result.crashed ? ' — the program stopped before finishing' : '')));
    const ul = h('ul', { class: 'results' });
    let openedOne = false;
    if (result.checks) {
      list.forEach((c) => {
        const li = h('li', null, h('div', { class: 'res-row ' + (c.ok ? 'is-ok' : 'is-bad') },
          h('span', { class: 'res-icon' }, c.ok ? '✓' : '✗'), h('code', null, c.expr)));
        if (!c.ok) {
          li.append(h('div', { class: 'res-detail' }, h('div', { class: 'io-pair' },
            ioBox('Expected', c.want), ioBox('Your code gave', c.got, true))));
        }
        ul.append(li);
      });
      if (result.crashed) {
        const why = Explain.runtime(result.run) || 'The program stopped before all the tests ran.';
        ul.append(h('li', null, h('div', { class: 'out-note', style: { margin: '10px 14px' }, html: MD.inline(why) })));
      }
      if (result.output) {
        ul.append(h('li', null, h('details', { class: 'raw-toggle', style: { marginTop: '10px' } },
          h('summary', null, 'Your code also printed something'), h('pre', null, result.output))));
      }
    } else {
      list.forEach((t, i) => {
        const hidden = t.test.hidden;
        const li = h('li', null, h('div', { class: 'res-row ' + (t.ok ? 'is-ok' : 'is-bad') },
          h('span', { class: 'res-icon' }, t.ok ? '✓' : '✗'),
          h('span', null, (hidden ? 'Hidden test ' : 'Test ') + (i + 1) + (t.test.name && !/^Test \d+$/.test(t.test.name) ? ' — ' + t.test.name : ''))));
        if (!t.ok) {
          const detail = h('div', { class: 'res-detail' });
          if (hidden && !openedOne) {
            detail.append(h('div', { class: 'res-diff' }, 'A hidden test checks a case you might not have thought of — think about edge cases (zero, negatives, one item, very large values).'));
          } else if (!hidden) {
            detail.append(h('div', { class: 'io-pair' },
              t.test.input !== '' ? ioBox('Input', t.test.input) : null,
              ioBox('Expected output', t.test.output),
              ioBox('Your output', t.run.stdout || '', true)));
            if (t.cmp && t.cmp.line) {
              detail.append(h('div', { class: 'res-diff' }, 'First difference on line ' + t.cmp.line + ': expected ' +
                JSON.stringify(t.cmp.want === null ? '(no more lines)' : t.cmp.want) + ', got ' +
                JSON.stringify(t.cmp.got === null ? '(no more lines)' : t.cmp.got)));
            }
          }
          const why = Explain.runtime(t.run);
          if (why) detail.append(h('div', { class: 'out-note', style: { margin: 0 }, html: MD.inline(why) }));
          if (t.run.stderr) detail.append(ioBox('Error output', t.run.stderr, true));
          li.append(detail);
          openedOne = true;
        }
        ul.append(li);
      });
    }
    wrap.append(ul);
    return wrap;
  }

  /**
   * A coding exercise: editor, input, run, check, hints and solution.
   * @param {object} task
   * @param {{kind, codeKey, onSolved, showPrompt, title, noHelp, noCheck, onChange}} opts
   */
  function taskWidget(task, opts) {
    opts = opts || {};
    const key = opts.codeKey === undefined ? task.id : opts.codeKey;
    const saved = key && P.code[key] ? P.code[key].src : null;
    const solvedBefore = isDone(task.id);
    const el = h('section', { class: 'task' + (solvedBefore ? ' is-solved' : '') });
    let hintsShown = 0;
    let saveTimer = null;
    let locked = false;

    const kindLabel = { task: 'Your turn', challenge: 'Challenge', milestone: 'Milestone', exam: 'Coding question' }[opts.kind] || 'Exercise';
    const kickerText = () => (isDone(task.id) ? '✓ Solved — ' : '') + kindLabel;
    const kicker = h('div', { class: 'task-kicker' }, kickerText());
    const head = h('div', { class: 'task-head' }, kicker);
    if (opts.showPrompt !== false && task.title) head.append(h('h3', { class: 'task-title' }, task.title));
    el.append(head);
    if (opts.showPrompt !== false && task.prompt) {
      const body = h('div', { class: 'task-body' }, md(task.prompt));
      const visible = task.tests.filter((t) => !t.hidden).slice(0, 2);
      if (visible.length && opts.kind !== 'challenge') {
        visible.forEach((t) => {
          body.append(h('div', { class: 'example-case', style: { margin: '0 0 10px' } },
            t.input !== '' ? ioBox('Example input', t.input) : null, ioBox('Expected output', t.output)));
        });
      }
      el.append(body);
    } else if (opts.showPrompt === false && task.prompt && opts.kind === 'exam') {
      el.append(h('div', { class: 'task-body' }, md(task.prompt)));
    }

    const ed = codeEditor(saved !== null ? saved : task.starter, {
      minLines: 8,
      maxLines: 30,
      onRun: () => (task.harness ? check() : run()),
      onChange: (value) => {
        if (key) {
          clearTimeout(saveTimer);
          saveTimer = setTimeout(() => { P.code[key] = { src: value, at: iso() }; save({ quiet: true }); }, 700);
        }
        if (opts.onChange) opts.onChange();
      }
    });
    el.append(h('div', { class: 'task-editor' }, ed.host));

    let stdin = null;
    if (!task.harness) {
      stdin = h('textarea', { class: 'io-input', spellcheck: 'false', placeholder: 'Input for ▶ Run — type what a user would type' });
      const first = task.tests.find((t) => !t.hidden && t.input);
      if (first) stdin.value = first.input;
      el.append(h('details', { class: 'task-io', open: Engine.readsInput(task.starter + (task.solution || '')) ? true : null },
        h('summary', null, 'Input for ▶ Run'), stdin));
    }

    const runBtn = h('button', { class: 'mini-btn is-run', title: 'Compile and run with the input above (Ctrl+Enter)' }, '▶ Run');
    const checkBtn = h('button', { class: 'mini-btn is-primary', title: 'Run all the tests' }, task.harness ? '✓ Run the tests' : '✓ Check');
    const hintBtn = h('button', { class: 'mini-btn' });
    const solutionBtn = h('button', { class: 'mini-btn' }, 'Solution');
    const resetBtn = h('button', { class: 'mini-btn', title: 'Start again from the starter code' }, 'Reset');
    const bar = h('div', { class: 'task-bar' });
    if (!task.harness) bar.append(runBtn);
    if (!opts.noCheck) bar.append(checkBtn);
    bar.append(h('span', { class: 'spacer' }));
    if (!opts.noHelp) {
      if (task.hints.length) bar.append(hintBtn);
      if (task.solution) bar.append(solutionBtn);
    }
    bar.append(resetBtn);
    el.append(bar);

    const out = h('div', { class: 'out' });
    const results = h('div');
    const hints = h('ul', { class: 'hint-list' });
    const solution = h('div');
    el.append(out, results, h('div', { class: 'task-foot' }, hints, solution));

    const updateHint = () => {
      hintBtn.textContent = hintsShown < task.hints.length ? 'Hint ' + (hintsShown + 1) + '/' + task.hints.length : 'No more hints';
      hintBtn.disabled = hintsShown >= task.hints.length;
    };
    updateHint();

    hintBtn.addEventListener('click', () => {
      if (hintsShown >= task.hints.length) return;
      hints.append(h('li', null, h('b', null, 'Hint ' + (hintsShown + 1)), mdInline(task.hints[hintsShown])));
      hintsShown += 1;
      touch(task.id, { helped: true, status: (rec(task.id) || {}).status || 'started' });
      save({ quiet: true });
      updateHint();
    });

    solutionBtn.addEventListener('click', () => {
      if (solution.childNodes.length) { solution.replaceChildren(); return; }
      const r = rec(task.id) || {};
      if (!isDone(task.id) && (r.attempts || 0) < 3) {
        const ok = confirm('You have checked ' + plural(r.attempts || 0, 'time') + ' so far. Struggling a little longer is exactly how this sticks — a hint might be enough.\n\nShow the solution anyway?');
        if (!ok) return;
      }
      touch(task.id, { helped: true, sawSolution: true, status: r.status || 'started' });
      save({ quiet: true });
      solution.append(h('div', { class: 'solution-box' },
        h('b', null, 'One possible solution'),
        h('pre', { class: 'code-view', html: highlight(task.solution) }),
        task.explain ? md(task.explain) : null,
        h('div', { style: { padding: '10px 14px' } },
          h('button', {
            class: 'mini-btn',
            onclick: () => {
              if (confirm('Replace your code with this solution? (Typing it yourself teaches more.)')) ed.set(task.solution);
            }
          }, 'Put it in the editor'))));
    });

    resetBtn.addEventListener('click', () => {
      if (!confirm('Throw away your code and start again from the starter code?')) return;
      ed.set(task.starter);
      out.replaceChildren();
      results.replaceChildren();
      if (key) { P.code[key] = { src: task.starter, at: iso() }; save({ quiet: true }); }
    });

    async function run() {
      runBtn.disabled = true;
      out.replaceChildren(spinner());
      try {
        const data = await runCpp({ source: ed.ed.getValue(), stdin: stdin ? stdin.value : '' });
        showRun(out, data, { editor: ed.ed });
      } catch (err) {
        showRunError(out, err);
      } finally {
        runBtn.disabled = false;
      }
    }

    async function check() {
      if (locked && opts.kind !== 'exam') return { ok: false };
      checkBtn.disabled = true;
      out.replaceChildren();
      results.replaceChildren(spinner('Running the tests…'));
      let result;
      try {
        result = await gradeTask(task, ed.ed.getValue());
      } catch (err) {
        results.replaceChildren();
        showRunError(out, err);
        checkBtn.disabled = false;
        return { ok: false, error: err };
      }
      results.replaceChildren(resultsView(result, ed.ed));
      checkBtn.disabled = false;
      if (opts.onChecked) opts.onChecked(result);
      if (opts.kind !== 'exam') {
        const r = touch(task.id, { attempts: ((rec(task.id) || {}).attempts || 0) + 1, status: (rec(task.id) || {}).status || 'started' });
        if (result.ok) {
          const wasDone = r.status === 'done';
          el.classList.add('is-solved');
          if (opts.onSolved) opts.onSolved(result, wasDone);
          kicker.textContent = kickerText();
        } else {
          save({ quiet: true });
        }
      }
      return result;
    }

    runBtn.addEventListener('click', run);
    checkBtn.addEventListener('click', check);

    return {
      el,
      code: () => ed.ed.getValue(),
      check,
      editor: ed,
      lock: () => {
        locked = true;
        ed.ed.input.readOnly = true;
        runBtn.disabled = true;
        checkBtn.disabled = true;
      }
    };
  }

  // ================================================================ views: shell

  function crumbs(parts) {
    const nav = h('nav', { class: 'crumbs', 'aria-label': 'Breadcrumb' });
    parts.forEach((p, i) => {
      if (i) nav.append(h('span', { class: 'sep' }, '›'));
      nav.append(p.href ? h('a', { href: p.href }, p.label) : h('span', null, p.label));
    });
    return nav;
  }

  function itemCrumbs(item) {
    const ch = item.chapter;
    const part = course.parts.find((p) => p.id === ch.part);
    return crumbs([
      { label: 'Home', href: '#/' },
      part ? { label: part.title } : null,
      { label: 'Chapter ' + ch.number + ': ' + ch.title, href: '#/c/' + ch.id }
    ].filter(Boolean));
  }

  function pager(item) {
    const n = neighbours(item);
    const link = (target, cls, label) => (target
      ? h('a', { class: cls, href: '#/i/' + target.id }, h('small', null, label + ' · ' + itemLabel(target)), target.title)
      : h('span', { style: { flex: '1 1 0' } }));
    return h('div', { class: 'pager' }, link(n.prev, 'prev', '← Previous'), link(n.next, 'next', 'Next →'));
  }

  function page(cls) {
    return h('div', { class: 'page' + (cls ? ' ' + cls : '') });
  }

  function lockedView(item, ch) {
    const i = indexOfChapter(ch);
    const prev = chapterAt(i - 1);
    const gate = prev ? examOf(prev) : null;
    const p = page();
    p.append(crumbs([{ label: 'Home', href: '#/' }, { label: 'Chapter ' + ch.number + ': ' + ch.title }]));
    p.append(h('div', { class: 'lock-box' },
      h('h2', null, '🔒 Chapter ' + ch.number + ' is locked'),
      h('p', { html: MD.inline('This course uses **mastery learning**: each chapter builds on the one before, so a chapter opens when you pass the previous chapter\'s exam (80% or more). It is the single most reliable way to avoid the "I followed everything but can\'t write anything" trap.') }),
      h('p', { html: MD.inline(gate ? 'To open it, pass **' + esc(gate.title) + '**.' : 'Finish the previous chapter to open it.') }),
      h('div', { class: 'row-actions' },
        gate ? h('a', { class: 'btn btn-primary', href: '#/i/' + gate.id }, 'Go to the exam') : null,
        h('button', {
          class: 'btn',
          onclick: () => {
            if (!confirm('Unlock Chapter ' + ch.number + ' without passing the exam?\n\nYou can — it is your course — but gaps now become confusion later. Passing the exam first is the recommended path.')) return;
            P.unlocked[ch.id] = iso();
            save();
            route();
          }
        }, 'Unlock anyway'))));
    return p;
  }

  // ================================================================ views: home

  function homeView() {
    const p = page('page-wide');
    const level = Engine.levelFor(totalXp());
    const up = nextUp();
    const started = Object.keys(P.items).length > 0;
    const hour = new Date().getHours();
    const greet = hour < 5 ? 'Up late' : hour < 12 ? 'Good morning' : hour < 19 ? 'Good afternoon' : 'Good evening';

    const banner = compilerBanner();
    if (banner) p.append(banner);

    const heroText = started
      ? 'Pick up where you left off. A little every day beats a lot once a week — your brain consolidates between sessions.'
      : 'This course takes you from knowing nothing about programming to writing real C++ programs fluently. Every lesson has runnable code, checks and exercises; every chapter ends with an exam.';
    const hero = h('section', { class: 'hero' },
      h('div', null,
        h('h1', null, started ? greet + '!' : 'Learn C++ from zero'),
        h('p', null, heroText),
        up ? h('div', { class: 'up-next' }, 'Up next: ', h('b', null, itemLabel(up) + ' — ' + up.title)) : null,
        h('div', { class: 'row-actions' },
          up ? h('a', { class: 'btn btn-primary btn-big', href: '#/i/' + up.id }, started ? 'Continue →' : 'Start the course →')
            : h('a', { class: 'btn btn-primary btn-big', href: '#/progress' }, 'See your progress'),
          h('a', { class: 'btn btn-big', href: '#/method' }, 'How this course works'))),
      h('div', { class: 'level-card' },
        h('div', { class: 'lv' }, 'Level ' + level.level),
        h('div', { class: 'lv-title' }, level.title),
        h('div', { class: 'bar' }, h('i', { style: { width: pct(level.progress) } })),
        h('div', { class: 'bar-label' }, h('span', null, level.xp + ' XP'), h('span', null, level.next ? level.next + ' XP' : 'max'))));
    p.append(hero);

    const due = dueCards().length;
    const mistakes = openMistakes().length;
    const xpToday = P.days[today()] || 0;
    const s = Engine.streak(P.days);
    const practice = dailyChallenge();
    p.append(h('div', { class: 'cards-row' },
      h('div', { class: 'stat-card' + (due ? ' is-action' : '') },
        h('h3', null, 'Flashcards due'),
        h('div', { class: 'big' }, String(due)),
        h('p', null, due ? 'Spaced review moves what you learned into long-term memory.' : 'Nothing due. Cards appear as you finish lessons.'),
        due ? h('a', { class: 'btn btn-primary', href: '#/review' }, 'Review now') : null),
      h('div', { class: 'stat-card' },
        h('h3', null, 'Today\'s goal'),
        h('div', { class: 'big' }, xpToday + ' / ' + DAILY_GOAL + ' XP'),
        h('div', { class: 'bar ok', style: { margin: '10px 0' } }, h('i', { style: { width: pct(Math.min(1, xpToday / DAILY_GOAL)) } })),
        h('p', null, xpToday >= DAILY_GOAL ? 'Goal reached — great work.' : 'About one lesson and a few exercises.')),
      h('div', { class: 'stat-card' },
        h('h3', null, 'Streak'),
        h('div', { class: 'big' }, '🔥 ' + s + (s === 1 ? ' day' : ' days')),
        h('p', null, P.days[today()] ? 'You have studied today.' : s ? 'Study today to keep it going.' : 'Study today to start one.')),
      mistakes ? h('div', { class: 'stat-card is-action' },
        h('h3', null, 'Mistakes to revisit'),
        h('div', { class: 'big' }, String(mistakes)),
        h('p', null, 'Questions you missed. Get each right twice to clear it.'),
        h('a', { class: 'btn', href: '#/review/mistakes' }, 'Practise them')) : null,
      practice ? h('div', { class: 'stat-card' },
        h('h3', null, 'Practice problem'),
        h('div', { style: { fontWeight: 650, margin: '4px 0' } }, practice.title, ' ', stars(practice.difficulty)),
        h('p', null, 'From Chapter ' + practice.chapter.number + '. Deliberate practice is what turns knowing into doing.'),
        h('a', { class: 'btn', href: '#/i/' + practice.id }, 'Solve it')) : null));

    p.append(h('div', { class: 'section-title' }, 'Your roadmap'));
    course.parts.forEach((part) => {
      const section = h('section', { class: 'roadmap-part' }, h('h3', null, part.title), h('p', null, part.blurb));
      const grid = h('div', { class: 'chapter-grid' });
      part.chapters.forEach((ch) => {
        const st = chapterStats(ch);
        const locked = !isUnlocked(ch);
        grid.append(h('a', {
          class: 'chapter-card' + (locked ? ' is-locked' : '') + (st.mastered ? ' is-mastered' : ''),
          href: '#/c/' + ch.id
        },
        h('div', { class: 'ring small', style: { '--p': Math.round(st.mastery * 100), '--c': st.mastered ? 'var(--ok)' : 'var(--accent)' } },
          h('span', null, locked ? '🔒' : Math.round(st.mastery * 100) + '%')),
        h('div', null,
          h('div', { class: 'cc-num' }, 'Chapter ' + ch.number),
          h('div', { class: 'cc-title' }, ch.title),
          h('div', { class: 'cc-sub' }, st.lessons[1] + ' lessons · ' + st.challenges[1] + ' challenges'))));
      });
      section.append(grid);
      p.append(section);
    });
    return p;
  }

  function dailyChallenge() {
    const open = course.items.filter((i) => i.type === 'challenge' && !isDone(i.id) && isUnlocked(i.chapter) &&
      i.chapter.items.filter((x) => x.type === 'lesson').every((x) => isDone(x.id)));
    if (!open.length) return null;
    const seed = Number(today().replace(/-/g, ''));
    return open[seed % open.length];
  }

  // ================================================================ views: chapter

  function chapterView(ch) {
    const p = page();
    const st = chapterStats(ch);
    const part = course.parts.find((x) => x.id === ch.part);
    p.append(crumbs([{ label: 'Home', href: '#/' }, part ? { label: part.title } : null, { label: 'Chapter ' + ch.number }].filter(Boolean)));
    p.append(h('div', { style: { display: 'flex', gap: '18px', alignItems: 'center', margin: '0 0 8px' } },
      h('div', { class: 'ring', style: { '--p': Math.round(st.mastery * 100), '--c': st.mastered ? 'var(--ok)' : 'var(--accent)' } },
        h('span', null, Math.round(st.mastery * 100) + '%')),
      h('div', null,
        h('h1', null, 'Chapter ' + ch.number + ': ' + ch.title),
        h('p', { class: 'page-sub', style: { margin: 0 } }, ch.blurb))));
    p.append(h('div', { class: 'meta-row', style: { marginTop: '14px' } },
      ch.hours ? h('span', { class: 'tag' }, '⏱ about ' + ch.hours + ' h') : null,
      h('span', { class: 'tag' }, st.lessons[0] + '/' + st.lessons[1] + ' lessons'),
      st.challenges[1] ? h('span', { class: 'tag' }, st.challenges[0] + '/' + st.challenges[1] + ' challenges') : null,
      st.exam ? h('span', { class: 'tag ' + (st.examPassed ? 'tag-ok' : 'tag-gold') }, st.examPassed ? '✓ Exam passed' : 'Exam not passed yet') : null,
      st.mastered ? h('span', { class: 'tag tag-ok' }, '★ Mastered') : null));

    if (!isUnlocked(ch)) return lockedView(null, ch);

    p.append(h('section', { class: 'goals' }, h('h2', null, 'By the end of this chapter you can'),
      h('ul', null, ch.goals.map((g) => h('li', { html: MD.inline(g) })))));

    const list = h('ul', { class: 'item-list' });
    ch.items.forEach((item) => {
      const r = rec(item.id);
      const done = isDone(item.id);
      let sub = '';
      if (item.type === 'lesson') sub = itemLabel(item) + (item.minutes ? ' · ' + item.minutes + ' min' : '');
      if (item.type === 'quiz' || item.type === 'review') sub = typeName(item.type) + ' · ' + plural(item.questions.length, 'question');
      if (item.type === 'exam') sub = 'Chapter exam · ' + (item.pick || item.questions.length) + ' questions · pass with ' + pct(item.pass);
      if (item.type === 'challenge') sub = 'Challenge · ' + ['', 'warm-up', 'solid', 'hard'][item.difficulty];
      if (item.type === 'project') sub = 'Project · ' + plural(item.milestones.length, 'milestone');
      let side = done ? '✓ Done' : r ? 'In progress' : '';
      if ((item.type === 'quiz' || item.type === 'exam') && r && r.best) side = (done ? '✓ ' : '') + 'best ' + pct(r.best);
      list.append(h('li', null, h('a', { class: 'item-row' + (done ? ' is-done' : ''), href: '#/i/' + item.id },
        h('span', { class: 'ir-icon' }, done ? '✓' : typeIcon(item.type)),
        h('span', { class: 'ir-main' },
          h('div', { class: 'ir-title' }, item.title, item.type === 'challenge' ? ' ' : null, item.type === 'challenge' ? stars(item.difficulty) : null),
          h('div', { class: 'ir-sub' }, sub)),
        h('span', { class: 'ir-side' }, side))));
    });
    p.append(list);
    return p;
  }

  // ================================================================ views: lesson

  function lessonView(item) {
    const p = page();
    p.append(itemCrumbs(item));
    p.append(h('h1', null, item.title));
    p.append(h('div', { class: 'meta-row' },
      h('span', { class: 'tag tag-accent' }, itemLabel(item)),
      item.minutes ? h('span', { class: 'tag' }, '⏱ ' + item.minutes + ' min') : null,
      isDone(item.id) ? h('span', { class: 'tag tag-ok' }, '✓ Completed') : null));
    const banner = compilerBanner();
    if (banner) p.append(banner);

    if (item.objectives.length) {
      p.append(h('section', { class: 'objectives' },
        h('h2', null, 'By the end of this lesson you will be able to'),
        h('ul', null, item.objectives.map((o) => h('li', { html: MD.inline(o) })))));
    }

    const placed = new Set();
    const slots = [];
    const html = MD.render(item.body, {
      code: (lang, flags, code, extras) => {
        if (lang === 'cpp' || lang === 'c++') {
          slots.push(() => exampleWidget(code, flags, extras));
          return '<div data-slot="' + (slots.length - 1) + '"></div>';
        }
        const label = lang === 'output' ? 'Output' : lang === 'stdin' ? 'Input' : '';
        return (label ? '<div class="ex-io-label" style="padding:0 0 4px">' + label + '</div>' : '') +
          '<pre class="plain">' + esc(code) + '</pre>';
      },
      slot: (kind, id) => {
        const full = item.id + '/' + id;
        placed.add(full);
        if (kind === 'check') {
          const q = item.checks.find((c) => c.id === full);
          if (!q) return '';
          slots.push(() => lessonCheck(q));
        } else {
          const t = item.tasks.find((c) => c.id === full);
          if (!t) return '';
          slots.push(() => lessonTask(t));
        }
        return '<div data-slot="' + (slots.length - 1) + '"></div>';
      }
    });
    const body = h('article', { class: 'prose', html });
    body.querySelectorAll('[data-slot]').forEach((el) => el.replaceWith(slots[Number(el.dataset.slot)]()));
    p.append(body);

    const loose = item.checks.filter((q) => !placed.has(q.id));
    if (loose.length) {
      p.append(h('h2', { style: { marginTop: '40px' } }, 'Check your understanding'));
      loose.forEach((q) => p.append(lessonCheck(q)));
    }
    const tasks = item.tasks.filter((t) => !placed.has(t.id));
    if (tasks.length) {
      p.append(h('h2', { style: { marginTop: '40px' } }, 'Practice'));
      p.append(h('p', { class: 'page-sub' }, 'Reading about code is not the same as writing it. These are short — do them before moving on.'));
      tasks.forEach((t) => p.append(lessonTask(t)));
    }

    p.append(notesBox(item));

    const foot = h('section', { class: 'lesson-foot' });
    const drawFoot = () => {
      foot.replaceChildren();
      const n = neighbours(item).next;
      if (isDone(item.id)) {
        foot.append(h('p', null, '✓ You completed this lesson' + (item.cards.length ? ' — its flashcards are in your review deck.' : '.')));
        if (n) foot.append(h('a', { class: 'btn btn-primary btn-big', href: '#/i/' + n.id }, 'Next: ' + n.title + ' →'));
      } else {
        foot.append(h('p', null, 'Finished reading, answered the checks and tried the exercises?'));
        foot.append(h('button', {
          class: 'btn btn-primary btn-big',
          onclick: () => {
            const gained = complete(item.id, { xp: Engine.XP.lesson });
            const added = addCards(item);
            save();
            toast('<b>Lesson complete</b>' + (gained ? ' · +' + gained + ' XP' : '') + (added ? ' · ' + plural(added, 'flashcard') + ' added to your review deck' : ''), 'ok');
            if (n) location.hash = '#/i/' + n.id;
            else drawFoot();
          }
        }, 'Complete lesson ✓'));
      }
    };
    drawFoot();
    p.append(foot);
    p.append(pager(item));
    return p;
  }

  function addCards(item) {
    let added = 0;
    const due = Engine.addDays(today(), 1);
    item.cards.forEach((card) => {
      if (P.cards[card.id]) return;
      P.cards[card.id] = Object.assign(Engine.newCard(due), { at: iso() });
      added += 1;
    });
    return added;
  }

  function recordAnswer(q, result, firstTry) {
    const cur = rec(q.id) || {};
    if (result.ok) {
      complete(q.id, { xp: firstTry && !cur.xp ? Engine.XP.check : cur.xp || 0, best: 1 });
    } else {
      touch(q.id, { attempts: (cur.attempts || 0) + 1, status: cur.status || 'started' });
    }
    const m = P.mistakes[q.id];
    if (!result.ok && q.type !== 'code') {
      P.mistakes[q.id] = { count: ((m && m.count) || 0) + 1, streak: 0, cleared: false, at: iso() };
    }
    save();
  }

  function lessonCheck(q) {
    return questionWidget(q, {
      mode: 'instant',
      onAnswered: (result, firstTry) => recordAnswer(q, result, firstTry)
    }).el;
  }

  function lessonTask(t) {
    return taskWidget(t, {
      kind: 'task',
      onSolved: (result, wasDone) => {
        const gained = complete(t.id, { xp: Engine.XP.task });
        save();
        if (!wasDone) toast('<b>✓ Solved!</b>' + (gained ? ' +' + gained + ' XP' : ''), 'ok');
      }
    }).el;
  }

  function notesBox(item) {
    const note = P.notes[item.id];
    const area = h('textarea', { placeholder: 'Write what you learned in your own words. Explaining something is the best test of understanding it. Notes sync with your progress.' });
    area.value = note ? note.text : '';
    let timer = null;
    area.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => { P.notes[item.id] = { text: area.value, at: iso() }; save(); }, 800);
    });
    return h('details', { class: 'notes', open: note && note.text ? true : null },
      h('summary', null, '✍️ Your notes on this lesson'), area);
  }

  // ================================================================ views: quiz

  function quizView(item) {
    const p = page();
    p.append(itemCrumbs(item));
    p.append(h('h1', null, item.title));
    const r = rec(item.id);
    p.append(h('div', { class: 'meta-row' },
      h('span', { class: 'tag tag-accent' }, 'Quiz · ' + plural(item.questions.length, 'question')),
      r && r.best ? h('span', { class: 'tag' + (isDone(item.id) ? ' tag-ok' : '') }, 'Best: ' + pct(r.best)) : null));
    if (item.body) p.append(md(item.body));
    const stage = h('div');
    p.append(stage);

    const start = () => {
      const questions = item.questions;
      let i = 0;
      let score = 0;
      const missed = [];
      const bar = h('div', { class: 'quiz-progress' }, h('i', { style: { width: '0%' } }));
      const holder = h('div');
      const nav = h('div', { class: 'quiz-nav' });
      stage.replaceChildren(bar, holder, nav);

      const show = () => {
        bar.firstChild.style.width = pct(i / questions.length);
        const q = questions[i];
        const next = h('button', { class: 'btn btn-primary', disabled: true }, i === questions.length - 1 ? 'See my score' : 'Next question →');
        const w = questionWidget(q, {
          mode: 'instant',
          kicker: 'Question ' + (i + 1) + ' of ' + questions.length + ' · ' + kickerFor(q),
          onAnswered: (result) => {
            if (result.ok) score += 1; else missed.push(q);
            recordAnswer(q, result, true);
            next.disabled = false;
            next.focus();
          }
        });
        holder.replaceChildren(w.el);
        nav.replaceChildren(h('span'), next);
        next.addEventListener('click', () => {
          i += 1;
          if (i < questions.length) show(); else finish();
        });
        main.scrollTop = 0;
      };

      const finish = () => {
        const ratio = score / questions.length;
        const passed = ratio >= item.pass;
        let gained = 0;
        if (passed) gained = complete(item.id, { xp: Engine.XP.quiz * ratio, best: ratio });
        else touch(item.id, { best: Math.max((rec(item.id) || {}).best || 0, ratio) });
        save();
        bar.firstChild.style.width = '100%';
        holder.replaceChildren(scoreCard(ratio, passed,
          passed ? 'Well done!' : 'Keep practising',
          passed ? (gained ? '+' + gained + ' XP. ' : '') + 'The questions you missed are in your mistake bank.'
            : 'You need ' + pct(item.pass) + ' to complete this quiz. Re-read the lessons behind the questions you missed, then try again.'));
        if (missed.length) {
          holder.append(h('h2', null, 'Revisit'));
          holder.append(h('ul', { class: 'prose' }, missed.map((q) =>
            h('li', null, h('span', { html: MD.inline(firstLine(q.prompt) || kickerFor(q)) })))));
        }
        const n = neighbours(item).next;
        nav.replaceChildren(h('button', { class: 'btn', onclick: start }, 'Try again'),
          n ? h('a', { class: 'btn btn-primary', href: '#/i/' + n.id }, 'Next: ' + n.title + ' →') : h('span'));
      };
      show();
    };

    stage.append(h('div', { class: 'exam-intro' },
      h('p', { style: { margin: 0 } }, 'One question at a time, with the answer explained straight away. Trying to remember — even when you get it wrong — is one of the most effective ways to learn.'),
      h('div', { class: 'row-actions', style: { marginTop: '16px' } }, h('button', { class: 'btn btn-primary btn-big', onclick: start }, 'Start the quiz'))));
    p.append(pager(item));
    return p;
  }

  function firstLine(text) {
    return String(text || '').split('\n').find((l) => l.trim()) || '';
  }

  function scoreCard(ratio, passed, title, text) {
    return h('section', { class: 'score-card ' + (passed ? 'is-pass' : 'is-fail') },
      h('div', { class: 'ring', style: { '--p': Math.round(ratio * 100), '--c': passed ? 'var(--ok)' : 'var(--warn)' } },
        h('span', null, Math.round(ratio * 100) + '%')),
      h('div', null, h('h2', null, title), h('p', { html: MD.inline(text) })));
  }

  // ================================================================ views: exam

  function examView(item) {
    const p = page();
    p.append(itemCrumbs(item));
    p.append(h('h1', null, item.title));
    const history = P.exams[item.id] || [];
    const passedBefore = isDone(item.id);
    const count = item.pick || item.questions.length;
    const hasCode = item.questions.some((q) => q.type === 'code');
    p.append(h('div', { class: 'meta-row' },
      h('span', { class: 'tag tag-gold' }, 'Exam'),
      h('span', { class: 'tag' }, count + ' questions'),
      item.minutes ? h('span', { class: 'tag' }, '⏱ ' + item.minutes + ' min') : null,
      passedBefore ? h('span', { class: 'tag tag-ok' }, '✓ Passed') : null));

    const stage = h('div');
    p.append(stage);

    const intro = () => {
      const card = h('div', { class: 'exam-intro' });
      if (item.body) card.append(md(item.body));
      card.append(h('ul', null,
        h('li', null, count + ' questions drawn from everything in this chapter' + (item.pick && item.pick < item.questions.length ? ' (a different mix each attempt)' : '') + '.'),
        h('li', null, 'Pass mark: ', h('b', null, pct(item.pass)), '. Passing unlocks the next chapter.'),
        item.minutes ? h('li', null, 'Time limit: ' + item.minutes + ' minutes. It submits itself when time is up.') : h('li', null, 'No time limit — but try to answer from memory.'),
        h('li', null, 'No feedback until you submit. Then every answer is explained.'),
        hasCode ? h('li', null, 'Coding questions are marked by running your code against tests — use ▶ Run to try things before submitting.') : null,
        h('li', null, 'You can retake it as often as you like. Missed questions go to your mistake bank.')));
      if (history.length) {
        card.append(h('div', { style: { color: 'var(--text-dim)', fontSize: '13px' } }, 'Previous attempts:'));
        card.append(h('ul', { class: 'history' }, history.slice(-12).map((a) =>
          h('li', { class: a.passed ? 'is-pass' : '' }, pct(a.score) + ' · ' + String(a.at).slice(0, 10)))));
      }
      card.append(h('div', { class: 'row-actions', style: { marginTop: '18px' } },
        h('button', { class: 'btn btn-primary btn-big', onclick: begin }, history.length ? 'Retake the exam' : 'Start the exam')));
      stage.replaceChildren(card);
    };

    const begin = () => {
      const seed = Date.now() % 2147483646 + 1;
      let questions = item.pick ? Engine.shuffle(item.questions, seed).slice(0, item.pick) : item.questions.slice();
      // Code questions last: they take longest.
      questions = questions.filter((q) => q.type !== 'code').concat(questions.filter((q) => q.type === 'code'));
      const widgets = questions.map((q, i) => questionWidget(q, {
        mode: 'deferred',
        kicker: 'Question ' + (i + 1) + ' · ' + kickerFor(q),
        codeKey: null
      }));
      const answeredEl = h('span', { style: { color: 'var(--text-dim)', fontSize: '13px' } });
      const timerEl = h('span', { class: 'exam-timer' });
      const submitBtn = h('button', { class: 'btn btn-primary' }, 'Submit exam');
      const barEl = h('div', { class: 'exam-bar' }, timerEl, answeredEl, h('span', { class: 'spacer' }), submitBtn);
      const list = h('div');
      widgets.forEach((w) => list.append(w.el));
      const endBtn = h('div', { style: { textAlign: 'center', marginTop: '26px' } },
        h('button', { class: 'btn btn-primary btn-big', onclick: () => submit(false) }, 'Submit exam'));
      stage.replaceChildren(barEl, list, endBtn);
      main.scrollTop = 0;

      const refreshCount = () => {
        const n = widgets.filter((w) => w.answered()).length;
        answeredEl.textContent = n + ' of ' + widgets.length + ' answered';
      };
      const counter = setInterval(refreshCount, 1000);
      refreshCount();

      let deadline = null;
      let tick = null;
      if (item.minutes) {
        deadline = Date.now() + item.minutes * 60000;
        const draw = () => {
          const left = Math.max(0, deadline - Date.now());
          const m = Math.floor(left / 60000);
          const s = Math.floor((left % 60000) / 1000);
          timerEl.textContent = '⏱ ' + m + ':' + (s < 10 ? '0' : '') + s;
          timerEl.classList.toggle('is-low', left < 60000);
          if (left <= 0) submit(true);
        };
        tick = setInterval(draw, 500);
        draw();
      } else {
        timerEl.textContent = '⏱ untimed';
      }

      let submitting = false;
      view.guard = () => confirm('Leave the exam? Your answers will be lost.');
      const stop = () => { clearInterval(counter); clearInterval(tick); view.guard = null; };
      view.cleanup.push(stop);

      async function submit(timeUp) {
        if (submitting) return;
        const unanswered = widgets.filter((w) => !w.answered()).length;
        if (!timeUp && unanswered && !confirm(plural(unanswered, 'question is', 'questions are') + ' unanswered. Submit anyway?')) return;
        submitting = true;
        stop();
        submitBtn.disabled = true;
        endBtn.replaceChildren(spinner('Marking your exam' + (hasCode ? ' — running your code…' : '…')));
        let points = 0;
        let total = 0;
        const results = [];
        for (const w of widgets) {
          const weight = w.q.type === 'code' ? 2 : 1;
          total += weight;
          let result = { ok: false };
          if (w.answered()) {
            try { result = await w.grade(); } catch (e) { result = { ok: false }; }
          }
          if (result.ok) points += weight;
          results.push({ w, result });
        }
        const ratio = total ? points / total : 0;
        const passed = ratio >= item.pass;
        (P.exams[item.id] = P.exams[item.id] || []).push({ score: Math.round(ratio * 1000) / 1000, passed, at: iso() });
        results.forEach(({ w, result }) => {
          if (!result.ok && w.q.type !== 'code') {
            const m = P.mistakes[w.q.id];
            P.mistakes[w.q.id] = { count: ((m && m.count) || 0) + 1, streak: 0, cleared: false, at: iso() };
          }
        });
        const wasUnlocked = nextChapterUnlocked(item);
        let gained = 0;
        if (passed) gained = complete(item.id, { xp: Engine.XP.exam + (ratio >= 1 ? 50 : 0), best: ratio });
        else touch(item.id, { best: Math.max((rec(item.id) || {}).best || 0, ratio) });
        save();

        results.forEach(({ w, result }) => w.reveal(result));
        const n = neighbours(item).next;
        barEl.remove();
        stage.prepend(scoreCard(ratio, passed,
          passed ? (ratio >= 1 ? 'Perfect score!' : 'Passed!') : (timeUp ? 'Time\'s up — not passed yet' : 'Not passed yet'),
          passed ? (gained ? '+' + gained + ' XP. ' : '') + 'Scroll down to see every answer explained.'
            : 'You need ' + pct(item.pass) + '. Read the explanations below, revisit those lessons, then retake — the exam is there to show you what to review, not to judge you.'));
        endBtn.replaceChildren(h('div', { class: 'row-actions', style: { justifyContent: 'center' } },
          h('button', { class: 'btn', onclick: () => { stage.replaceChildren(); intro(); main.scrollTop = 0; } }, 'Back to the exam page'),
          n ? h('a', { class: 'btn btn-primary', href: '#/i/' + n.id }, 'Continue: ' + n.title + ' →') : null));
        main.scrollTop = 0;
        if (passed && !wasUnlocked) {
          const nextCh = chapterAt(indexOfChapter(item.chapter) + 1);
          if (nextCh) {
            celebrate('🔓', 'Chapter ' + nextCh.number + ' unlocked', '**' + nextCh.title + '** is open. ' + (ratio >= 1 ? 'And a perfect score!' : ''),
              { label: 'Go there', run: () => { location.hash = '#/c/' + nextCh.id; } });
          }
        }
      }
      submitBtn.addEventListener('click', () => submit(false));
    };

    intro();
    p.append(pager(item));
    return p;
  }

  function nextChapterUnlocked(item) {
    const nextCh = chapterAt(indexOfChapter(item.chapter) + 1);
    return !nextCh || isUnlocked(nextCh) || examOf(item.chapter) !== item;
  }

  // ================================================================ views: review item

  function reviewItemView(item) {
    const p = page();
    p.append(itemCrumbs(item));
    p.append(h('h1', null, item.title));
    p.append(h('div', { class: 'meta-row' }, h('span', { class: 'tag tag-accent' }, 'Chapter review'),
      isDone(item.id) ? h('span', { class: 'tag tag-ok' }, '✓ Done') : null));
    const slots = [];
    const body = h('article', {
      class: 'prose',
      html: MD.render(item.body, {
        code: (lang, flags, code, extras) => {
          if (lang === 'cpp') { slots.push(() => exampleWidget(code, flags, extras)); return '<div data-slot="' + (slots.length - 1) + '"></div>'; }
          return '<pre class="plain">' + esc(code) + '</pre>';
        }
      })
    });
    body.querySelectorAll('[data-slot]').forEach((el) => el.replaceWith(slots[Number(el.dataset.slot)]()));
    p.append(body);
    if (item.questions.length) {
      p.append(h('h2', { style: { marginTop: '36px' } }, 'Mixed practice'));
      p.append(h('p', { class: 'page-sub' }, 'These mix this chapter with earlier ones on purpose. Mixing topics feels harder — and that difficulty is what makes it stick.'));
      item.questions.forEach((q) => p.append(questionWidget(q, { mode: 'instant', onAnswered: (r, first) => recordAnswer(q, r, first) }).el));
    }
    const foot = h('section', { class: 'lesson-foot' });
    const n = neighbours(item).next;
    foot.append(h('p', null, 'Read the summary and tried the practice?'));
    foot.append(h('button', {
      class: 'btn btn-primary btn-big',
      onclick: () => {
        const gained = complete(item.id, { xp: 15 });
        save();
        if (gained) toast('<b>Review done</b> · +' + gained + ' XP', 'ok');
        if (n) location.hash = '#/i/' + n.id;
      }
    }, isDone(item.id) ? 'Continue →' : 'Mark as reviewed ✓'));
    p.append(foot);
    p.append(pager(item));
    return p;
  }

  // ================================================================ views: challenge

  function challengeView(item) {
    const p = page('page-wide');
    p.append(itemCrumbs(item));
    const task = item.task;
    const left = h('div');
    left.append(h('h1', null, item.title));
    left.append(h('div', { class: 'meta-row' },
      h('span', { class: 'tag' }, stars(item.difficulty), ' ', ['', 'Warm-up', 'Solid', 'Hard'][item.difficulty]),
      h('span', { class: 'tag' }, '+' + Engine.XP.challenge[item.difficulty] + ' XP'),
      task.tags.map((t) => h('span', { class: 'tag' }, t)),
      isDone(item.id) ? h('span', { class: 'tag tag-ok' }, '✓ Solved') : null));
    const banner = compilerBanner();
    if (banner) left.append(banner);
    left.append(md(task.prompt));
    const visible = task.tests.filter((t) => !t.hidden);
    if (visible.length) {
      left.append(h('h3', null, 'Examples'));
      const ex = h('div', { class: 'examples' });
      visible.slice(0, 3).forEach((t) => ex.append(h('div', { class: 'example-case' },
        ioBox('Input', t.input === '' ? '(none)' : t.input), ioBox('Output', t.output))));
      left.append(ex);
      const hidden = task.tests.length - visible.length;
      if (hidden) left.append(h('p', { style: { color: 'var(--text-dim)', fontSize: '13px' } }, '+ ' + plural(hidden, 'hidden test') + ' with other inputs.'));
    } else if (task.harness) {
      left.append(h('p', { style: { color: 'var(--text-dim)', fontSize: '13px' } }, 'Your functions are tested directly — you don\'t need to write main().'));
    }
    const widget = taskWidget(task, {
      kind: 'challenge',
      showPrompt: false,
      onSolved: (result, wasDone) => {
        const gained = complete(item.id, { xp: Engine.XP.challenge[item.difficulty] });
        save();
        if (!wasDone) {
          const n = neighbours(item).next;
          celebrate('🧩', 'Challenge solved!', (gained ? '**+' + gained + ' XP.** ' : '') + 'Compare your code with the solution — seeing another approach is part of the lesson.',
            n ? { label: 'Next: ' + n.title, run: () => { location.hash = '#/i/' + n.id; } } : null);
        }
      }
    });
    p.append(h('div', { class: 'split' }, left, widget.el));
    p.append(pager(item));
    return p;
  }

  // ================================================================ views: project

  function projectView(item) {
    const p = page('page-wide');
    p.append(itemCrumbs(item));
    p.append(h('h1', null, item.title));
    const doneCount = item.milestones.filter((m) => isDone(m.id)).length;
    p.append(h('div', { class: 'meta-row' },
      h('span', { class: 'tag', style: { color: 'var(--violet)' } }, '🏗️ Project'),
      h('span', { class: 'tag' }, doneCount + '/' + item.milestones.length + ' milestones'),
      isDone(item.id) ? h('span', { class: 'tag tag-ok' }, '✓ Complete') : null));
    const banner = compilerBanner();
    if (banner) p.append(banner);
    if (item.body) p.append(md(item.body));

    const firstOpen = item.milestones.findIndex((m) => !isDone(m.id));
    let current = firstOpen === -1 ? item.milestones.length - 1 : firstOpen;
    const steps = h('ol', { class: 'item-list', style: { margin: '18px 0' } });
    const stage = h('div');
    p.append(steps, stage);

    const draw = () => {
      steps.replaceChildren();
      item.milestones.forEach((m, i) => {
        const done = isDone(m.id);
        const reachable = i === 0 || isDone(item.milestones[i - 1].id) || done;
        const row = h(reachable ? 'a' : 'div', {
          class: 'item-row' + (done ? ' is-done' : ''),
          href: reachable ? 'javascript:void 0' : null,
          style: { opacity: reachable ? 1 : 0.5, outline: i === current ? '2px solid var(--accent)' : null }
        },
        h('span', { class: 'ir-icon' }, done ? '✓' : String(i + 1)),
        h('span', { class: 'ir-main' }, h('div', { class: 'ir-title' }, m.title || 'Milestone ' + (i + 1))),
        h('span', { class: 'ir-side' }, done ? '✓ Done' : reachable ? 'Open' : '🔒'));
        if (reachable) row.addEventListener('click', () => { current = i; draw(); });
        steps.append(h('li', null, row));
      });
      const m = item.milestones[current];
      stage.replaceChildren(
        h('h2', null, 'Milestone ' + (current + 1) + ': ' + (m.title || '')),
        md(m.prompt));
      const firstStarter = item.milestones[0].starter;
      if (!P.code[item.id]) P.code[item.id] = { src: m.starter || firstStarter, at: iso() };
      const w = taskWidget(Object.assign({}, m, { starter: m.starter || firstStarter }), {
        kind: 'milestone',
        codeKey: item.id,
        showPrompt: false,
        onSolved: (result, wasDone) => {
          complete(m.id, { xp: Engine.XP.milestone });
          const all = item.milestones.every((x) => isDone(x.id));
          let gained = 0;
          if (all) gained = complete(item.id, { xp: 150 });
          save();
          if (all && !wasDone) {
            celebrate('🏗️', 'Project complete!', (gained ? '**+' + gained + ' XP.** ' : '') + 'You built a real program, one step at a time. That is how all software gets written.');
          } else if (!wasDone) {
            toast('<b>Milestone ' + (current + 1) + ' done!</b> On to the next one.', 'ok');
            if (current < item.milestones.length - 1) { current += 1; draw(); main.scrollTop = 0; }
          }
        }
      });
      stage.append(w.el);
    };
    draw();
    p.append(pager(item));
    return p;
  }

  // ================================================================ views: review page

  function reviewView(tab) {
    const p = page();
    p.append(h('h1', null, 'Review'));
    p.append(h('p', { class: 'page-sub' }, 'Memory fades on a curve; each well-timed review flattens it. A few minutes a day here is worth more than hours of re-reading.'));
    const tabs = h('div', { class: 'tabs-row' });
    const body = h('div');
    const names = [['cards', 'Flashcards (' + dueCards().length + ' due)'], ['mistakes', 'Mistake bank (' + openMistakes().length + ')'], ['mixed', 'Mixed practice']];
    names.forEach(([id, label]) => tabs.append(h('button', {
      class: id === tab ? 'is-active' : '',
      onclick: () => { location.hash = '#/review/' + id; }
    }, label)));
    p.append(tabs, body);
    if (tab === 'mistakes') body.append(mistakesPanel());
    else if (tab === 'mixed') body.append(mixedPanel());
    else body.append(cardsPanel());
    return p;
  }

  function intervalLabel(days) {
    if (days <= 0) return 'again today';
    if (days === 1) return 'tomorrow';
    if (days < 30) return 'in ' + days + ' days';
    if (days < 365) return 'in ~' + Math.round(days / 30) + ' mo';
    return 'in a year';
  }

  function cardsPanel(ahead) {
    const wrap = h('div');
    let queue = dueCards();
    if (ahead) {
      queue = Object.keys(P.cards).filter((id) => cardById(id))
        .sort((a, b) => String(P.cards[a].due).localeCompare(String(P.cards[b].due))).slice(0, 20);
    }
    queue = Engine.shuffle(queue).slice(0, 40);
    const total = Object.keys(P.cards).filter((id) => cardById(id)).length;

    if (!queue.length) {
      const upcoming = Object.keys(P.cards).map((id) => P.cards[id].due).sort()[0];
      wrap.append(h('div', { class: 'empty-state' },
        h('div', { class: 'big-emoji' }, total ? '✅' : '🗂️'),
        h('p', null, total ? 'All caught up! ' + plural(total, 'card') + ' in your deck' + (upcoming ? '; the next is due ' + upcoming + '.' : '.')
          : 'Your deck is empty. Each lesson you complete adds its key ideas as flashcards.'),
        total ? h('button', { class: 'btn', onclick: () => wrap.replaceWith(cardsPanel(true)) }, 'Practise ahead anyway') : null));
      return wrap;
    }

    let done = 0;
    const progress = h('div', { class: 'quiz-progress' }, h('i', { style: { width: '0%' } }));
    const stage = h('div');
    wrap.append(progress, stage);

    const show = () => {
      if (!queue.length) {
        progress.firstChild.style.width = '100%';
        stage.replaceChildren(h('div', { class: 'empty-state' }, h('div', { class: 'big-emoji' }, '🎉'),
          h('p', null, 'Session complete — ' + plural(done, 'review') + '. See you tomorrow!'),
          h('a', { class: 'btn btn-primary', href: '#/' }, 'Back home')));
        refreshChrome();
        return;
      }
      progress.firstChild.style.width = pct(Math.min(1, done / (done + queue.length)));
      const id = queue[0];
      const card = cardById(id);
      const state = P.cards[id];
      const lesson = course.byId[card.lesson];
      const fc = h('div', { class: 'flashcard' },
        h('div', { class: 'fc-side' }, 'Question' + (lesson ? ' · ' + itemLabel(lesson) + ' ' + lesson.title : '')),
        md(card.front));
      const showBtn = h('button', { class: 'btn btn-primary btn-big', style: { width: '100%' } }, 'Show answer');
      const actions = h('div', null, showBtn);
      stage.replaceChildren(fc, actions);
      showBtn.focus();
      showBtn.addEventListener('click', () => {
        fc.append(h('div', { class: 'fc-back' }, h('div', { class: 'fc-side' }, 'Answer'), md(card.back)));
        const row = h('div', { class: 'grade-row' });
        Engine.GRADES.forEach((g, gi) => {
          const next = Engine.schedule(state, gi);
          row.append(h('button', {
            class: 'g-' + g,
            onclick: () => {
              P.cards[id] = next;
              bump('reviews');
              addDayXp(Engine.XP.review);
              save({ quiet: true });
              queue.shift();
              if (gi === 0) queue.push(id);
              done += 1;
              show();
            }
          }, ['Forgot', 'Hard', 'Good', 'Easy'][gi], h('small', null, intervalLabel(next.interval))));
        });
        actions.replaceChildren(h('p', { style: { color: 'var(--text-dim)', fontSize: '13px', margin: '0 0 8px' } }, 'How well did you remember it? Be honest — it only changes when you see it next.'), row);
      });
    };
    show();
    return wrap;
  }

  function mistakesPanel() {
    const wrap = h('div');
    const ids = Engine.shuffle(openMistakes());
    if (!ids.length) {
      wrap.append(h('div', { class: 'empty-state' }, h('div', { class: 'big-emoji' }, '🧹'),
        h('p', null, 'No open mistakes. Questions you get wrong in lessons, quizzes and exams land here until you get each right twice in a row.')));
      return wrap;
    }
    wrap.append(h('p', { class: 'page-sub' }, 'Get a question right twice (on different visits) to clear it.'));
    ids.slice(0, 12).forEach((id) => {
      const q = course.questions[id].question;
      const owner = course.questions[id].item;
      const w = questionWidget(q, {
        mode: 'instant',
        kicker: 'From ' + itemLabel(owner) + ': ' + owner.title,
        onAnswered: (result) => {
          const m = Object.assign({}, P.mistakes[id]);
          if (result.ok) {
            m.streak = (m.streak || 0) + 1;
            if (m.streak >= 2) { m.cleared = true; bump('cleared'); toast('Cleared from your mistake bank ✓', 'ok'); }
          } else {
            m.streak = 0;
            m.count = (m.count || 0) + 1;
          }
          m.at = iso();
          P.mistakes[id] = m;
          addDayXp(1);
          save();
        }
      });
      wrap.append(w.el);
    });
    return wrap;
  }

  function mixedPanel() {
    const wrap = h('div');
    const pool = [];
    course.items.forEach((item) => {
      if (item.type !== 'lesson' || !isDone(item.id)) return;
      item.checks.forEach((q) => { if (q.type !== 'code') pool.push({ q, item }); });
    });
    course.items.forEach((item) => {
      if ((item.type === 'quiz' || item.type === 'review') && isUnlocked(item.chapter)) {
        const lessonsDone = item.chapter.items.filter((x) => x.type === 'lesson').every((x) => isDone(x.id));
        if (lessonsDone) item.questions.forEach((q) => { if (q.type !== 'code') pool.push({ q, item }); });
      }
    });
    if (!pool.length) {
      wrap.append(h('div', { class: 'empty-state' }, h('div', { class: 'big-emoji' }, '🎲'),
        h('p', null, 'Mixed practice draws questions from lessons you have completed. Finish a lesson or two first.')));
      return wrap;
    }
    wrap.append(h('p', { class: 'page-sub' }, '10 questions from across everything you have studied, shuffled. Mixing topics ("interleaving") trains you to pick the right tool, not just use the one the chapter is about.'));
    Engine.shuffle(pool).slice(0, 10).forEach(({ q, item }, i) => {
      wrap.append(questionWidget(q, {
        mode: 'instant',
        kicker: (i + 1) + ' · ' + itemLabel(item) + ': ' + item.title,
        onAnswered: (result, first) => recordAnswer(q, result, first)
      }).el);
    });
    wrap.append(h('div', { style: { textAlign: 'center' } }, h('button', { class: 'btn', onclick: () => route() }, 'New set of 10')));
    return wrap;
  }

  // ================================================================ views: playground

  const TEMPLATES = [
    { name: 'Hello, World', src: '#include <iostream>\n\nint main() {\n    std::cout << "Hello, World!\\n";\n    return 0;\n}\n' },
    { name: 'Read two numbers', src: '#include <iostream>\n\nint main() {\n    int a{};\n    int b{};\n    std::cin >> a >> b;\n    std::cout << a << " + " << b << " = " << a + b << \'\\n\';\n    return 0;\n}\n', stdin: '3 4' },
    { name: 'Vector and loop', src: '#include <iostream>\n#include <vector>\n\nint main() {\n    std::vector<int> numbers{4, 8, 15, 16, 23, 42};\n    int sum{0};\n    for (int n : numbers) {\n        sum += n;\n    }\n    std::cout << "Sum: " << sum << \'\\n\';\n    return 0;\n}\n' },
    { name: 'A class', src: '#include <iostream>\n#include <string>\n\nclass Counter {\npublic:\n    void increment() { ++count_; }\n    int value() const { return count_; }\nprivate:\n    int count_{0};\n};\n\nint main() {\n    Counter c;\n    c.increment();\n    c.increment();\n    std::cout << c.value() << \'\\n\';\n    return 0;\n}\n' }
  ];

  function openInPlayground(src, stdin) {
    const id = 's' + Date.now().toString(36);
    P.snippets[id] = { name: 'From a lesson', src, stdin: stdin || '', at: iso() };
    save({ quiet: true });
    location.hash = '#/playground/' + id;
  }

  function playgroundView(id) {
    const p = page('page-wide');
    p.append(h('h1', null, 'Playground'));
    p.append(h('p', { class: 'page-sub' }, 'Your own space to try anything. Experimenting — "what happens if I change this?" — is how programmers really learn. Snippets are saved with your progress.'));
    const banner = compilerBanner();
    if (banner) p.append(banner);

    const ids = Object.keys(P.snippets).filter((k) => P.snippets[k] && !P.snippets[k].deleted)
      .sort((a, b) => String(P.snippets[b].at).localeCompare(String(P.snippets[a].at)));
    if (!ids.length) {
      const first = 's' + Date.now().toString(36);
      P.snippets[first] = { name: 'My first program', src: TEMPLATES[0].src, stdin: '', at: iso() };
      save({ quiet: true });
      ids.push(first);
    }
    const currentId = id && P.snippets[id] && !P.snippets[id].deleted ? id : ids[0];
    const snip = P.snippets[currentId];

    const list = h('ul', { class: 'pg-list' });
    list.append(h('li', null, h('button', {
      class: '',
      style: { color: 'var(--accent)' },
      onclick: () => {
        const nid = 's' + Date.now().toString(36);
        P.snippets[nid] = { name: 'Untitled ' + (ids.length + 1), src: TEMPLATES[0].src, stdin: '', at: iso() };
        save({ quiet: true });
        location.hash = '#/playground/' + nid;
      }
    }, '＋ New snippet')));
    ids.forEach((k) => list.append(h('li', null, h('button', {
      class: k === currentId ? 'is-active' : '',
      onclick: () => { location.hash = '#/playground/' + k; }
    }, P.snippets[k].name || 'Untitled'))));

    const persist = () => {
      P.snippets[currentId] = Object.assign({}, P.snippets[currentId], { src: editor.ed.getValue(), stdin: stdin.value, name: name.value, at: iso() });
      save({ quiet: true });
    };
    let timer = null;
    const later = () => { clearTimeout(timer); timer = setTimeout(persist, 600); };

    const name = h('input', { class: 'pg-name', value: snip.name || '', 'aria-label': 'Snippet name' });
    name.addEventListener('change', () => { persist(); route(); });
    const editor = codeEditor(snip.src, { minLines: 16, maxLines: 40, onChange: later, onRun: () => run() });
    const stdin = h('textarea', { class: 'io-input', placeholder: 'Input for the program (what a user would type)', spellcheck: 'false' });
    stdin.value = snip.stdin || '';
    stdin.addEventListener('input', later);
    const out = h('div', { class: 'out' });
    const runBtn = h('button', { class: 'mini-btn is-run' }, '▶ Run');
    const templateSel = h('select', { class: 'pg-name', style: { flex: '0 0 auto', minWidth: 0 }, 'aria-label': 'Start from a template' },
      h('option', { value: '' }, 'Template…'), TEMPLATES.map((t, i) => h('option', { value: String(i) }, t.name)));
    templateSel.addEventListener('change', () => {
      const t = TEMPLATES[Number(templateSel.value)];
      templateSel.value = '';
      if (!t || !confirm('Replace this snippet\'s code with "' + t.name + '"?')) return;
      editor.set(t.src);
      stdin.value = t.stdin || '';
      persist();
    });

    async function run() {
      runBtn.disabled = true;
      out.replaceChildren(spinner());
      try { showRun(out, await runCpp({ source: editor.ed.getValue(), stdin: stdin.value }), { editor: editor.ed }); } catch (e) { showRunError(out, e); }
      runBtn.disabled = false;
    }
    runBtn.addEventListener('click', run);

    const panel = h('div', { class: 'task', style: { margin: 0 } },
      h('div', { class: 'task-bar' }, name, runBtn, templateSel,
        h('button', { class: 'mini-btn', onclick: () => copyText(editor.ed.getValue()) }, 'Copy'),
        h('button', {
          class: 'mini-btn',
          onclick: () => {
            if (!confirm('Delete this snippet?')) return;
            P.snippets[currentId] = { deleted: true, at: iso() };
            save({ quiet: true });
            location.hash = '#/playground';
            route();
          }
        }, 'Delete')),
      h('div', { class: 'task-editor' }, editor.host),
      h('details', { class: 'task-io', open: true }, h('summary', null, 'Input (stdin)'), stdin),
      out);
    p.append(h('div', { class: 'pg' }, list, panel));
    view.cleanup.push(() => { clearTimeout(timer); persist(); });
    return p;
  }

  // ================================================================ views: glossary

  function glossaryView() {
    const p = page();
    p.append(h('h1', null, 'Glossary'));
    p.append(h('p', { class: 'page-sub' }, 'Every term the course uses, in plain words.'));
    const input = h('input', { class: 'gloss-search', type: 'search', placeholder: 'Search ' + course.glossary.length + ' terms…', 'aria-label': 'Search the glossary' });
    const list = h('div');
    const draw = () => {
      const q = input.value.trim().toLowerCase();
      list.replaceChildren();
      const terms = course.glossary
        .filter((t) => !q || t.term.toLowerCase().indexOf(q) !== -1 || t.def.toLowerCase().indexOf(q) !== -1)
        .sort((a, b) => a.term.toLowerCase().localeCompare(b.term.toLowerCase()));
      let letter = '';
      let dl = null;
      terms.forEach((t) => {
        const first = t.term.replace(/^[^A-Za-z]+/, '').charAt(0).toUpperCase() || '#';
        if (first !== letter) {
          letter = first;
          list.append(h('div', { class: 'gloss-letter' }, letter));
          dl = h('dl', { class: 'gloss' });
          list.append(dl);
        }
        const ch = course.chapters.find((c) => c.id === t.chapter);
        dl.append(h('dt', null, t.term), h('dd', null, mdInline(t.def), ch ? h('span', null, ' ', h('a', { href: '#/c/' + ch.id }, '(Chapter ' + ch.number + ')')) : null));
      });
      if (!terms.length) list.append(h('p', { class: 'page-sub' }, 'No term matches “' + input.value + '”.'));
    };
    input.addEventListener('input', draw);
    draw();
    p.append(input, list);
    setTimeout(() => input.focus(), 0);
    return p;
  }

  // ================================================================ views: progress

  function progressView() {
    const p = page('page-wide');
    p.append(h('h1', null, 'Your progress'));
    const level = Engine.levelFor(totalXp());
    const c = counts();
    const allLessons = course.items.filter((i) => i.type === 'lesson').length;
    const allChallenges = course.items.filter((i) => i.type === 'challenge').length;
    const allExams = course.items.filter((i) => i.type === 'exam').length;
    const cards = Object.keys(P.cards).filter((id) => cardById(id)).length;

    p.append(h('div', { class: 'cards-row' },
      h('div', { class: 'stat-card' }, h('h3', null, 'Level ' + level.level + ' · ' + level.title),
        h('div', { class: 'big' }, level.xp + ' XP'),
        h('div', { class: 'bar', style: { margin: '10px 0 4px' } }, h('i', { style: { width: pct(level.progress) } })),
        h('p', null, level.next ? (level.next - level.xp) + ' XP to level ' + (level.level + 1) : 'Top level reached!')),
      h('div', { class: 'stat-card' }, h('h3', null, 'Lessons'), h('div', { class: 'big' }, c.lessons + ' / ' + allLessons),
        h('div', { class: 'bar ok', style: { marginTop: '10px' } }, h('i', { style: { width: pct(c.lessons / (allLessons || 1)) } }))),
      h('div', { class: 'stat-card' }, h('h3', null, 'Challenges solved'), h('div', { class: 'big' }, c.challenges.length + ' / ' + allChallenges),
        h('div', { class: 'bar ok', style: { marginTop: '10px' } }, h('i', { style: { width: pct(c.challenges.length / (allChallenges || 1)) } }))),
      h('div', { class: 'stat-card' }, h('h3', null, 'Exams passed'), h('div', { class: 'big' }, c.exams + ' / ' + allExams)),
      h('div', { class: 'stat-card' }, h('h3', null, 'Memory'), h('div', { class: 'big' }, String(cards)),
        h('p', null, plural(c.reviews, 'review') + ' done · ' + dueCards().length + ' due')),
      h('div', { class: 'stat-card' }, h('h3', null, 'Programs run'), h('div', { class: 'big' }, String(c.runs)),
        h('p', null, plural(c.compileErrors, 'compile error') + ' met and fixed along the way'))));

    p.append(h('div', { class: 'section-title' }, 'Activity — last 20 weeks'));
    const heat = h('div', { class: 'heatmap', 'aria-label': 'Daily activity' });
    const end = today();
    // Each column is a week starting on Sunday, so the first cell is a Sunday.
    const cells = 7 * 19 + new Date().getDay() + 1;
    for (let i = cells - 1; i >= 0; i -= 1) {
      const key = Engine.addDays(end, -i);
      const xp = P.days[key] || 0;
      const lvl = xp === 0 ? '' : xp < 20 ? 'h1' : xp < 50 ? 'h2' : xp < 100 ? 'h3' : 'h4';
      heat.append(h('i', { class: lvl, title: key + ': ' + xp + ' XP' }));
    }
    p.append(heat);

    p.append(h('div', { class: 'section-title' }, 'Chapter mastery'));
    const table = h('table', { class: 'mastery-table' },
      h('thead', null, h('tr', null, ['Chapter', 'Lessons', 'Challenges', 'Best exam', 'Mastery'].map((t) => h('th', null, t)))));
    const tbody = h('tbody');
    course.chapters.forEach((ch) => {
      const st = chapterStats(ch);
      const best = st.exam ? (rec(st.exam.id) || {}).best : null;
      tbody.append(h('tr', null,
        h('td', null, h('a', { href: '#/c/' + ch.id }, ch.number + '. ' + ch.title), isUnlocked(ch) ? null : ' 🔒'),
        h('td', { class: 'num' }, st.lessons[0] + '/' + st.lessons[1]),
        h('td', { class: 'num' }, st.challenges[0] + '/' + st.challenges[1]),
        h('td', { class: 'num' }, best ? pct(best) + (st.examPassed ? ' ✓' : '') : '—'),
        h('td', { class: 'num', style: { color: st.mastered ? 'var(--ok)' : null } }, pct(st.mastery) + (st.mastered ? ' ★' : ''))));
    });
    table.append(tbody);
    p.append(h('div', { class: 'table-wrap' }, table));

    p.append(h('div', { class: 'section-title' }, 'Badges'));
    const badges = h('div', { class: 'badges' });
    badgeList().forEach((b) => {
      const got = P.badges[b.id];
      badges.append(h('div', { class: 'badge' + (got ? ' is-earned' : ''), title: got ? 'Earned ' + String(got).slice(0, 10) : 'Not earned yet' },
        h('div', { class: 'b-icon' }, b.icon), h('div', { class: 'b-name' }, b.name), h('div', { class: 'b-desc' }, b.desc)));
    });
    p.append(badges);

    p.append(h('div', { class: 'section-title' }, 'Your data'));
    const fileInput = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });
    fileInput.addEventListener('change', () => {
      const file = fileInput.files[0];
      if (!file) return;
      file.text().then((text) => {
        const data = JSON.parse(text);
        P = Engine.mergeProgress(P, data.progress || data);
        save();
        toast('Progress imported and merged', 'ok');
        route();
      }).catch(() => toast('That file is not a progress backup', 'err'));
    });
    p.append(h('p', { class: 'page-sub' }, sync.storage === 'github'
      ? 'Your progress is saved in this browser and synced to your GitHub repository (branch au-learn), so it follows you to any device where you sign in.'
      : 'Your progress is saved in this browser and on the server. (With GitHub storage configured, it also survives server restarts.)'));
    p.append(h('div', { class: 'row-actions' },
      h('button', {
        class: 'btn',
        onclick: () => {
          const blob = new Blob([JSON.stringify({ progress: P }, null, 2)], { type: 'application/json' });
          const a = h('a', { href: URL.createObjectURL(blob), download: 'learn-cpp-progress-' + today() + '.json' });
          document.body.append(a);
          a.click();
          a.remove();
        }
      }, 'Download a backup'),
      h('button', { class: 'btn', onclick: () => fileInput.click() }, 'Import a backup'),
      h('button', { class: 'btn', onclick: () => { sync.dirty = true; push(); } }, 'Sync now'),
      h('button', {
        class: 'btn',
        style: { color: 'var(--err)' },
        onclick: () => {
          if (!confirm('Reset ALL your Learn progress — lessons, scores, flashcards, notes, snippets — on every device?')) return;
          if (!confirm('Really? This cannot be undone (unless you downloaded a backup).')) return;
          const at = iso();
          P = Engine.mergeProgress(Engine.emptyProgress(), Object.assign(Engine.emptyProgress(), { resetAt: at, updatedAt: at }));
          save();
          toast('Progress reset', 'ok');
          location.hash = '#/';
        }
      }, 'Reset progress…'),
      fileInput));
    p.append(h('p', { style: { color: 'var(--text-dim)', fontSize: '12.5px', marginTop: '14px' } },
      compiler.available ? 'C++ runs on: ' + (compiler.compiler || compiler.backend) + (compiler.std ? ' (' + compiler.std + ')' : '')
        : 'C++ is not available on this server: ' + (compiler.reason || '')));
    return p;
  }

  function methodView() {
    const p = page();
    p.append(crumbs([{ label: 'Home', href: '#/' }, { label: 'How this course works' }]));
    p.append(h('h1', null, 'How this course works'));
    p.append(md(course.method || ''));
    const up = nextUp();
    if (up) p.append(h('div', { class: 'lesson-foot' }, h('a', { class: 'btn btn-primary btn-big', href: '#/i/' + up.id }, 'Start: ' + up.title + ' →')));
    return p;
  }

  // ================================================================ outline

  function renderOutline() {
    if (!course) return;
    const q = document.getElementById('outline-search').value.trim().toLowerCase();
    const active = currentItemId();
    const activeChapter = active && course.byId[active] ? course.byId[active].chapter.id : currentChapterId();
    const openBefore = new Set(Array.from(outline.querySelectorAll('details[open]')).map((d) => d.dataset.ch));
    const scroll = outline.scrollTop;
    outline.replaceChildren();
    outline.append(h('div', { class: 'lt-side-mobile-nav' },
      h('a', { href: '#/' }, '🏠 Home'), h('a', { href: '#/review' }, '🔁 Review'), h('a', { href: '#/playground' }, '🧪 Playground'),
      h('a', { href: '#/glossary' }, '📖 Glossary'), h('a', { href: '#/progress' }, '📈 Progress'), h('a', { href: '../' }, '← Editor')));
    let any = false;
    course.parts.forEach((part) => {
      const partEl = h('div', null, h('div', { class: 'ol-part' }, part.title));
      let partAny = false;
      part.chapters.forEach((ch) => {
        const items = ch.items.filter((it) => !q || it.title.toLowerCase().indexOf(q) !== -1 || ch.title.toLowerCase().indexOf(q) !== -1);
        if (!items.length) return;
        partAny = true;
        const st = chapterStats(ch);
        const locked = !isUnlocked(ch);
        const det = h('details', {
          class: 'ol-chapter' + (st.mastered ? ' is-mastered' : '') + (locked ? ' is-locked' : '') + (ch.id === activeChapter ? ' is-current' : ''),
          'data-ch': ch.id,
          open: q || ch.id === activeChapter || openBefore.has(ch.id) ? true : null
        });
        det.append(h('summary', null,
          h('span', { class: 'ol-num' }, locked ? '🔒' : st.mastered ? '✓' : String(ch.number)),
          h('span', { class: 'ol-title' }, ch.title),
          h('span', { class: 'ol-meter' }, h('i', { style: { width: pct(st.mastery) } }))));
        const ul = h('ul', { class: 'ol-items' });
        ul.append(h('li', null, h('a', { href: '#/c/' + ch.id, class: currentChapterId() === ch.id ? 'is-active' : '' },
          h('span', { class: 'ol-mark' }, '◈'), 'Chapter overview')));
        items.forEach((it) => {
          const done = isDone(it.id);
          ul.append(h('li', null, h('a', {
            href: '#/i/' + it.id,
            class: 't-' + it.type + (done ? ' is-done' : '') + (it.id === active ? ' is-active' : '')
          },
          h('span', { class: 'ol-mark' }, done ? '✓' : locked ? '·' : '○'),
          h('span', null, it.title),
          it.type !== 'lesson' ? h('span', { class: 'ol-kind' }, typeName(it.type)) : null)));
        });
        det.append(ul);
        partEl.append(det);
      });
      if (partAny) { outline.append(partEl); any = true; }
    });
    if (!any) outline.append(h('div', { class: 'ol-empty' }, 'Nothing matches “' + q + '”.'));
    outline.scrollTop = scroll;
  }

  function currentItemId() {
    const m = /^#\/i\/([\w-]+)/.exec(location.hash);
    return m ? m[1] : null;
  }

  function currentChapterId() {
    const m = /^#\/c\/([\w-]+)/.exec(location.hash);
    return m ? m[1] : null;
  }

  // ================================================================ router

  let lastHash = location.hash;

  function route() {
    if (!course) return;
    view.cleanup.forEach((fn) => { try { fn(); } catch (e) { /* ignore */ } });
    view = { cleanup: [], guard: null };
    const hash = location.hash || '#/';
    lastHash = hash;
    const parts = hash.replace(/^#\/?/, '').split('/');
    let node;
    try {
      if (parts[0] === 'i' && course.byId[parts[1]]) {
        const item = course.byId[parts[1]];
        if (!isUnlocked(item.chapter)) node = lockedView(item, item.chapter);
        else {
          node = {
            lesson: lessonView, quiz: quizView, exam: examView, review: reviewItemView,
            challenge: challengeView, project: projectView
          }[item.type](item);
          touchVisit(item);
        }
      } else if (parts[0] === 'c' && course.chapters.find((c) => c.id === parts[1])) {
        node = chapterView(course.chapters.find((c) => c.id === parts[1]));
      } else if (parts[0] === 'review') node = reviewView(parts[1] || 'cards');
      else if (parts[0] === 'playground') node = playgroundView(parts[1]);
      else if (parts[0] === 'glossary') node = glossaryView();
      else if (parts[0] === 'progress') node = progressView();
      else if (parts[0] === 'method') node = methodView();
      else node = homeView();
    } catch (err) {
      console.error(err);
      node = h('div', { class: 'page' }, h('h1', null, 'Something went wrong'), h('pre', { class: 'plain' }, String(err && err.stack || err)));
    }
    main.replaceChildren(node);
    main.scrollTop = 0;
    document.querySelectorAll('.lt-nav a').forEach((a) => {
      const nav = a.dataset.nav;
      a.classList.toggle('is-active', (nav === 'home' && (parts[0] === '' || parts[0] === undefined)) || nav === parts[0]);
    });
    document.body.classList.remove('side-open');
    document.getElementById('btn-menu').setAttribute('aria-expanded', 'false');
    const title = node.querySelector('h1');
    document.title = (title ? title.textContent + ' · ' : '') + 'Learn C++';
    renderOutline();
    const active = outline.querySelector('a.is-active');
    if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest' });
  }

  function touchVisit(item) {
    if (!P.items[item.id]) {
      touch(item.id, { status: 'started' });
      save({ quiet: true });
    }
    P.settings = Object.assign({}, P.settings, { last: item.id, at: iso() });
  }

  window.addEventListener('hashchange', () => {
    if (view.guard && !view.guard()) {
      history.replaceState(null, '', lastHash);
      return;
    }
    route();
  });

  window.addEventListener('beforeunload', (e) => {
    if (view.guard) { e.preventDefault(); e.returnValue = ''; }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && sync.dirty) {
      try {
        const body = JSON.stringify({ progress: P });
        if (body.length < 60000) {
          fetch('/api/learn/progress', { method: 'PUT', headers: { 'content-type': 'application/json' }, body, keepalive: true })
            .then(() => { sync.dirty = false; }, () => {});
        } else push();
      } catch (e) { /* best effort */ }
    }
  });

  document.getElementById('btn-menu').addEventListener('click', () => {
    const open = !document.body.classList.contains('side-open');
    document.body.classList.toggle('side-open', open);
    document.getElementById('btn-menu').setAttribute('aria-expanded', String(open));
  });
  document.getElementById('scrim').addEventListener('click', () => document.body.classList.remove('side-open'));
  document.getElementById('outline-search').addEventListener('input', renderOutline);

  // ================================================================ boot

  async function fetchText(url) {
    const res = await fetch(url, { cache: 'no-cache' });
    if (res.status === 401) { signIn(); throw new Error('Not signed in'); }
    if (!res.ok) throw new Error('Could not load ' + url + ' (' + res.status + ')');
    return res.text();
  }

  async function loadCourse() {
    const index = Course.parseYaml(await fetchText('course/course.yml'), 'course.yml');
    const files = index.chapters || [];
    // A chapter that fails to load is left out rather than taking the course down.
    const settled = await Promise.allSettled(files.map((f) => fetchText('course/' + f + '.yml')));
    const docs = [];
    settled.forEach((r, i) => {
      if (r.status !== 'fulfilled') { console.warn('Skipping chapter', files[i], r.reason); return; }
      try { docs.push(Course.parseYaml(r.value, files[i] + '.yml')); } catch (e) { console.error(e); }
    });
    let glossary = null;
    try { glossary = Course.parseYaml(await fetchText('course/glossary.yml'), 'glossary.yml'); } catch (e) { glossary = null; }
    return Course.buildCourse(index, docs, { glossary });
  }

  async function boot() {
    const local = loadLocal();
    if (local) P = Engine.mergeProgress(Engine.emptyProgress(), local);
    setSync('busy', 'Connecting…');
    const statusDone = loadCompilerStatus().then(() => { compiler.pending = false; });
    try {
      course = await loadCourse();
    } catch (err) {
      main.replaceChildren(h('div', { class: 'page' }, h('h1', null, 'The course could not be loaded'),
        h('pre', { class: 'plain' }, String(err && err.message || err))));
      return;
    }
    lastLevel = Engine.levelFor(totalXp()).level;
    route();
    const before = JSON.stringify(P);
    await Promise.all([pull(), statusDone]);
    lastLevel = Engine.levelFor(totalXp()).level;
    refreshChrome();
    // Re-render once the server's copy (maybe from another device) is merged in.
    const focused = document.activeElement && document.activeElement.closest && document.activeElement.closest('.ed, textarea, input');
    if (JSON.stringify(P) !== before && !view.guard && !focused) route();
    else if (!compiler.available) route();
    setInterval(() => { if (sync.dirty) push(); }, 60000);
  }

  window.LearnApp = { route, get progress() { return P; }, get course() { return course; } };
  boot();
})();
