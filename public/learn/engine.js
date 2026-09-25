/*
 * The rules of Learn mode, with no DOM in sight: marking answers, checking a
 * program's output, the checker that tests your functions, spaced repetition,
 * XP and levels, streaks, and merging progress from two devices.
 *
 * Shared verbatim by the browser and the server (which merges progress), and
 * tested in Node.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LearnEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ------------------------------------------------------------ typing

  /*
   * What keyboards and autocorrect put in place of the plain characters
   * code uses: curly quotes, long dashes, invisible and non-breaking
   * spaces, full-width letters. Answers are compared after undoing them, so
   * "It’s" typed on a phone matches "It's".
   */
  var LOOKALIKES = {
    '\u2018': "'", '\u2019': "'", '\u201A': "'", '\u201B': "'", '\u2032': "'", '\u00B4': "'",
    '\u201C': '"', '\u201D': '"', '\u201E': '"', '\u201F': '"', '\u2033': '"', '\u00AB': '"', '\u00BB': '"',
    '\u2014': '--', '\u2015': '--', '\u2013': '-', '\u2012': '-', '\u2010': '-', '\u2011': '-', '\u2212': '-',
    '\u00D7': '*'
  };

  function plainText(text) {
    var s = String(text == null ? '' : text);
    if (s.normalize) s = s.normalize('NFKC');
    return s
      .replace(/\r\n?/g, '\n')
      .replace(/[\u200B-\u200D\u2060\uFEFF\u00AD]/g, '')
      .replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, ' ')
      .replace(/[\u2018\u2019\u201A\u201B\u2032\u00B4\u201C-\u201F\u2033\u00AB\u00BB\u2010-\u2015\u2212\u00D7]/g, function (c) { return LOOKALIKES[c] || c; });
  }

  // ------------------------------------------------------------ output

  /** Line endings unified, trailing spaces and trailing blank lines dropped. */
  function tidyLines(text) {
    return String(text == null ? '' : text)
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map(function (line) { return line.replace(/[ \t]+$/, ''); })
      .join('\n')
      .replace(/\n+$/, '');
  }

  /** Output ready to compare: tidied, with look-alike characters made plain. */
  function normalizeOutput(text) {
    return tidyLines(plainText(text));
  }

  /**
   * Compares what a program printed with what it should have printed.
   * @returns {{ok: boolean, line?: number, got?: string, want?: string}}
   */
  function compareOutput(got, want) {
    var a = normalizeOutput(got).split('\n');
    var b = normalizeOutput(want).split('\n');
    if (a.join('\n') === b.join('\n')) return { ok: true };
    // Report the differing line as it was really printed and written.
    var ra = tidyLines(got).split('\n');
    var rb = tidyLines(want).split('\n');
    for (var i = 0; i < Math.max(a.length, b.length); i += 1) {
      if (a[i] !== b[i]) {
        return {
          ok: false,
          line: i + 1,
          got: ra[i] === undefined ? null : ra[i],
          want: rb[i] === undefined ? null : rb[i]
        };
      }
    }
    return { ok: false, line: 1, got: tidyLines(got), want: tidyLines(want) };
  }

  // ------------------------------------------------------------ checker

  var MARK = '\u001e';
  var SEP = '\u001f';

  /**
   * C++ appended after a learner's code so their functions can be tested
   * without them writing main(). CHECK(expr, expected) prints one result line.
   */
  var PRELUDE = [
    '#line 1 "checks.cpp"',
    '#include <cmath>',
    '#include <exception>',
    '#include <iostream>',
    '#include <sstream>',
    '#include <string>',
    '#include <type_traits>',
    '#include <utility>',
    '#include <vector>',
    '#pragma GCC diagnostic ignored "-Wsign-compare"',
    '#pragma GCC diagnostic ignored "-Wunused-variable"',
    '#pragma GCC diagnostic ignored "-Wunused-but-set-variable"',
    '#pragma GCC diagnostic ignored "-Wfloat-equal"',
    'namespace au_check {',
    'template <class T, class = void> struct streamable : std::false_type {};',
    'template <class T> struct streamable<T, std::void_t<decltype(std::declval<std::ostream&>() << std::declval<const T&>())>> : std::true_type {};',
    'inline std::string quote(const std::string& s) { return "\\"" + s + "\\""; }',
    'template <class T> std::string show(const T& v);',
    'template <class T> std::string show(const std::vector<T>& v);',
    'template <class A, class B> std::string show(const std::pair<A, B>& p);',
    'inline std::string show(const std::string& s) { return quote(s); }',
    'inline std::string show(const char* s) { return s ? quote(s) : std::string("nullptr"); }',
    'inline std::string show(char c) { return std::string("\'") + c + "\'"; }',
    'inline std::string show(bool b) { return b ? "true" : "false"; }',
    'inline std::string show(double d) { std::ostringstream o; o.precision(12); o << d; return o.str(); }',
    'inline std::string show(float d) { return show(static_cast<double>(d)); }',
    'template <class T> std::string show(const std::vector<T>& v) { std::string s = "{"; for (std::size_t i = 0; i < v.size(); ++i) { if (i) s += ", "; s += show(v[i]); } return s + "}"; }',
    'template <class A, class B> std::string show(const std::pair<A, B>& p) { return "(" + show(p.first) + ", " + show(p.second) + ")"; }',
    'template <class T> std::string show(const T& v) { if constexpr (streamable<T>::value) { std::ostringstream o; o << v; return o.str(); } else { return "(a value that cannot be printed)"; } }',
    'inline std::string clean(std::string s) { for (char& c : s) if (c == \'\\n\') c = \'\\x1d\'; return s; }',
    'inline void report(bool ok, const char* expr, const std::string& got, const std::string& want) {',
    '  std::cout << std::flush; std::cout << "\\n\\x1e" << (ok ? "PASS" : "FAIL") << "\\x1f" << clean(expr) << "\\x1f" << clean(got) << "\\x1f" << clean(want) << "\\n" << std::flush;',
    '}',
    'template <class A, class B> bool same(const A& a, const B& b) {',
    '  if constexpr (std::is_floating_point<A>::value || std::is_floating_point<B>::value) { return std::fabs(static_cast<double>(a) - static_cast<double>(b)) < 1e-6; }',
    '  else { return a == b; }',
    '}',
    'template <class A, class B> std::pair<std::decay_t<A>, std::decay_t<B>> pack(A&& a, B&& b) { return {std::forward<A>(a), std::forward<B>(b)}; }',
    'template <class F> void check(const char* expr, F get) {',
    '  try { auto r = get(); report(same(r.first, r.second), expr, show(r.first), show(r.second)); }',
    '  catch (const std::exception& e) { report(false, expr, std::string("threw an exception: ") + e.what(), "a value, not an exception"); }',
    '  catch (...) { report(false, expr, "threw an exception", "a value, not an exception"); }',
    '}',
    'template <class F> void throws(const char* expr, F run) {',
    '  try { run(); report(false, expr, "no exception", "an exception"); }',
    '  catch (...) { report(true, expr, "an exception", "an exception"); }',
    '}',
    'struct Restore { std::streambuf* old; ~Restore() { std::cout.rdbuf(old); } };',
    'template <class F> std::string capture(F run) { std::ostringstream out; Restore r{std::cout.rdbuf(out.rdbuf())}; run(); return out.str(); }',
    '}',
    // Variadic, so commas inside braces (Fraction{1, 2}) don't split the
    // arguments: the parts are separated by the compiler, not the preprocessor.
    '#define CHECK(...) ::au_check::check(#__VA_ARGS__, [&]() { return ::au_check::pack(__VA_ARGS__); })',
    '#define CHECK_THROWS(expr) ::au_check::throws(#expr, [&]() { (void)(expr); })',
    '#define OUTPUT(...) ::au_check::capture([&]() { __VA_ARGS__; })'
  ].join('\n');

  /** A learner's code plus the checks, as one program. */
  function buildChecked(code, harness, pre) {
    return String(code).replace(/\s*$/, '\n') + '\n' + PRELUDE + '\n' +
      (pre ? String(pre) + '\n' : '') +
      'int main() {\n' + String(harness) + '\n  std::cout << "\\n\\x1e" "DONE\\n";\n  return 0;\n}\n';
  }

  /**
   * CHECK's text is "expression, expected"; keep the expression. The split is
   * at the last comma that isn't inside brackets or quotes.
   */
  function checkedExpression(text) {
    var depth = 0;
    var quote = null;
    var cut = -1;
    for (var i = 0; i < text.length; i += 1) {
      var c = text.charAt(i);
      if (quote) {
        if (c === '\\') { i += 1; continue; }
        if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'") quote = c;
      else if (c === '(' || c === '[' || c === '{') depth += 1;
      else if (c === ')' || c === ']' || c === '}') depth -= 1;
      else if (c === ',' && depth === 0) cut = i;
    }
    return cut === -1 ? text : text.slice(0, cut).trim();
  }

  /** Splits a checked program's output into results and ordinary prints. */
  function parseChecked(stdout) {
    var checks = [];
    var done = false;
    var other = [];
    String(stdout || '').split('\n').forEach(function (line) {
      if (line.charAt(0) !== MARK) { other.push(line); return; }
      var body = line.slice(1);
      if (body === 'DONE') { done = true; return; }
      var parts = body.split(SEP);
      var restore = function (s) { return String(s == null ? '' : s).replace(/\u001d/g, '\n'); };
      var expr = restore(parts[1]);
      expr = checkedExpression(expr);
      checks.push({ ok: parts[0] === 'PASS', expr: expr, got: restore(parts[2]), want: restore(parts[3]) });
    });
    // The checker starts each result on a fresh line; drop the blanks it adds.
    var printed = other.join('\n').replace(/\n{2,}/g, '\n').replace(/^\n+|\n+$/g, '');
    return { checks: checks, done: done, output: printed };
  }

  /** Warnings and errors that point into the checker are noise for a learner. */
  function learnerDiagnostics(text) {
    var blocks = String(text || '').split(/\n(?=\S)/);
    return blocks.filter(function (block) { return !/checks\.cpp/.test(block); }).join('\n').trim();
  }

  // ------------------------------------------------------------ answers

  /**
   * Code without the spaces that do not matter; quoted text kept as typed.
   * In languages where 'x', "x" and `x` mean the same (everything but C++),
   * strings are rewritten with double quotes; in HTML and CSS, everything
   * outside quotes is case-insensitive.
   */
  function squash(text, lang) {
    var s = plainText(text).trim().replace(/;+$/, '');
    var sameQuotes = lang && lang !== 'cpp' && lang !== 'c++';
    var anyCase = lang === 'html' || lang === 'css';
    var out = '';
    var i = 0;
    while (i < s.length) {
      var c = s.charAt(i);
      if (c === '"' || c === "'" || (c === '`' && sameQuotes)) {
        var j = i + 1;
        var body = '';
        while (j < s.length && s.charAt(j) !== c) {
          if (s.charAt(j) === '\\' && j + 1 < s.length) { body += s.charAt(j) + s.charAt(j + 1); j += 2; continue; }
          body += s.charAt(j);
          j += 1;
        }
        var closed = j < s.length;
        if (sameQuotes && closed && body.indexOf('"') === -1 && !(c === '`' && body.indexOf('${') !== -1)) {
          out += '"' + (c === "'" ? body.replace(/\\'/g, "'") : body) + '"';
        } else {
          out += c + body + (closed ? c : '');
        }
        i = j + 1;
      } else {
        if (!/\s/.test(c)) out += anyCase ? c.toLowerCase() : c;
        i += 1;
      }
    }
    return out;
  }

  /** Whether one typed blank of a fill-in question is right. */
  function blankMatches(q, index, value) {
    var mine = squash(value, q.lang);
    return mine !== '' && asList((q.blanks || [])[index]).some(function (option) { return squash(option, q.lang) === mine; });
  }

  /** Output as typed by a person: also forgiving about which dash they used. */
  function sameOutput(typed, expected) {
    var a = normalizeOutput(typed).replace(/^\n+/, '');
    var b = normalizeOutput(expected).replace(/^\n+/, '');
    if (a === b) return true;
    var dashes = function (x) { return x.replace(/-+/g, '-'); };
    return dashes(a) === dashes(b);
  }

  function asList(value) {
    if (Array.isArray(value)) return value;
    if (value === undefined || value === null) return [];
    return [value];
  }

  /**
   * Marks one answer.
   * @returns {{ok: boolean, expected?: any}}
   */
  function checkAnswer(q, response) {
    switch (q.type) {
      case 'mcq': {
        var want = asList(q.answer).map(Number).sort();
        var got = asList(response).map(Number).sort();
        return { ok: want.length === got.length && want.every(function (v, i) { return v === got[i]; }) };
      }
      case 'tf':
        return { ok: Boolean(response) === Boolean(q.answer) && response !== undefined && response !== null };
      case 'output':
        return { ok: sameOutput(response, q.answer) };
      case 'fill': {
        var given = asList(response);
        return { ok: (q.blanks || []).every(function (_, i) { return blankMatches(q, i, given[i]); }) };
      }
      case 'order': {
        var order = asList(response).map(Number);
        var right = function (target) {
          return target.length === order.length && target.every(function (v, i) { return v === order[i]; });
        };
        var natural = (q.lines || []).map(function (_, i) { return i; });
        return { ok: right(natural) || (q.alternatives || []).some(right) };
      }
      case 'spot':
        return { ok: asList(q.answer).map(Number).indexOf(Number(response)) !== -1 };
      default:
        return { ok: false };
    }
  }

  // ------------------------------------------------------------ dates

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  /** The local calendar day of a moment, as YYYY-MM-DD. */
  function dayKey(date) {
    var d = date instanceof Date ? date : new Date(date === undefined ? Date.now() : date);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function addDays(key, days) {
    var parts = String(key).split('-').map(Number);
    var d = new Date(parts[0], parts[1] - 1, parts[2] + days);
    return dayKey(d);
  }

  function daysBetween(fromKey, toKey) {
    var a = String(fromKey).split('-').map(Number);
    var b = String(toKey).split('-').map(Number);
    var ms = Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2]);
    return Math.round(ms / 86400000);
  }

  // ------------------------------------------------------------ spaced repetition

  var GRADES = ['again', 'hard', 'good', 'easy'];

  function newCard(today) {
    return { ease: 2.5, interval: 0, reps: 0, lapses: 0, due: today || dayKey() };
  }

  /**
   * SM-2, simplified to four buttons. A card you know drifts out to weeks and
   * months; one you forget comes back today.
   */
  function schedule(card, grade, now) {
    var today = dayKey(now);
    var c = Object.assign(newCard(today), card || {});
    var g = typeof grade === 'number' ? grade : GRADES.indexOf(grade);
    var interval;

    if (g <= 0) {
      c.reps = 0;
      c.lapses += 1;
      c.ease = Math.max(1.3, c.ease - 0.2);
      interval = 0;
    } else if (g === 1) {
      c.ease = Math.max(1.3, c.ease - 0.15);
      interval = Math.max(1, Math.round(c.interval * 1.2));
      c.reps += 1;
    } else if (g === 2) {
      interval = c.reps === 0 ? 1 : c.reps === 1 ? 3 : Math.max(c.interval + 1, Math.round(c.interval * c.ease));
      c.reps += 1;
    } else {
      interval = c.reps === 0 ? 3 : Math.max(c.interval + 2, Math.round(c.interval * c.ease * 1.3));
      c.ease += 0.15;
      c.reps += 1;
    }

    c.interval = Math.min(interval, 365);
    c.due = addDays(today, c.interval);
    c.at = new Date(now === undefined ? Date.now() : now).toISOString();
    c.ease = Math.round(c.ease * 100) / 100;
    return c;
  }

  function isDue(card, now) {
    return Boolean(card) && String(card.due) <= dayKey(now);
  }

  // ------------------------------------------------------------ XP and levels

  var XP = {
    lesson: 20,
    check: 3,
    task: 15,
    quiz: 25,
    challenge: [0, 30, 50, 80],
    exam: 100,
    milestone: 40,
    review: 2
  };

  var LEVELS = [
    { xp: 0, title: 'Newcomer' },
    { xp: 100, title: 'First Steps' },
    { xp: 300, title: 'Beginner' },
    { xp: 600, title: 'Apprentice' },
    { xp: 1000, title: 'Coder' },
    { xp: 1600, title: 'Programmer' },
    { xp: 2400, title: 'Developer' },
    { xp: 3400, title: 'Engineer' },
    { xp: 4800, title: 'Expert' },
    { xp: 6500, title: 'Master' },
    { xp: 9000, title: 'Grandmaster' }
  ];

  function levelFor(xp) {
    var index = 0;
    for (var i = 0; i < LEVELS.length; i += 1) if (xp >= LEVELS[i].xp) index = i;
    var next = LEVELS[index + 1] || null;
    var floor = LEVELS[index].xp;
    return {
      level: index + 1,
      title: LEVELS[index].title,
      xp: xp,
      floor: floor,
      next: next ? next.xp : null,
      progress: next ? (xp - floor) / (next.xp - floor) : 1
    };
  }

  /** Consecutive active days ending today (or yesterday, if today is still open). */
  function streak(days, now) {
    var today = dayKey(now);
    var active = function (key) { return Boolean(days && days[key] > 0); };
    var cursor = active(today) ? today : addDays(today, -1);
    var count = 0;
    while (active(cursor)) {
      count += 1;
      cursor = addDays(cursor, -1);
    }
    return count;
  }

  // ------------------------------------------------------------ progress

  function emptyProgress() {
    return {
      v: 1,
      updatedAt: '',
      resetAt: '',
      items: {},      // id -> {status, best, attempts, xp, at}
      code: {},       // id -> {src, at}
      cards: {},      // card id -> schedule
      notes: {},      // lesson id -> {text, at}
      exams: {},      // exam id -> [{score, passed, at}]
      mistakes: {},   // question id -> {count, streak, cleared, at}
      days: {},       // YYYY-MM-DD -> xp earned
      unlocked: {},   // chapter id -> at
      badges: {},     // badge id -> at
      stats: {},      // counter -> number
      settings: {},
      snippets: {}    // playground snippets: id -> {name, src, at}
    };
  }

  function stamp(entry) { return String(entry && entry.at || ''); }
  function newer(a, b) { return stamp(a) >= stamp(b) ? a : b; }

  function mergeItem(a, b) {
    if (!a) return b;
    if (!b) return a;
    var base = Object.assign({}, newer(a, b) === a ? b : a, newer(a, b));
    base.status = a.status === 'done' || b.status === 'done' ? 'done' : (a.status || b.status);
    base.best = Math.max(Number(a.best) || 0, Number(b.best) || 0);
    base.attempts = Math.max(Number(a.attempts) || 0, Number(b.attempts) || 0);
    base.xp = Math.max(Number(a.xp) || 0, Number(b.xp) || 0);
    if (a.doneAt || b.doneAt) {
      base.doneAt = [a.doneAt, b.doneAt].filter(Boolean).sort()[0];
    }
    return base;
  }

  function mergeMaps(a, b, pick) {
    var out = {};
    var keys = {};
    Object.keys(a || {}).forEach(function (k) { keys[k] = true; });
    Object.keys(b || {}).forEach(function (k) { keys[k] = true; });
    Object.keys(keys).forEach(function (k) {
      var x = a ? a[k] : undefined;
      var y = b ? b[k] : undefined;
      out[k] = x === undefined ? y : y === undefined ? x : pick(x, y);
    });
    return out;
  }

  function earliest(x, y) { return String(x) <= String(y) ? x : y; }

  /**
   * Combines progress from two devices. Nothing earned is ever lost: a done
   * item stays done, best scores only rise, and the newer copy of anything
   * edited (code, notes, flashcards) wins. A reset on either side wipes
   * whatever came before it.
   */
  function mergeProgress(a, b) {
    a = Object.assign(emptyProgress(), a || {});
    b = Object.assign(emptyProgress(), b || {});
    var out = emptyProgress();

    out.resetAt = [a.resetAt, b.resetAt].sort().pop() || '';
    var keep = function (source) {
      if (!out.resetAt) return source;
      var filtered = {};
      Object.keys(source || {}).forEach(function (k) {
        var entry = source[k];
        var at = Array.isArray(entry) ? '' : typeof entry === 'string' ? entry : stamp(entry);
        if (Array.isArray(entry)) {
          var list = entry.filter(function (e) { return stamp(e) >= out.resetAt; });
          if (list.length) filtered[k] = list;
        } else if (at >= out.resetAt) {
          filtered[k] = entry;
        }
      });
      return filtered;
    };

    out.items = mergeMaps(keep(a.items), keep(b.items), mergeItem);
    out.code = mergeMaps(keep(a.code), keep(b.code), newer);
    out.cards = mergeMaps(keep(a.cards), keep(b.cards), newer);
    out.notes = mergeMaps(keep(a.notes), keep(b.notes), newer);
    out.mistakes = mergeMaps(keep(a.mistakes), keep(b.mistakes), newer);
    out.snippets = mergeMaps(keep(a.snippets), keep(b.snippets), newer);
    out.exams = mergeMaps(keep(a.exams), keep(b.exams), function (x, y) {
      var seen = {};
      return x.concat(y).filter(function (e) {
        var key = stamp(e) + '|' + e.score;
        if (seen[key]) return false;
        seen[key] = true;
        return true;
      }).sort(function (p, q) { return stamp(p).localeCompare(stamp(q)); }).slice(-50);
    });
    out.unlocked = mergeMaps(keep(a.unlocked), keep(b.unlocked), earliest);
    out.badges = mergeMaps(keep(a.badges), keep(b.badges), earliest);

    // Counters and daily XP only grow; a reset starts them again from zero.
    var resetA = a.resetAt === out.resetAt;
    var resetB = b.resetAt === out.resetAt;
    var counters = function (x, y) { return Math.max(Number(x) || 0, Number(y) || 0); };
    out.days = mergeMaps(resetA ? a.days : {}, resetB ? b.days : {}, counters);
    out.stats = mergeMaps(resetA ? a.stats : {}, resetB ? b.stats : {}, counters);

    out.settings = newer(a.settings || {}, b.settings || {});
    out.updatedAt = [a.updatedAt, b.updatedAt].sort().pop() || '';
    return out;
  }

  /** Total XP: what each item earned plus flashcard reviews. */
  function totalXp(progress) {
    var sum = 0;
    var items = (progress && progress.items) || {};
    Object.keys(items).forEach(function (k) { sum += Number(items[k].xp) || 0; });
    sum += (Number(progress && progress.stats && progress.stats.reviews) || 0) * XP.review;
    return sum;
  }

  // ------------------------------------------------------------ helpers

  /** Fisher–Yates with an optional seed, so an exam attempt is reproducible. */
  function shuffle(list, seed) {
    var out = list.slice();
    var s = seed === undefined ? Math.floor(Math.random() * 2147483647) : seed;
    var rand = function () {
      s = (s * 48271) % 2147483647;
      return s / 2147483647;
    };
    if (s <= 0) s += 2147483646;
    for (var i = out.length - 1; i > 0; i -= 1) {
      var j = Math.floor(rand() * (i + 1));
      var t = out[i]; out[i] = out[j]; out[j] = t;
    }
    return out;
  }

  /** Does a program read from std::cin (so it needs input to be typed)? */
  function readsInput(code) {
    var stripped = String(code || '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '')
      .replace(/"(?:\\.|[^"\\\n])*"/g, '""');
    return /\b(?:std::)?(?:cin|getline)\b/.test(stripped) || /\bscanf\s*\(/.test(stripped);
  }

  return {
    normalizeOutput: normalizeOutput,
    compareOutput: compareOutput,
    PRELUDE: PRELUDE,
    buildChecked: buildChecked,
    parseChecked: parseChecked,
    checkedExpression: checkedExpression,
    learnerDiagnostics: learnerDiagnostics,
    squash: squash,
    plainText: plainText,
    blankMatches: blankMatches,
    sameOutput: sameOutput,
    checkAnswer: checkAnswer,
    dayKey: dayKey,
    addDays: addDays,
    daysBetween: daysBetween,
    GRADES: GRADES,
    newCard: newCard,
    schedule: schedule,
    isDue: isDue,
    XP: XP,
    LEVELS: LEVELS,
    levelFor: levelFor,
    streak: streak,
    emptyProgress: emptyProgress,
    mergeProgress: mergeProgress,
    totalXp: totalXp,
    shuffle: shuffle,
    readsInput: readsInput
  };
});
