/*
 * Learn mode: courses in C++, HTML, CSS and JavaScript inside Actually Useful.
 *
 * courses.yml lists the courses; each has its own folder of chapter files
 * (the C++ course lives in course/). This file turns them into pages —
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
  const Web = window.LearnWeb;
  const MiniEditor = window.MiniEditor;

  const STORE_KEY = 'au-learn-progress-v1';
  const LINE_PX = 21.6;
  const DAILY_GOAL = 60;

  const main = document.getElementById('main');
  const outline = document.getElementById('outline');
  const syncState = document.getElementById('sync-state');
  syncState.addEventListener('click', () => { if (sync.storage === 'local') location.hash = '#/progress'; });

  // Every course, and the one being looked at. Ids are unique across courses,
  // so one progress record and one index (ALL) serve them all.
  let courses = [];
  let course = null;
  const ALL = { byId: {}, questions: {}, cards: [], items: [], chapters: [] };
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

  const EDITOR_MODES = { cpp: 'cpp', 'c++': 'cpp', html: 'html', css: 'css', js: 'js', javascript: 'js' };

  /** Syntax colouring; the language defaults to the current course's. */
  function highlight(code, lang) {
    const mode = EDITOR_MODES[lang || (course && course.codeLang) || 'cpp'] || 'text';
    return MiniEditor.highlight(mode, String(code));
  }

  function staticCode(lang, flags, code) {
    if (EDITOR_MODES[lang]) return '<pre class="q-code">' + highlight(code, lang) + '</pre>';
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
      if (sync.storage === 'local') {
        // The open version keeps nothing on the server: this browser is the only copy.
        sync.online = true;
        sync.dirty = false;
        setSync('local', syncLabel());
        return;
      }
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
    if (sync.storage === 'local') return 'Saved in this browser — download a backup';
    return sync.storage === 'github' ? 'Progress synced to GitHub' : 'Progress saved on the server';
  }

  async function push() {
    if (sync.storage === 'local') { sync.dirty = false; return; }
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
    if (!cur.doneAt && sync.storage === 'local') {
      // With no server copy, a nudge every ten finished items keeps a recent backup around.
      const finished = Object.keys(P.items).filter((k) => P.items[k].status === 'done').length;
      if (finished % 10 === 0) {
        setTimeout(() => toast('<b>' + finished + ' done!</b> Your progress lives only in this browser — <a href="#/progress">download a backup</a> to keep it safe.', 'ok'), 1500);
      }
    }
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
  // Chapter order, and so what unlocks what, is per course.
  function chapterAfter(ch, delta) { return ch.course.chapters[ch.course.chapters.indexOf(ch) + delta] || null; }

  function isUnlocked(ch) {
    const i = ch.course.chapters.indexOf(ch);
    if (i <= 0 || P.unlocked[ch.id]) return true;
    const prev = chapterAfter(ch, -1);
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

  /** The next thing to do on a course's main path (challenges are extra practice). */
  function nextUp(c) {
    for (const ch of (c || course).chapters) {
      if (!isUnlocked(ch)) return null;
      for (const item of ch.items) {
        if (item.type === 'challenge') continue;
        if (!isDone(item.id)) return item;
      }
    }
    return null;
  }

  function neighbours(item) {
    const all = item.chapter.course.items;
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
      ALL.cards.forEach((c) => { cardIndex[c.id] = c; });
    }
    return cardIndex[id] || null;
  }

  function openMistakes() {
    return Object.keys(P.mistakes).filter((id) => {
      const m = P.mistakes[id];
      return m && !m.cleared && ALL.questions[id];
    });
  }

  // ================================================================ badges

  function counts() {
    const done = (type) => ALL.items.filter((i) => i.type === type && isDone(i.id));
    const exams = ALL.items.filter((i) => i.type === 'exam');
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
      { id: 'polyglot', icon: '🌍', name: 'Polyglot', desc: 'Completed lessons in three different courses', test: () => courses.filter((cr) => cr.items.some((i) => i.type === 'lesson' && isDone(i.id))).length >= 3 },
      { id: 'first-error', icon: '🧯', name: 'Met an Error', desc: 'Got your first error message — every programmer does, daily', test: (c) => c.compileErrors >= 1 },
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
    courses.forEach((c) => {
      c.parts.forEach((part) => {
        list.push({
          id: 'part-' + part.id,
          icon: '🏆',
          name: part.title,
          desc: 'Mastered every chapter in ' + part.title + (courses.length > 1 ? ' (' + c.short + ')' : ''),
          test: () => part.chapters.length > 0 && part.chapters.every((ch) => chapterStats(ch).mastered)
        });
      });
      if (c.final) {
        // The C++ badge keeps its original id so earned badges stay earned.
        list.push({
          id: c.id === 'cpp' ? 'graduate' : 'graduate-' + c.id,
          icon: '👑',
          name: c.graduate || c.short + ' Graduate',
          desc: 'Passed the ' + c.short + ' final exam',
          test: () => isDone(c.final)
        });
      }
    });
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

  function compilerBanner(forCourse) {
    // Web courses run in the browser; only C++ needs the server's compiler.
    if ((forCourse || course) && (forCourse || course).lang !== 'cpp') return null;
    if (compiler.available || compiler.pending) return null;
    return h('div', { class: 'banner', html: MD.inline('**C++ can\'t run on this server right now.** ' + esc(compiler.reason || '') +
      ' You can still read, answer quizzes and review. To run code, the server needs `g++` or internet access to godbolt.org — see the README.') });
  }

  // ================================================================ running web code

  /** JavaScript in a worker. Counts as a run (and any error as one met), like compiling C++ does. */
  async function runJs(code, harness) {
    bump('runs');
    const result = await Web.runJs({ code, harness, timeoutMs: harness ? 8000 : 5000 });
    if (result.errors.length) bump('compileErrors');
    save({ quiet: true });
    return result;
  }

  /** A page, with its checks, in a hidden frame. */
  async function runPage(files, harness, width) {
    bump('runs');
    const result = await Web.runPage({ files, harness, width: width || 800, timeoutMs: 10000 });
    if (result.errors.length) bump('compileErrors');
    save({ quiet: true });
    return result;
  }

  /** The given files with the learner's on top (same name → the learner's wins). */
  function mergeFiles(given, mine) {
    const out = (given || []).map((f) => ({ name: f.name, content: f.content }));
    (mine || []).forEach((f) => {
      const at = out.findIndex((g) => g.name === f.name);
      if (at === -1) out.push({ name: f.name, content: f.content }); else out[at] = { name: f.name, content: f.content };
    });
    return out;
  }

  /** Console lines, as a browser would show them. */
  function consoleLines(output) {
    const box = h('div', { class: 'web-console' });
    output.forEach((o) => box.append(h('div', { class: 'wc-line is-' + o.level }, o.text === '' ? ' ' : o.text)));
    return box;
  }

  /** JavaScript errors, explained; the line jumps into the editor. */
  function webErrorsView(errors, jump) {
    const wrap = h('div');
    errors.slice(0, 4).forEach((err) => {
      const box = h('div', { class: 'diag' });
      const head = h('div', { class: 'diag-head' });
      if (err.line) {
        head.append(h('button', {
          class: 'diag-line',
          title: jump ? 'Jump to this line' : '',
          onclick: () => { if (jump) jump(err.file, err.line); }
        }, (err.file && err.file !== 'script.js' ? err.file + ' ' : '') + 'line ' + err.line));
      } else if (err.where === 'checks') {
        head.append(h('span', { class: 'diag-line' }, 'checker'));
      }
      head.append(h('span', null, err.message));
      box.append(head);
      if (err.hint) box.append(h('div', { class: 'diag-hint', html: MD.inline(err.hint) }));
      wrap.append(box);
    });
    if (errors.length > 4) wrap.append(h('p', { class: 'out-mismatch' }, '…and ' + plural(errors.length - 4, 'more error') + '. Fix the first one first.'));
    return wrap;
  }

  /**
   * Shows how some JavaScript went: what it printed, what went wrong.
   * @param {{expected?: string, jump?: Function, edited?: boolean, pageNote?: boolean}} opts
   */
  function showWebRun(box, result, opts) {
    opts = opts || {};
    box.innerHTML = '';
    const syntax = result.errors.find((e) => e.where === 'syntax');
    if (syntax) {
      box.append(h('div', { class: 'out-head' }, h('b', { style: { color: 'var(--err)' } }, 'Didn\'t run'),
        h('span', { class: 'out-time' }, 'A syntax error stops the whole script before it starts')));
      box.append(webErrorsView([syntax], opts.jump));
      return;
    }
    box.append(h('div', { class: 'out-head' }, h('b', null, 'Console'),
      h('span', { class: 'out-time' }, 'ran in ' + (result.ms || 0) + ' ms')));
    if (result.output.length) box.append(consoleLines(result.output));
    else box.append(h('pre', { class: 'out-text is-empty' }, '(nothing was printed)'));
    if (result.errors.length) box.append(webErrorsView(result.errors, opts.jump));
    if (result.timedOut) {
      box.append(h('div', { class: 'out-note', html: MD.inline('The code was still running after a few seconds, so it was stopped. The usual cause is a loop whose condition never becomes false — or a `setInterval` that is never cleared.') }));
    }
    if (typeof opts.expected === 'string') {
      const cmp = Engine.compareOutput(Web.outputText(result), opts.expected);
      if (cmp.ok) box.append(h('div', { class: 'out-match' }, '✓ Matches the expected output'));
      else {
        box.append(h('div', { class: 'out-mismatch' }, 'Differs from the original output at line ' + cmp.line +
          (opts.edited ? ' — fine if you changed the code on purpose.' : '.')));
      }
    }
  }

  // ================================================================ editors

  /** A code editor (C++ unless told otherwise) that grows with its content. */
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
      mode: EDITOR_MODES[opts.mode] || 'cpp',
      value: value || '',
      ariaLabel: opts.label || ({ html: 'HTML', css: 'CSS', js: 'JavaScript' }[opts.mode] || 'C++') + ' code',
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
        onclick: () => openInPlayground({ lang: 'cpp', src: editor ? editor.ed.getValue() : code, stdin: stdinBox ? stdinBox.value : (extras.stdin || '') })
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

  /** A JavaScript example: runs in a worker and shows the console. */
  function jsExampleWidget(code, flags, extras) {
    const isError = flags.indexOf('error') !== -1;
    const fig = h('figure', { class: 'ex' });
    const out = h('div', { class: 'out' });
    let editor = null;
    const codeSlot = h('div', null, h('pre', { class: 'ex-code', html: highlight(code, 'js') }));
    const runBtn = h('button', { class: 'mini-btn is-run', title: 'Run (Ctrl+Enter while editing)' }, '▶ Run');
    const editBtn = h('button', { class: 'mini-btn' }, 'Edit');
    const current = () => (editor ? editor.ed.getValue() : code);
    fig.append(h('div', { class: 'ex-bar' },
      h('span', { class: 'ex-label' + (isError ? ' is-error' : '') }, isError ? 'Has an error on purpose — run it and read the message' : 'JavaScript example'),
      runBtn, editBtn,
      h('button', { class: 'mini-btn', title: 'Copy the code', onclick: () => copyText(current()) }, 'Copy'),
      h('button', { class: 'mini-btn', title: 'Open a copy in the Playground', onclick: () => openInPlayground({ lang: 'js', src: current() }) }, 'Playground')),
    codeSlot);
    if (extras.output !== undefined) {
      fig.append(h('div', { class: 'ex-io' }, h('div', { class: 'ex-io-label' }, 'Console'), h('pre', null, extras.output)));
    }
    fig.append(out);
    const run = async () => {
      runBtn.disabled = true;
      out.replaceChildren(spinner('Running…'));
      const src = current();
      try {
        showWebRun(out, await runJs(src), {
          expected: extras.output,
          edited: src !== code,
          jump: (file, line) => { if (editor) { editor.ed.gotoLine(line); editor.ed.focus(); } }
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
        editor = codeEditor(code, { mode: 'js', onRun: run, minLines: 4 });
        codeSlot.replaceChildren(editor.host);
        editor.fit();
        editor.ed.focus();
        editBtn.textContent = 'Reset';
        editBtn.title = 'Put the original code back';
      } else {
        editor.set(code);
        out.innerHTML = '';
      }
    });
    return fig;
  }

  const FILE_LABEL = { 'index.html': 'HTML', 'style.css': 'CSS', 'script.js': 'JS' };
  const fileLabel = (name) => FILE_LABEL[name] || name;
  const modeOf = (name) => (/\.css$/.test(name) ? 'css' : /\.js$/.test(name) ? 'js' : 'html');

  /**
   * A live page: the result in a sandboxed frame, with its console below.
   * @returns {{el, update(files), clear()}}
   */
  function livePreview(files, opts) {
    opts = opts || {};
    const frame = h('iframe', { class: 'web-frame', title: 'Result', loading: 'lazy' });
    const consoleBox = h('div', { class: 'web-console is-quiet' });
    const errorsBox = h('div');
    const status = h('div');
    const el = h('div', { class: 'web-result' },
      h('div', { class: 'web-result-head' }, h('span', null, '▶ Result'), opts.actions || null),
      frame, consoleBox, errorsBox, status);
    let lines = [];
    let errors = [];
    const redraw = () => {
      consoleBox.replaceChildren();
      lines.forEach((o) => consoleBox.append(h('div', { class: 'wc-line is-' + o.level }, o.text === '' ? ' ' : o.text)));
      consoleBox.classList.toggle('is-quiet', !lines.length);
      errorsBox.replaceChildren(errors.length ? webErrorsView(errors, opts.jump) : '');
    };
    const live = Web.livePage(frame, files, (m) => {
      if (m.kind === 'log') lines.push({ level: m.level, text: m.text });
      else if (m.kind === 'clear') lines = [];
      else if (m.kind === 'error') errors.push(m.error);
      else if (m.kind === 'done' && opts.onDone) opts.onDone(lines);
      redraw();
    }, { autoHeight: true, minHeight: opts.minHeight || 70, maxHeight: opts.maxHeight || 420 });
    view.cleanup.push(() => live.destroy());
    return {
      el,
      clear: () => { lines = []; errors = []; status.replaceChildren(); redraw(); },
      status,
      update: (next) => { lines = []; errors = []; status.replaceChildren(); redraw(); live.update(next); }
    };
  }

  /**
   * Files shown as tabs — highlighted code, or editors once editing starts.
   * @returns {{el, files(), edit(), reset(list), jump(file, line), editing()}}
   */
  function fileTabs(files, opts) {
    opts = opts || {};
    let list = files.map((f) => ({ name: f.name, content: f.content, locked: Boolean(f.locked) }));
    let active = opts.active && list.some((f) => f.name === opts.active) ? opts.active : (list.length ? list[0].name : '');
    const editors = {};
    let editing = Boolean(opts.editing);
    const tabs = h('div', { class: 'file-tabs', role: 'tablist' });
    const body = h('div', { class: 'file-body' });
    const el = h('div', { class: 'file-set' }, list.length > 1 || opts.alwaysTabs ? tabs : null, body);

    const draw = () => {
      tabs.replaceChildren();
      list.forEach((f) => tabs.append(h('button', {
        class: 'file-tab' + (f.name === active ? ' is-active' : '') + (f.locked ? ' is-locked' : ''),
        type: 'button',
        role: 'tab',
        title: f.locked ? f.name + ' — given, read only' : f.name,
        onclick: () => { active = f.name; draw(); }
      }, (f.locked ? '🔒 ' : '') + (opts.fullNames ? f.name : fileLabel(f.name)))));
      body.replaceChildren();
      const f = list.find((x) => x.name === active);
      if (!f) return;
      if (editing && !f.locked) {
        if (!editors[f.name]) {
          editors[f.name] = codeEditor(f.content, {
            mode: modeOf(f.name),
            minLines: opts.minLines || 6,
            maxLines: opts.maxLines || 26,
            onRun: opts.onRun,
            onChange: (value) => { f.content = value; if (opts.onChange) opts.onChange(); }
          });
        }
        body.append(editors[f.name].host);
        editors[f.name].fit();
      } else {
        body.append(h('pre', { class: 'ex-code', html: highlight(f.content, modeOf(f.name)) || ' ' }));
      }
    };
    draw();
    return {
      el,
      files: () => list.map((f) => ({ name: f.name, content: f.content })),
      editable: () => list.filter((f) => !f.locked).map((f) => ({ name: f.name, content: f.content })),
      edit: () => { editing = true; draw(); const e = editors[active]; if (e) e.ed.focus(); },
      editing: () => editing,
      reset: (next) => {
        next.forEach((n) => {
          const f = list.find((x) => x.name === n.name);
          if (f) f.content = n.content;
          if (editors[n.name]) editors[n.name].set(n.content);
        });
        draw();
      },
      jump: (file, line) => {
        const target = list.find((x) => x.name === file) || list.find((x) => /\.js$/.test(x.name));
        if (!target) return;
        active = target.name;
        if (!editing && !target.locked) editing = true;
        draw();
        const e = editors[target.name];
        if (e) { e.ed.gotoLine(line); e.ed.focus(); }
      },
      lock: () => { Object.keys(editors).forEach((k) => { editors[k].ed.input.readOnly = true; }); }
    };
  }

  /** An HTML example (with its CSS and JS): code and its live result. */
  function pageExampleWidget(html, flags, extras) {
    const files = [{ name: 'index.html', content: html }];
    if (extras.css !== undefined) files.push({ name: 'style.css', content: extras.css });
    if (extras.js !== undefined) files.push({ name: 'script.js', content: extras.js });
    const fig = h('figure', { class: 'ex web-ex' });
    const editBtn = h('button', { class: 'mini-btn' }, 'Edit');
    let timer = null;
    const tabs = fileTabs(files, {
      minLines: 3,
      // In the CSS course the stylesheet is what the example is about.
      active: course && course.codeLang === 'css' ? 'style.css' : '',
      onChange: () => { clearTimeout(timer); timer = setTimeout(() => result.update(tabs.files()), 350); },
      onRun: () => result.update(tabs.files())
    });
    const compare = (lines) => {
      if (extras.output === undefined) return;
      const text = lines.filter((o) => o.level !== 'error' && o.level !== 'warn').map((o) => o.text).join('\n');
      const cmp = Engine.compareOutput(text, extras.output);
      result.status.replaceChildren(cmp.ok ? h('div', { class: 'out-match' }, '✓ The console shows the expected output') : '');
    };
    const result = livePreview(files, { jump: tabs.jump, onDone: compare });
    fig.append(h('div', { class: 'ex-bar' },
      h('span', { class: 'ex-label' }, 'Example — edit it and watch the result change'),
      editBtn,
      h('button', { class: 'mini-btn', title: 'Open a copy in the Playground', onclick: () => openInPlayground({ lang: 'web', files: tabs.files() }) }, 'Playground')),
    tabs.el, result.el);
    editBtn.addEventListener('click', () => {
      if (!tabs.editing()) {
        tabs.edit();
        editBtn.textContent = 'Reset';
        editBtn.title = 'Put the original code back';
      } else {
        tabs.reset(files);
        result.update(files);
      }
    });
    return fig;
  }

  /** Lesson and review text: runnable code where the course has it. */
  function codeHook(slots) {
    return (lang, flags, code, extras) => {
      const isStatic = flags.indexOf('static') !== -1;
      let widget = null;
      if ((lang === 'cpp' || lang === 'c++') && !isStatic) widget = () => exampleWidget(code, flags, extras);
      else if ((lang === 'js' || lang === 'javascript') && !isStatic) widget = () => jsExampleWidget(code, flags, extras);
      else if (lang === 'html' && !isStatic) widget = () => pageExampleWidget(code, flags, extras);
      if (widget) {
        slots.push(widget);
        return '<div data-slot="' + (slots.length - 1) + '"></div>';
      }
      if (EDITOR_MODES[lang]) return '<pre class="q-code">' + highlight(code, lang) + '</pre>';
      const label = lang === 'output' ? 'Output' : lang === 'stdin' ? 'Input' : '';
      return (label ? '<div class="ex-io-label" style="padding:0 0 4px">' + label + '</div>' : '') +
        '<pre class="plain">' + esc(code) + '</pre>';
    };
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
    if (q.code) box.append(h('pre', { class: 'q-code', html: highlight(q.code, q.lang) }));
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
    box.append(h('pre', { class: 'q-code', html: highlight(q.code, q.lang) }));
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
          out.replaceChildren(spinner(q.lang === 'js' ? 'Running…' : undefined));
          try {
            if (q.lang === 'js') showWebRun(out, await runJs(q.code), { expected: q.answer });
            else showRun(out, await runCpp({ source: q.code, stdin: q.stdin }), { expected: q.answer });
          } catch (err) { showRunError(out, err); }
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
    let html = highlight(marked, q.lang);
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
        h('pre', { class: 'q-expected', html: highlight(fillIn(q.code, q.blanks.map((b) => b[0])), q.lang) }))
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
          h('pre', { html: highlight(q.lines[lineIndex], q.lang) || '&nbsp;' }),
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
        h('pre', { class: 'q-expected', html: highlight(q.lines.join('\n'), q.lang) }))
    };
  }

  function buildSpot(q, box, changed) {
    const lines = q.code.split('\n');
    let chosen = null;
    const wrap = h('div', { class: 'spot-code' });
    const buttons = lines.map((line, i) => {
      const btn = h('button', { class: 'spot-line', type: 'button' },
        h('span', { class: 'ln' }, String(i + 1)), h('span', { html: highlight(line, q.lang) || ' ' }));
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
      answered: () => widget.changed(),
      response: () => widget.code(),
      grade: () => widget.check(),
      lock: () => { if (deferred) widget.lock(); }
    };
  }

  // ================================================================ coding tasks

  /** A task's starting code (page tasks: its editable files as JSON). */
  function starterOf(task) {
    return task.kind === 'page' ? JSON.stringify(task.files) : task.starter;
  }

  function parseFiles(serialized, fallback) {
    try {
      const list = JSON.parse(serialized);
      if (Array.isArray(list) && list.every((f) => f && typeof f.name === 'string')) return list;
    } catch (e) { /* not files */ }
    return fallback;
  }

  /** What a web run means for an exercise. */
  function webGrade(r) {
    const syntax = r.errors.find((e) => e.where === 'syntax') || null;
    const ok = !syntax && r.done && r.checks.length > 0 && r.checks.every((c) => c.ok) &&
      !r.errors.some((e) => e.where === 'checks');
    return { ok, web: r, checks: r.checks, crashed: !r.done, output: Web.allOutputText(r), syntax };
  }

  /**
   * Runs a task's tests against some code.
   * @returns {Promise<{ok, data?, web?, tests?, checks?, crashed?, output?}>}
   */
  async function gradeTask(task, code) {
    if (task.kind === 'js') return webGrade(await runJs(code, task.harness));
    if (task.kind === 'page') {
      const mine = parseFiles(code, task.files);
      return webGrade(await runPage(mergeFiles(task.given, mine), task.harness, task.width));
    }
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

  function resultsView(result, editor, jump) {
    const wrap = h('div');
    if (result.compileFailed) {
      const out = h('div', { class: 'out' });
      showRun(out, result.data, { editor });
      wrap.append(out);
      return wrap;
    }
    if (result.syntax) {
      const out = h('div', { class: 'out' });
      showWebRun(out, result.web, { jump });
      wrap.append(out);
      return wrap;
    }
    const list = result.checks || result.tests || [];
    const passed = list.filter((x) => x.ok).length;
    wrap.append(h('div', { class: 'summary-bar ' + (result.ok ? 'is-ok' : 'is-bad') },
      result.ok ? '✓ All ' + list.length + ' tests pass'
        : result.crashed ? '✗ The ' + (result.web ? 'code' : 'program') + ' stopped before finishing — ' + passed + ' of the ' + plural(list.length, 'check') + ' that ran passed'
          : '✗ ' + passed + ' of ' + list.length + ' tests pass'));
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
      if (result.web) {
        if (result.web.errors.length) ul.append(h('li', null, h('div', { style: { margin: '10px 14px' } }, webErrorsView(result.web.errors, jump))));
        if (result.web.timedOut) {
          ul.append(h('li', null, h('div', { class: 'out-note', style: { margin: '10px 14px' }, html: MD.inline('The code was still running after several seconds, so it was stopped — look for a loop that never ends, or code that is very slow.') })));
        } else if (result.crashed && !result.web.errors.length) {
          ul.append(h('li', null, h('div', { class: 'out-note', style: { margin: '10px 14px' } }, 'The code stopped before all the tests ran.')));
        }
      } else if (result.crashed) {
        const why = Explain.runtime(result.run) || 'The program stopped before all the tests ran.';
        ul.append(h('li', null, h('div', { class: 'out-note', style: { margin: '10px 14px' }, html: MD.inline(why) })));
      }
      if (result.output) {
        ul.append(h('li', null, h('details', { class: 'raw-toggle', style: { marginTop: '10px' } },
          h('summary', null, result.web ? 'What your code printed to the console' : 'Your code also printed something'), h('pre', null, result.output))));
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
   * The editing surface of a task: one editor for C++ or JavaScript, file
   * tabs (with the given files read-only) for a page.
   */
  function taskEditor(task, initial, opts) {
    if (task.kind === 'page') {
      const mine = parseFiles(initial, task.files);
      const shown = mine.map((f) => ({ name: f.name, content: f.content }))
        .concat(task.given.filter((g) => !mine.some((f) => f.name === g.name)).map((g) => ({ name: g.name, content: g.content, locked: true })));
      const tabs = fileTabs(shown, { editing: true, alwaysTabs: true, fullNames: true, minLines: 8, maxLines: 30, onChange: opts.onChange, onRun: opts.onRun });
      return {
        host: tabs.el,
        value: () => JSON.stringify(tabs.editable()),
        set: (serialized) => tabs.reset(parseFiles(serialized, task.files)),
        jump: tabs.jump,
        editor: null,
        lock: tabs.lock
      };
    }
    const ed = codeEditor(initial, {
      mode: task.kind === 'js' ? 'js' : 'cpp',
      minLines: 8,
      maxLines: 30,
      onRun: opts.onRun,
      onChange: opts.onChange
    });
    return {
      host: ed.host,
      value: () => ed.ed.getValue(),
      set: (text) => ed.set(text),
      jump: (file, line) => { ed.ed.gotoLine(line); ed.ed.focus(); },
      editor: ed.ed,
      lock: () => { ed.ed.input.readOnly = true; }
    };
  }

  /** The solution, readable: one block, or one per file. */
  function solutionView(task) {
    if (task.kind === 'page') {
      return h('div', null, task.solutionFiles.map((f) => h('div', null,
        h('div', { class: 'ex-io-label', style: { padding: '8px 14px 0' } }, f.name),
        h('pre', { class: 'code-view', html: highlight(f.content, modeOf(f.name)) }))));
    }
    return h('pre', { class: 'code-view', html: highlight(task.solution, task.kind === 'js' ? 'js' : 'cpp') });
  }

  function solutionForEditor(task) {
    if (task.kind !== 'page') return task.solution;
    const mine = task.files.map((f) => {
      const s = task.solutionFiles.find((x) => x.name === f.name);
      return { name: f.name, content: s ? s.content : f.content };
    });
    return JSON.stringify(mine);
  }

  /**
   * A coding exercise: editor, input, run, check, hints and solution.
   * @param {object} task
   * @param {{kind, codeKey, onSolved, showPrompt, title, noHelp, noCheck, onChange}} opts
   */
  function taskWidget(task, opts) {
    opts = opts || {};
    const key = opts.codeKey === undefined ? task.id : opts.codeKey;
    const starter = starterOf(task);
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

    const isPage = task.kind === 'page';
    const isCpp = task.kind === 'cpp' || !task.kind;
    let preview = null;
    let previewTimer = null;
    const ed = taskEditor(task, saved !== null ? saved : starter, {
      onRun: () => (task.harness && !isPage ? check() : run()),
      onChange: () => {
        if (key) {
          clearTimeout(saveTimer);
          saveTimer = setTimeout(() => { P.code[key] = { src: ed.value(), at: iso() }; save({ quiet: true }); }, 700);
        }
        if (isPage && preview) { clearTimeout(previewTimer); previewTimer = setTimeout(() => preview.update(currentFiles()), 400); }
        if (opts.onChange) opts.onChange();
      }
    });
    el.append(h('div', { class: 'task-editor' }, ed.host));

    let stdin = null;
    if (isCpp && !task.harness) {
      stdin = h('textarea', { class: 'io-input', spellcheck: 'false', placeholder: 'Input for ▶ Run — type what a user would type' });
      const first = task.tests.find((t) => !t.hidden && t.input);
      if (first) stdin.value = first.input;
      el.append(h('details', { class: 'task-io', open: Engine.readsInput(task.starter + (task.solution || '')) ? true : null },
        h('summary', null, 'Input for ▶ Run'), stdin));
    }

    const runLabel = isPage ? '▶ Preview' : '▶ Run';
    const runTitle = isPage ? 'Show the page (updates as you type)' : isCpp ? 'Compile and run with the input above (Ctrl+Enter)' : 'Run and see the console (Ctrl+Enter)';
    const runBtn = h('button', { class: 'mini-btn is-run', title: runTitle }, runLabel);
    const checkBtn = h('button', { class: 'mini-btn is-primary', title: 'Run all the tests' }, task.harness ? '✓ Run the tests' : '✓ Check');
    const hintBtn = h('button', { class: 'mini-btn' });
    const solutionBtn = h('button', { class: 'mini-btn' }, 'Solution');
    const resetBtn = h('button', { class: 'mini-btn', title: 'Start again from the starter code' }, 'Reset');
    const bar = h('div', { class: 'task-bar' });
    if (!(isCpp && task.harness)) bar.append(runBtn);
    if (!opts.noCheck) bar.append(checkBtn);
    bar.append(h('span', { class: 'spacer' }));
    if (!opts.noHelp) {
      if (task.hints.length) bar.append(hintBtn);
      if (task.solution || (task.solutionFiles && task.solutionFiles.length)) bar.append(solutionBtn);
    }
    bar.append(resetBtn);
    el.append(bar);

    const out = h('div', { class: 'out' });
    const results = h('div');
    const hints = h('ul', { class: 'hint-list' });
    const solution = h('div');
    el.append(out, results, h('div', { class: 'task-foot' }, hints, solution));

    const currentFiles = () => mergeFiles(task.given, parseFiles(ed.value(), task.files));

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
        solutionView(task),
        task.explain ? md(task.explain) : null,
        h('div', { style: { padding: '10px 14px' } },
          h('button', {
            class: 'mini-btn',
            onclick: () => {
              if (confirm('Replace your code with this solution? (Typing it yourself teaches more.)')) ed.set(solutionForEditor(task));
            }
          }, 'Put it in the editor'))));
    });

    resetBtn.addEventListener('click', () => {
      if (!confirm('Throw away your code and start again from the starter code?')) return;
      ed.set(starter);
      out.replaceChildren();
      results.replaceChildren();
      preview = null;
      if (key) { P.code[key] = { src: starter, at: iso() }; save({ quiet: true }); }
    });

    async function run() {
      if (isPage) {
        if (!preview) {
          preview = livePreview(currentFiles(), { jump: ed.jump });
          out.replaceChildren(preview.el);
        } else {
          preview.update(currentFiles());
        }
        bump('runs');
        save({ quiet: true });
        return;
      }
      runBtn.disabled = true;
      out.replaceChildren(spinner(isCpp ? undefined : 'Running…'));
      try {
        if (isCpp) showRun(out, await runCpp({ source: ed.value(), stdin: stdin ? stdin.value : '' }), { editor: ed.editor });
        else showWebRun(out, await runJs(ed.value()), { jump: ed.jump });
      } catch (err) {
        showRunError(out, err);
      } finally {
        runBtn.disabled = false;
      }
    }

    async function check() {
      if (locked && opts.kind !== 'exam') return { ok: false };
      checkBtn.disabled = true;
      // Keep the code being checked right away, not after the typing pause:
      // passing a milestone opens the next one, which starts from it.
      if (key) {
        clearTimeout(saveTimer);
        P.code[key] = { src: ed.value(), at: iso() };
      }
      if (!isPage) out.replaceChildren();
      results.replaceChildren(spinner('Running the tests…'));
      let result;
      try {
        result = await gradeTask(task, ed.value());
      } catch (err) {
        results.replaceChildren();
        showRunError(out, err);
        checkBtn.disabled = false;
        return { ok: false, error: err };
      }
      results.replaceChildren(resultsView(result, ed.editor, ed.jump));
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
    // A page shows its result straight away; it is half the point.
    if (isPage && !opts.noCheck) requestAnimationFrame(run);

    return {
      el,
      code: () => ed.value(),
      changed: () => ed.value().trim() !== '' && ed.value() !== starter,
      check,
      editor: ed,
      lock: () => {
        locked = true;
        ed.lock();
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

  function courseHome(c) { return courses.length > 1 ? '#/course/' + (c || course).id : '#/'; }

  function itemCrumbs(item) {
    const ch = item.chapter;
    const part = ch.course.parts.find((p) => p.id === ch.part);
    return crumbs([
      { label: courses.length > 1 ? ch.course.short : 'Home', href: courseHome(ch.course) },
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
    const prev = chapterAfter(ch, -1);
    const gate = prev ? examOf(prev) : null;
    const p = page();
    p.append(crumbs([{ label: courses.length > 1 ? ch.course.short : 'Home', href: courseHome(ch.course) }, { label: 'Chapter ' + ch.number + ': ' + ch.title }]));
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
    const up = nextUp(course);
    const started = Object.keys(P.items).length > 0;
    const hour = new Date().getHours();
    const greet = hour < 5 ? 'Up late' : hour < 12 ? 'Good morning' : hour < 19 ? 'Good afternoon' : 'Good evening';

    const banner = compilerBanner();
    if (banner) p.append(banner);

    const startedHere = course.items.some((i) => P.items[i.id]);
    const heroText = startedHere
      ? 'Pick up where you left off. A little every day beats a lot once a week — your brain consolidates between sessions.'
      : (course.intro || '');
    const hero = h('section', { class: 'hero' },
      h('div', null,
        courses.length > 1 ? h('div', { class: 'hero-kicker' }, h('a', { href: '#/' }, '← All courses')) : null,
        h('h1', null, startedHere ? greet + '! ' + course.short + ' it is.' : course.title),
        h('p', null, heroText),
        up ? h('div', { class: 'up-next' }, 'Up next: ', h('b', null, itemLabel(up) + ' — ' + up.title)) : null,
        h('div', { class: 'row-actions' },
          up ? h('a', { class: 'btn btn-primary btn-big', href: '#/i/' + up.id }, startedHere ? 'Continue →' : 'Start the course →')
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
        h('p', null, 'From ' + practice.chapter.course.short + ' chapter ' + practice.chapter.number + '. Deliberate practice is what turns knowing into doing.'),
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
    const part = ch.course.parts.find((x) => x.id === ch.part);
    p.append(crumbs([{ label: courses.length > 1 ? ch.course.short : 'Home', href: courseHome(ch.course) }, part ? { label: part.title } : null, { label: 'Chapter ' + ch.number }].filter(Boolean)));
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
      if (item.type === 'exam') sub = (isFinal(item) ? 'Final exam · ' : 'Chapter exam · ') + (item.pick || item.questions.length) + ' questions · pass with ' + pct(item.pass);
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
    const banner = compilerBanner(item.chapter.course);
    if (banner) p.append(banner);

    if (item.objectives.length) {
      p.append(h('section', { class: 'objectives' },
        h('h2', null, 'By the end of this lesson you will be able to'),
        h('ul', null, item.objectives.map((o) => h('li', { html: MD.inline(o) })))));
    }

    const placed = new Set();
    const slots = [];
    const html = MD.render(item.body, {
      code: codeHook(slots),
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
      h('span', { class: 'tag tag-gold' }, isFinal(item) ? 'Final exam' : 'Exam'),
      h('span', { class: 'tag' }, count + ' questions'),
      item.minutes ? h('span', { class: 'tag' }, '⏱ ' + item.minutes + ' min') : null,
      passedBefore ? h('span', { class: 'tag tag-ok' }, '✓ Passed') : null));

    const stage = h('div');
    p.append(stage);

    const intro = () => {
      const card = h('div', { class: 'exam-intro' });
      if (item.body) card.append(md(item.body));
      card.append(h('ul', null,
        h('li', null, count + ' questions drawn from everything in ' + (isFinal(item) ? 'the course' : 'this chapter') + (item.pick && item.pick < item.questions.length ? ' (a different mix each attempt)' : '') + '.'),
        h('li', null, 'Pass mark: ', h('b', null, pct(item.pass)), isFinal(item) ? '. Passing earns the ' + (item.chapter.course.graduate || item.chapter.course.short + ' Graduate') + ' badge.' : '. Passing unlocks the next chapter.'),
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
          const nextCh = chapterAfter(item.chapter, 1);
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

  function isFinal(item) {
    return item.type === 'exam' && item.id === item.chapter.course.final;
  }

  function nextChapterUnlocked(item) {
    const nextCh = chapterAfter(item.chapter, 1);
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
      html: MD.render(item.body, { code: codeHook(slots) })
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
    const banner = compilerBanner(item.chapter.course);
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
      left.append(h('p', { style: { color: 'var(--text-dim)', fontSize: '13px' } }, task.kind === 'page'
        ? 'Your page is checked by looking at what it shows — the elements, their text and their styles.'
        : task.kind === 'js' ? 'Your functions are called and their results checked.' : 'Your functions are tested directly — you don\'t need to write main().'));
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
    const countTag = h('span', { class: 'tag' });
    const completeTag = h('span', { class: 'tag tag-ok' }, '✓ Complete');
    const drawCount = () => {
      countTag.textContent = item.milestones.filter((m) => isDone(m.id)).length + '/' + item.milestones.length + ' milestones';
      completeTag.hidden = !isDone(item.id);
    };
    drawCount();
    p.append(h('div', { class: 'meta-row' },
      h('span', { class: 'tag', style: { color: 'var(--violet)' } }, '🏗️ Project'), countTag, completeTag));
    const banner = compilerBanner(item.chapter.course);
    if (banner) p.append(banner);
    if (item.body) p.append(md(item.body));

    const firstOpen = item.milestones.findIndex((m) => !isDone(m.id));
    let current = firstOpen === -1 ? item.milestones.length - 1 : firstOpen;
    const steps = h('ol', { class: 'item-list', style: { margin: '18px 0' } });
    const stage = h('div');
    p.append(steps, stage);

    const drawSteps = () => {
      drawCount();
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
    };

    const draw = () => {
      drawSteps();
      const m = item.milestones[current];
      stage.replaceChildren(
        h('h2', null, 'Milestone ' + (current + 1) + ': ' + (m.title || '')),
        md(m.prompt));
      // Every milestone continues the same code, which starts from the first one's.
      const first = item.milestones[0];
      const task = Object.assign({}, m, {
        starter: m.starter || first.starter,
        files: m.files && m.files.length ? m.files : first.files,
        given: m.given && m.given.length ? m.given : first.given
      });
      if (!P.code[item.id]) P.code[item.id] = { src: starterOf(task), at: iso() };
      const w = taskWidget(task, {
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
          }
          // Keep the passing results on screen; the next milestone is one click away.
          drawSteps();
          if (current < item.milestones.length - 1 && !stage.querySelector('.next-milestone')) {
            const next = current + 1;
            stage.append(h('div', { class: 'row-actions next-milestone', style: { marginTop: '16px' } },
              h('button', {
                class: 'btn btn-primary',
                onclick: () => { current = next; draw(); main.scrollTop = 0; }
              }, 'Continue to milestone ' + (next + 1) + ' →')));
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
      const lesson = ALL.byId[card.lesson];
      const fc = h('div', { class: 'flashcard' },
        h('div', { class: 'fc-side' }, 'Question' + (lesson ? ' · ' + (courses.length > 1 ? lesson.chapter.course.short + ' · ' : '') + itemLabel(lesson) + ' ' + lesson.title : '')),
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
      const q = ALL.questions[id].question;
      const owner = ALL.questions[id].item;
      const w = questionWidget(q, {
        mode: 'instant',
        kicker: 'From ' + (courses.length > 1 ? owner.chapter.course.short + ' ' : '') + itemLabel(owner) + ': ' + owner.title,
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

  const TEMPLATES = {
    cpp: [
      { name: 'Hello, World', src: '#include <iostream>\n\nint main() {\n    std::cout << "Hello, World!\\n";\n    return 0;\n}\n' },
      { name: 'Read two numbers', src: '#include <iostream>\n\nint main() {\n    int a{};\n    int b{};\n    std::cin >> a >> b;\n    std::cout << a << " + " << b << " = " << a + b << \'\\n\';\n    return 0;\n}\n', stdin: '3 4' },
      { name: 'Vector and loop', src: '#include <iostream>\n#include <vector>\n\nint main() {\n    std::vector<int> numbers{4, 8, 15, 16, 23, 42};\n    int sum{0};\n    for (int n : numbers) {\n        sum += n;\n    }\n    std::cout << "Sum: " << sum << \'\\n\';\n    return 0;\n}\n' },
      { name: 'A class', src: '#include <iostream>\n#include <string>\n\nclass Counter {\npublic:\n    void increment() { ++count_; }\n    int value() const { return count_; }\nprivate:\n    int count_{0};\n};\n\nint main() {\n    Counter c;\n    c.increment();\n    c.increment();\n    std::cout << c.value() << \'\\n\';\n    return 0;\n}\n' }
    ],
    js: [
      { name: 'Hello, console', src: 'console.log("Hello, World!");\n\nconst name = "Ada";\nconsole.log(`Hello, ${name}!`);\n' },
      { name: 'Loop and array', src: 'const numbers = [4, 8, 15, 16, 23, 42];\nlet sum = 0;\nfor (const n of numbers) {\n  sum += n;\n}\nconsole.log("Sum:", sum);\nconsole.log(numbers.map((n) => n * 2));\n' },
      { name: 'Functions and objects', src: 'function greet(person) {\n  return `Hi ${person.name}, you are ${person.age}`;\n}\n\nconst ada = { name: "Ada", age: 36 };\nconsole.log(greet(ada));\n' },
      { name: 'A class', src: 'class Counter {\n  #count = 0;\n  increment() { this.#count += 1; }\n  get value() { return this.#count; }\n}\n\nconst c = new Counter();\nc.increment();\nc.increment();\nconsole.log(c.value);\n' }
    ],
    web: [
      { name: 'Blank page', files: [
        { name: 'index.html', content: '<h1>Hello!</h1>\n<p>Edit the HTML, CSS and JS — the result updates as you type.</p>\n' },
        { name: 'style.css', content: 'body {\n  font-family: system-ui, sans-serif;\n  margin: 2rem;\n}\n\nh1 {\n  color: rebeccapurple;\n}\n' },
        { name: 'script.js', content: 'console.log("The page is ready");\n' }] },
      { name: 'Button and counter', files: [
        { name: 'index.html', content: '<button id="add">Add one</button>\n<p>Count: <span id="count">0</span></p>\n' },
        { name: 'style.css', content: 'body { font-family: system-ui, sans-serif; margin: 2rem; }\nbutton { font-size: 1.1rem; padding: .5rem 1rem; }\n' },
        { name: 'script.js', content: 'let count = 0;\nconst label = document.querySelector("#count");\n\ndocument.querySelector("#add").addEventListener("click", () => {\n  count += 1;\n  label.textContent = count;\n});\n' }] },
      { name: 'Card layout', files: [
        { name: 'index.html', content: '<div class="cards">\n  <article class="card"><h2>One</h2><p>First card</p></article>\n  <article class="card"><h2>Two</h2><p>Second card</p></article>\n  <article class="card"><h2>Three</h2><p>Third card</p></article>\n</div>\n' },
        { name: 'style.css', content: 'body { font-family: system-ui, sans-serif; margin: 2rem; background: #f4f4f8; }\n.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 1rem; }\n.card { background: white; border-radius: 12px; padding: 1rem; box-shadow: 0 2px 8px rgb(0 0 0 / .1); }\n' },
        { name: 'script.js', content: '' }] }
    ]
  };
  const LANG_NAMES = { cpp: 'C++', js: 'JavaScript', web: 'Web page' };

  function newSnippet(lang, template) {
    const t = template || TEMPLATES[lang][0];
    return { name: 'Untitled', lang, src: t.src || '', stdin: t.stdin || '', files: t.files ? t.files.map((f) => ({ name: f.name, content: f.content })) : null, at: iso() };
  }

  function openInPlayground(snippet) {
    const id = 's' + Date.now().toString(36);
    P.snippets[id] = Object.assign({ name: 'From a lesson', lang: 'cpp', src: '', stdin: '', files: null }, snippet, { at: iso() });
    save({ quiet: true });
    location.hash = '#/playground/' + id;
  }

  function playgroundView(id) {
    const p = page('page-wide');
    p.append(h('h1', null, 'Playground'));
    p.append(h('p', { class: 'page-sub' }, 'Your own space to try anything — C++ programs, JavaScript, or whole web pages. Experimenting ("what happens if I change this?") is how programmers really learn. Snippets are saved with your progress.'));

    const ids = Object.keys(P.snippets).filter((k) => P.snippets[k] && !P.snippets[k].deleted)
      .sort((a, b) => String(P.snippets[b].at).localeCompare(String(P.snippets[a].at)));
    if (!ids.length) {
      const first = 's' + Date.now().toString(36);
      const lang = course && course.lang === 'web' ? (course.codeLang === 'js' ? 'js' : 'web') : 'cpp';
      P.snippets[first] = Object.assign(newSnippet(lang), { name: 'My first ' + (lang === 'cpp' ? 'program' : lang === 'js' ? 'script' : 'page') });
      save({ quiet: true });
      ids.push(first);
    }
    const currentId = id && P.snippets[id] && !P.snippets[id].deleted ? id : ids[0];
    const snip = P.snippets[currentId];
    const lang = snip.lang || 'cpp';

    const create = (l) => {
      const nid = 's' + Date.now().toString(36);
      P.snippets[nid] = Object.assign(newSnippet(l), { name: 'Untitled ' + (ids.length + 1) });
      save({ quiet: true });
      location.hash = '#/playground/' + nid;
    };
    const list = h('ul', { class: 'pg-list' });
    list.append(h('li', { class: 'pg-new' },
      h('span', null, '＋ New'),
      ['cpp', 'js', 'web'].map((l) => h('button', { type: 'button', onclick: () => create(l) }, LANG_NAMES[l]))));
    ids.forEach((k) => list.append(h('li', null, h('button', {
      class: k === currentId ? 'is-active' : '',
      onclick: () => { location.hash = '#/playground/' + k; }
    }, h('span', { class: 'pg-lang' }, { cpp: 'C++', js: 'JS', web: 'Web' }[P.snippets[k].lang || 'cpp']), P.snippets[k].name || 'Untitled'))));

    let editor = null;
    let tabs = null;
    let preview = null;
    let previewTimer = null;
    const stdin = h('textarea', { class: 'io-input', placeholder: 'Input for the program (what a user would type)', spellcheck: 'false' });
    stdin.value = snip.stdin || '';

    const persist = () => {
      const patch = { name: name.value, at: iso() };
      if (lang === 'web') patch.files = tabs.files();
      else patch.src = editor.ed.getValue();
      if (lang === 'cpp') patch.stdin = stdin.value;
      P.snippets[currentId] = Object.assign({}, P.snippets[currentId], patch);
      save({ quiet: true });
    };
    let timer = null;
    const later = () => {
      clearTimeout(timer);
      timer = setTimeout(persist, 600);
      if (lang === 'web' && preview) { clearTimeout(previewTimer); previewTimer = setTimeout(() => preview.update(tabs.files()), 400); }
    };

    const name = h('input', { class: 'pg-name', value: snip.name || '', 'aria-label': 'Snippet name' });
    name.addEventListener('change', () => { persist(); route(); });
    const out = h('div', { class: 'out' });
    const runBtn = h('button', { class: 'mini-btn is-run' }, lang === 'web' ? '▶ Refresh' : '▶ Run');
    const templateSel = h('select', { class: 'pg-name', style: { flex: '0 0 auto', minWidth: 0 }, 'aria-label': 'Start from a template' },
      h('option', { value: '' }, 'Template…'), TEMPLATES[lang].map((t, i) => h('option', { value: String(i) }, t.name)));

    let workArea;
    if (lang === 'web') {
      const files = snip.files && snip.files.length ? snip.files : TEMPLATES.web[0].files;
      tabs = fileTabs(files, { editing: true, alwaysTabs: true, fullNames: true, minLines: 14, maxLines: 34, onChange: later, onRun: () => run() });
      preview = livePreview(files, { jump: tabs.jump, maxHeight: 520, minHeight: 160 });
      workArea = h('div', null, h('div', { class: 'task-editor' }, tabs.el), preview.el);
    } else {
      editor = codeEditor(lang === 'js' ? snip.src : snip.src, { mode: lang, minLines: 16, maxLines: 40, onChange: later, onRun: () => run() });
      stdin.addEventListener('input', later);
      workArea = h('div', null,
        h('div', { class: 'task-editor' }, editor.host),
        lang === 'cpp' ? h('details', { class: 'task-io', open: true }, h('summary', null, 'Input (stdin)'), stdin) : null,
        out);
    }

    templateSel.addEventListener('change', () => {
      const t = TEMPLATES[lang][Number(templateSel.value)];
      templateSel.value = '';
      if (!t || !confirm('Replace this snippet\'s code with "' + t.name + '"?')) return;
      if (lang === 'web') {
        P.snippets[currentId] = Object.assign({}, P.snippets[currentId], { files: t.files.map((f) => ({ name: f.name, content: f.content })), at: iso() });
        save({ quiet: true });
        route();
        return;
      }
      editor.set(t.src);
      stdin.value = t.stdin || '';
      persist();
    });

    async function run() {
      if (lang === 'web') { preview.update(tabs.files()); bump('runs'); save({ quiet: true }); return; }
      runBtn.disabled = true;
      out.replaceChildren(spinner(lang === 'js' ? 'Running…' : undefined));
      try {
        if (lang === 'js') showWebRun(out, await runJs(editor.ed.getValue()), { jump: (f, l) => { editor.ed.gotoLine(l); editor.ed.focus(); } });
        else showRun(out, await runCpp({ source: editor.ed.getValue(), stdin: stdin.value }), { editor: editor.ed });
      } catch (e) { showRunError(out, e); }
      runBtn.disabled = false;
    }
    runBtn.addEventListener('click', run);

    const banner = lang === 'cpp' ? compilerBanner(courses.find((c) => c.lang === 'cpp') || course) : null;
    const panel = h('div', { class: 'task', style: { margin: 0 } },
      h('div', { class: 'task-bar' }, h('span', { class: 'tag' }, LANG_NAMES[lang]), name, runBtn, templateSel,
        h('button', { class: 'mini-btn', onclick: () => copyText(lang === 'web' ? tabs.files().map((f) => '/* ' + f.name + ' */\n' + f.content).join('\n\n') : editor.ed.getValue()) }, 'Copy'),
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
      banner,
      workArea);
    p.append(h('div', { class: 'pg' }, list, panel));
    view.cleanup.push(() => { clearTimeout(timer); persist(); });
    return p;
  }

  // ================================================================ views: glossary

  function glossaryView(courseId) {
    const p = page();
    const withTerms = courses.filter((c) => c.glossary.length);
    const gc = withTerms.find((c) => c.id === courseId) || (course && course.glossary.length ? course : withTerms[0]) || course;
    p.append(h('h1', null, 'Glossary'));
    p.append(h('p', { class: 'page-sub' }, 'Every term the course uses, in plain words.'));
    if (withTerms.length > 1) {
      p.append(h('div', { class: 'tabs-row' }, withTerms.map((c) => h('button', {
        class: c === gc ? 'is-active' : '',
        onclick: () => { location.hash = '#/glossary/' + c.id; }
      }, c.short))));
    }
    const input = h('input', { class: 'gloss-search', type: 'search', placeholder: 'Search ' + gc.glossary.length + ' ' + gc.short + ' terms…', 'aria-label': 'Search the glossary' });
    const list = h('div');
    const draw = () => {
      const q = input.value.trim().toLowerCase();
      list.replaceChildren();
      const terms = gc.glossary
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
        const ch = gc.chapters.find((c) => c.id === t.chapter);
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
    const allLessons = ALL.items.filter((i) => i.type === 'lesson').length;
    const allChallenges = ALL.items.filter((i) => i.type === 'challenge').length;
    const allExams = ALL.items.filter((i) => i.type === 'exam').length;
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
        h('p', null, plural(c.compileErrors, 'error') + ' met and fixed along the way'))));

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

    const masteryTable = (c) => {
      const table = h('table', { class: 'mastery-table' },
        h('thead', null, h('tr', null, ['Chapter', 'Lessons', 'Challenges', 'Best exam', 'Mastery'].map((t) => h('th', null, t)))));
      const tbody = h('tbody');
      c.chapters.forEach((ch) => {
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
      return h('div', { class: 'table-wrap' }, table);
    };
    if (courses.length > 1) {
      p.append(h('div', { class: 'section-title' }, 'Chapter mastery by course'));
      courses.forEach((c) => {
        const done = c.items.filter((i) => i.type === 'lesson' && isDone(i.id)).length;
        const total = c.items.filter((i) => i.type === 'lesson').length;
        p.append(h('details', { class: 'course-mastery', open: c === course ? true : null },
          h('summary', null, (c.icon ? c.icon + ' ' : '') + c.title, h('span', { class: 'cm-sub' }, done + '/' + total + ' lessons')),
          masteryTable(c)));
      });
    } else {
      p.append(h('div', { class: 'section-title' }, 'Chapter mastery'));
      p.append(masteryTable(course));
    }

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
        let parsed;
        try { parsed = Backup.parse(text); } catch (e) { toast(esc(e.message), 'err'); return; }
        if (parsed.learn) {
          P = Engine.mergeProgress(P, parsed.learn);
          save();
        }
        // A full backup also carries the editor's project; the editor reads it from this browser.
        if (parsed.editor && confirm('This backup also holds the editor project "' + (parsed.editor.name || 'Untitled page') +
          '". Put it in the editor too? (It replaces the project there now.)')) {
          try { localStorage.setItem(Backup.KEYS.editor, JSON.stringify(parsed.editor)); } catch (e) { toast('No room in this browser for the project', 'err'); }
        }
        toast(parsed.learn ? 'Progress restored and merged — nothing was lost' : 'Backup restored', 'ok');
        route();
      }).catch(() => toast('Could not read that file', 'err'));
    });
    fileInput.addEventListener('click', () => { fileInput.value = ''; });
    p.append(h('p', { class: 'page-sub' }, sync.storage === 'local'
      ? 'This is the open version: your progress is kept only in this browser. Download a backup now and then — clearing the browser, or switching to another device, would otherwise lose it. The backup also holds the project in the editor.'
      : sync.storage === 'github'
        ? 'Your progress is saved in this browser and synced to your GitHub repository (branch au-learn), so it follows you to any device where you sign in.'
        : 'Your progress is saved in this browser and on the server. (With GitHub storage configured, it also survives server restarts.)'));
    p.append(h('div', { class: 'row-actions' },
      h('button', {
        class: 'btn' + (sync.storage === 'local' ? ' btn-primary' : ''),
        onclick: () => {
          persistLocal();
          const doc = Backup.collect(localStorage);
          Backup.download(doc, Backup.fileName());
          toast('Backup downloaded — ' + esc(Backup.describe(doc)), 'ok');
        }
      }, 'Download a backup'),
      h('button', { class: 'btn', onclick: () => fileInput.click() }, 'Restore a backup'),
      sync.storage === 'local' ? null : h('button', { class: 'btn', onclick: () => { sync.dirty = true; push(); } }, 'Sync now'),
      h('button', {
        class: 'btn',
        style: { color: 'var(--err)' },
        onclick: () => {
          if (!confirm(sync.storage === 'local'
            ? 'Reset ALL your Learn progress — lessons, scores, flashcards, notes, snippets — in this browser?'
            : 'Reset ALL your Learn progress — lessons, scores, flashcards, notes, snippets — on every device?')) return;
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
      (compiler.available ? 'C++ runs on: ' + (compiler.compiler || compiler.backend) + (compiler.std ? ' (' + compiler.std + ')' : '')
        : 'C++ is not available on this server: ' + (compiler.reason || '')) + ' · HTML, CSS and JavaScript run in your browser.'));
    return p;
  }

  function methodView() {
    const p = page();
    p.append(crumbs([{ label: courses.length > 1 ? course.short : 'Home', href: courseHome() }, { label: 'How this course works' }]));
    p.append(h('h1', null, 'How this course works'));
    // The method is the same for every course; the C++ course holds the text.
    const withMethod = course.method ? course : courses.find((c) => c.method);
    p.append(md((withMethod && withMethod.method) || ''));
    const up = nextUp(course);
    if (up) p.append(h('div', { class: 'lesson-foot' }, h('a', { class: 'btn btn-primary btn-big', href: '#/i/' + up.id }, 'Start: ' + up.title + ' →')));
    return p;
  }

  // ================================================================ views: catalog

  /** Every course, to pick from — the home page when there is more than one. */
  function catalogView() {
    const p = page('page-wide');
    const level = Engine.levelFor(totalXp());
    const started = Object.keys(P.items).length > 0;
    p.append(h('section', { class: 'hero' },
      h('div', null,
        h('h1', null, started ? 'Welcome back!' : 'What do you want to learn?'),
        h('p', null, 'Each course starts from zero and ends with you building real things on your own: lessons you can run and change, quick checks, exercises checked automatically, challenges, projects and an exam per chapter. Progress, flashcards and badges are shared across all of them.'),
        h('div', { class: 'row-actions' },
          h('a', { class: 'btn btn-big', href: '#/method' }, 'How the courses work'),
          dueCards().length ? h('a', { class: 'btn btn-primary btn-big', href: '#/review' }, 'Review ' + plural(dueCards().length, 'card')) : null)),
      h('div', { class: 'level-card' },
        h('div', { class: 'lv' }, 'Level ' + level.level),
        h('div', { class: 'lv-title' }, level.title),
        h('div', { class: 'bar' }, h('i', { style: { width: pct(level.progress) } })),
        h('div', { class: 'bar-label' }, h('span', null, level.xp + ' XP'), h('span', null, level.next ? level.next + ' XP' : 'max')))));

    const grid = h('div', { class: 'course-grid' });
    courses.forEach((c) => {
      const lessons = c.items.filter((i) => i.type === 'lesson');
      const done = lessons.filter((i) => isDone(i.id)).length;
      const up = nextUp(c);
      const mastery = c.chapters.length ? c.chapters.reduce((sum, ch) => sum + chapterStats(ch).mastery, 0) / c.chapters.length : 0;
      grid.append(h('a', { class: 'course-card', href: '#/course/' + c.id },
        h('div', { class: 'cc-top' },
          h('span', { class: 'cc-icon' }, c.icon || '📘'),
          h('div', { class: 'ring small', style: { '--p': Math.round(mastery * 100), '--c': 'var(--accent)' } }, h('span', null, Math.round(mastery * 100) + '%'))),
        h('h2', null, c.title),
        h('p', null, c.subtitle),
        h('div', { class: 'cc-meta' }, plural(c.chapters.length, 'chapter') + ' · ' + plural(lessons.length, 'lesson') + ' · ' + plural(c.items.filter((i) => i.type === 'challenge').length, 'challenge')),
        h('div', { class: 'bar ok', style: { margin: '10px 0 6px' } }, h('i', { style: { width: pct(lessons.length ? done / lessons.length : 0) } })),
        h('div', { class: 'cc-next' }, done ? (up ? 'Next: ' + up.title : 'Course complete!') : 'Start from zero →')));
    });
    p.append(h('div', { class: 'section-title' }, 'Courses'));
    p.append(grid);
    p.append(h('p', { class: 'page-sub', style: { marginTop: '18px' } },
      'New to programming? A good path for the web is HTML → CSS → JavaScript: each builds on the one before. C++ stands on its own and starts from zero too.'));
    return p;
  }

  // ================================================================ outline

  function renderOutline() {
    if (!course) return;
    const q = document.getElementById('outline-search').value.trim().toLowerCase();
    const active = currentItemId();
    const activeChapter = active && ALL.byId[active] ? ALL.byId[active].chapter.id : currentChapterId();
    const picker = document.getElementById('course-picker');
    if (picker) {
      picker.hidden = courses.length < 2;
      picker.replaceChildren(...courses.map((c) => h('option', { value: c.id, selected: c === course ? true : null }, (c.icon ? c.icon + ' ' : '') + c.title)));
    }
    const openBefore = new Set(Array.from(outline.querySelectorAll('details[open]')).map((d) => d.dataset.ch));
    const scroll = outline.scrollTop;
    outline.replaceChildren();
    outline.append(h('div', { class: 'lt-side-mobile-nav' },
      h('a', { href: '#/' }, courses.length > 1 ? '🏠 All courses' : '🏠 Home'), h('a', { href: '#/review' }, '🔁 Review'), h('a', { href: '#/playground' }, '🧪 Playground'),
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
    let catalog = false;
    try {
      if (parts[0] === 'i' && ALL.byId[parts[1]]) {
        const item = ALL.byId[parts[1]];
        setCourse(item.chapter.course);
        if (!isUnlocked(item.chapter)) node = lockedView(item, item.chapter);
        else {
          node = {
            lesson: lessonView, quiz: quizView, exam: examView, review: reviewItemView,
            challenge: challengeView, project: projectView
          }[item.type](item);
          touchVisit(item);
        }
      } else if (parts[0] === 'c' && ALL.chapters.find((c) => c.id === parts[1])) {
        const ch = ALL.chapters.find((c) => c.id === parts[1]);
        setCourse(ch.course);
        node = chapterView(ch);
      } else if (parts[0] === 'course' && courses.find((c) => c.id === parts[1])) {
        setCourse(courses.find((c) => c.id === parts[1]));
        node = homeView();
      } else if (parts[0] === 'review') node = reviewView(parts[1] || 'cards');
      else if (parts[0] === 'playground') node = playgroundView(parts[1]);
      else if (parts[0] === 'glossary') node = glossaryView(parts[1]);
      else if (parts[0] === 'progress') node = progressView();
      else if (parts[0] === 'method') node = methodView();
      else {
        catalog = courses.length > 1;
        node = catalog ? catalogView() : homeView();
      }
    } catch (err) {
      console.error(err);
      node = h('div', { class: 'page' }, h('h1', null, 'Something went wrong'), h('pre', { class: 'plain' }, String(err && err.stack || err)));
    }
    main.replaceChildren(node);
    main.scrollTop = 0;
    document.querySelectorAll('.lt-nav a').forEach((a) => {
      const nav = a.dataset.nav;
      a.classList.toggle('is-active', (nav === 'home' && (parts[0] === '' || parts[0] === undefined || parts[0] === 'course')) || nav === parts[0]);
    });
    document.body.classList.remove('side-open');
    document.getElementById('btn-menu').setAttribute('aria-expanded', 'false');
    // The course list belongs to no course: the header just says "Learn".
    const shownCourse = catalog ? '' : course.short;
    document.getElementById('brand-course').textContent = shownCourse;
    const title = node.querySelector('h1');
    document.title = (title ? title.textContent + ' · ' : '') + ('Learn ' + shownCourse).trim();
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
    if (document.visibilityState === 'hidden' && sync.dirty && sync.storage !== 'local') {
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

  async function loadCourse(dir) {
    const index = Course.parseYaml(await fetchText(dir + '/course.yml'), dir + '/course.yml');
    const files = index.chapters || [];
    // A chapter that fails to load is left out rather than taking the course down.
    const settled = await Promise.allSettled(files.map((f) => fetchText(dir + '/' + f + '.yml')));
    const docs = [];
    settled.forEach((r, i) => {
      if (r.status !== 'fulfilled') { console.warn('Skipping chapter', files[i], r.reason); return; }
      try { docs.push(Course.parseYaml(r.value, files[i] + '.yml')); } catch (e) { console.error(e); }
    });
    let glossary = null;
    try { glossary = Course.parseYaml(await fetchText(dir + '/glossary.yml'), 'glossary.yml'); } catch (e) { glossary = null; }
    return Course.buildCourse(index, docs, { glossary });
  }

  /** Every course in courses.yml (or just the C++ one, if there is no list). */
  async function loadCourses() {
    let dirs = ['course'];
    try {
      const list = Course.parseYaml(await fetchText('courses.yml'), 'courses.yml');
      if (list && Array.isArray(list.courses) && list.courses.length) dirs = list.courses.map((c) => String(c.dir));
    } catch (e) { /* the C++ course alone */ }
    const settled = await Promise.allSettled(dirs.map(loadCourse));
    const loaded = [];
    settled.forEach((r, i) => {
      if (r.status === 'fulfilled') loaded.push(r.value);
      else console.warn('Skipping course', dirs[i], r.reason);
    });
    if (!loaded.length) throw (settled[0] && settled[0].reason) || new Error('No course could be loaded');
    return loaded;
  }

  /** Builds the shared index; ids are unique across courses. */
  function indexCourses() {
    courses.forEach((c) => {
      c.items.forEach((item) => { ALL.byId[item.id] = item; ALL.items.push(item); });
      Object.keys(c.questions).forEach((id) => { ALL.questions[id] = c.questions[id]; });
      c.cards.forEach((card) => ALL.cards.push(card));
      c.chapters.forEach((ch) => ALL.chapters.push(ch));
    });
  }

  /** Switches the course being looked at (and remembers it). */
  function setCourse(c) {
    if (!c || c === course) return;
    course = c;
    const brand = document.getElementById('brand-course');
    if (brand) brand.textContent = c.short;
    if ((P.settings || {}).course !== c.id) {
      P.settings = Object.assign({}, P.settings, { course: c.id, at: iso() });
      persistLocal();
    }
  }

  async function boot() {
    const local = loadLocal();
    if (local) P = Engine.mergeProgress(Engine.emptyProgress(), local);
    setSync('busy', 'Connecting…');
    const statusDone = loadCompilerStatus().then(() => { compiler.pending = false; });
    try {
      courses = await loadCourses();
      indexCourses();
      course = null;
      setCourse(courses.find((c) => c.id === (P.settings || {}).course) || courses[0]);
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
    // The progress page describes where progress is kept, which is only known now.
    const onProgressPage = location.hash.indexOf('#/progress') === 0;
    if ((JSON.stringify(P) !== before || onProgressPage) && !view.guard && !focused) route();
    else if (!compiler.available) route();
    setInterval(() => { if (sync.dirty) push(); }, 60000);
  }

  document.getElementById('course-picker').addEventListener('change', (e) => {
    location.hash = '#/course/' + e.target.value;
  });

  window.LearnApp = { route, get progress() { return P; }, get course() { return course; }, get courses() { return courses; } };
  boot();
})();
