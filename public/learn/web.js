/*
 * Running HTML, CSS and JavaScript for Learn mode — entirely in the browser.
 *
 * JavaScript on its own runs in a Web Worker: it can't touch the page, and an
 * endless loop is simply terminated. Pages (HTML with its CSS and JS) run in a
 * sandboxed iframe with no access to this site. In both, a small "bridge"
 * captures console output and errors, and runs the exercise's checks —
 * lines like `check(add(2, 3), 5)` or, for pages, `check(style('h1', 'color'),
 * color('red'))` — against the learner's code.
 *
 * The pure parts (console formatting, check translation, loop protection,
 * error explanations) are also used by the tests in Node.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../compose.js'));
  else root.LearnWeb = factory(root.Compose);
}(typeof self !== 'undefined' ? self : this, function (Compose) {
  'use strict';

  /*
   * The bridge is injected, as source, into every worker and page we run. It
   * must stay self-contained: no references to anything outside itself.
   *   scope  the global object (self in a worker, window in a page)
   *   post   sends a message to Learn mode
   *   opts   {grading: bool, inputs: string[]}
   */
  function AU_BRIDGE(scope, post, opts) {
    opts = opts || {};

    // ---------------------------------------------------------- formatting
    function quote(s) {
      return "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n') + "'";
    }

    function keyName(k) {
      return /^[A-Za-z_$][\w$]*$/.test(k) ? k : quote(k);
    }

    // Close to what a browser console shows: [1, 2, 3], {a: 1, b: 'x'}.
    function format(v, depth, seen) {
      depth = depth || 0;
      seen = seen || [];
      var nested = depth > 0;
      if (typeof v === 'string') return nested ? quote(v) : v;
      if (typeof v === 'number') return Object.is(v, -0) ? '-0' : String(v);
      if (typeof v === 'bigint') return String(v) + 'n';
      if (v === undefined) return 'undefined';
      if (v === null) return 'null';
      if (typeof v === 'boolean' || typeof v === 'symbol') return String(v);
      if (typeof v === 'function') {
        if (/^class\b/.test(Function.prototype.toString.call(v))) return 'class ' + (v.name || '(anonymous)');
        return 'ƒ ' + (v.name || '') + '()';
      }
      if (seen.indexOf(v) !== -1) return '[Circular]';
      if (v instanceof Error) return nested ? v.name + ': ' + v.message : (v.name + ': ' + v.message);
      if (v instanceof Date) return isNaN(v) ? 'Invalid Date' : v.toString();
      if (v instanceof RegExp) return String(v);
      if (typeof Element !== 'undefined' && v instanceof Element) {
        return '<' + v.tagName.toLowerCase() + (v.id ? '#' + v.id : '') +
          (v.className && typeof v.className === 'string' ? '.' + v.className.trim().split(/\s+/).join('.') : '') + '>';
      }
      if (depth > 3) return Array.isArray(v) ? '[…]' : '{…}';
      var next = seen.concat([v]);
      var items;
      if (Array.isArray(v)) {
        items = [];
        var holes = 0;
        for (var i = 0; i < v.length && items.length < 100; i += 1) {
          if (!(i in v)) { holes += 1; continue; }
          if (holes) { items.push('empty × ' + holes); holes = 0; }
          items.push(format(v[i], depth + 1, next));
        }
        if (holes) items.push('empty × ' + holes);
        if (v.length > 100) items.push('…');
        return '[' + items.join(', ') + ']';
      }
      if (v instanceof Map) {
        items = [];
        v.forEach(function (val, key) { items.push(format(key, depth + 1, next) + ' => ' + format(val, depth + 1, next)); });
        return 'Map(' + v.size + ') {' + items.join(', ') + '}';
      }
      if (v instanceof Set) {
        items = [];
        v.forEach(function (val) { items.push(format(val, depth + 1, next)); });
        return 'Set(' + v.size + ') {' + items.join(', ') + '}';
      }
      if (typeof Promise !== 'undefined' && v instanceof Promise) return 'Promise {…}';
      items = Object.keys(v).slice(0, 100).map(function (k) {
        return keyName(k) + ': ' + format(v[k], depth + 1, next);
      });
      var proto = Object.getPrototypeOf(v);
      var name = proto && proto !== Object.prototype && proto.constructor && proto.constructor.name;
      return (name ? name + ' ' : '') + '{' + items.join(', ') + '}';
    }

    // In check results strings are shown in double quotes, so spaces show.
    function show(v) {
      if (typeof v === 'string') return JSON.stringify(v);
      return format(v, 1);
    }

    function line(args) {
      return Array.prototype.map.call(args, function (a) { return format(a); }).join(' ');
    }

    // ---------------------------------------------------------- comparing
    function same(a, b) {
      if (typeof a === 'number' && typeof b === 'number') {
        if (Number.isNaN(a) && Number.isNaN(b)) return true;
        if (a === b) return true;
        return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
      }
      if (a === b) return true;
      if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
      if (Array.isArray(a) !== Array.isArray(b)) return false;
      if (Array.isArray(a)) {
        if (a.length !== b.length) return false;
        for (var i = 0; i < a.length; i += 1) if (!same(a[i], b[i])) return false;
        return true;
      }
      if (a instanceof Map || b instanceof Map) {
        if (!(a instanceof Map && b instanceof Map) || a.size !== b.size) return false;
        var okMap = true;
        a.forEach(function (val, key) { if (!b.has(key) || !same(val, b.get(key))) okMap = false; });
        return okMap;
      }
      if (a instanceof Set || b instanceof Set) {
        if (!(a instanceof Set && b instanceof Set) || a.size !== b.size) return false;
        var okSet = true;
        a.forEach(function (val) { if (!b.has(val)) okSet = false; });
        return okSet;
      }
      if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
      var ka = Object.keys(a);
      var kb = Object.keys(b);
      if (ka.length !== kb.length) return false;
      for (var j = 0; j < ka.length; j += 1) {
        if (!Object.prototype.hasOwnProperty.call(b, ka[j]) || !same(a[ka[j]], b[ka[j]])) return false;
      }
      return true;
    }

    // ---------------------------------------------------------- console
    // Output is capped, so a loop that prints forever can't flood Learn mode.
    var maxLines = opts.maxLines || 1000;
    var maxChars = opts.maxChars || 100000;
    var lines = 0;
    var chars = 0;
    var cut = false;
    function emit(level, text) {
      if (cut) return;
      lines += 1;
      chars += text.length;
      if (lines > maxLines || chars > maxChars) {
        cut = true;
        post({ kind: 'log', level: 'warn', text: '… output stopped here: more than ' + (lines > maxLines ? maxLines + ' lines' : maxChars + ' characters') + ' were printed.' });
        post({ kind: 'truncated' });
        return;
      }
      post({ kind: 'log', level: level, text: text });
    }
    var originalConsole = scope.console || {};
    var fakeConsole = {};
    ['log', 'info', 'warn', 'error', 'debug'].forEach(function (level) {
      fakeConsole[level] = function () {
        emit(level === 'debug' || level === 'info' ? 'log' : level, line(arguments));
      };
    });
    fakeConsole.table = function (data) { emit('log', format(data)); };
    fakeConsole.clear = function () { post({ kind: 'clear' }); };
    fakeConsole.assert = function (ok) {
      if (!ok) emit('error', 'Assertion failed' + (arguments.length > 1 ? ': ' + line(Array.prototype.slice.call(arguments, 1)) : ''));
    };
    fakeConsole.dir = fakeConsole.log;
    try { scope.console = fakeConsole; } catch (e) { /* read-only console */ }
    if (scope.console !== fakeConsole && originalConsole) {
      Object.keys(fakeConsole).forEach(function (k) { try { originalConsole[k] = fakeConsole[k]; } catch (e) { /* ignore */ } });
    }

    // ---------------------------------------------------------- errors
    function describe(err) {
      if (err && typeof err === 'object' && 'message' in err) return (err.name || 'Error') + ': ' + err.message;
      return 'Uncaught ' + format(err);
    }

    var errorCount = 0;
    function report(err, where) {
      errorCount += 1;
      if (errorCount > 20) return;
      post({ kind: 'error', where: where || 'run', message: describe(err), stack: err && err.stack ? String(err.stack) : '' });
    }

    if (scope.addEventListener) {
      scope.addEventListener('error', function (e) {
        errorCount += 1;
        if (errorCount > 20) return;
        post({ kind: 'error', where: 'page', message: e.message || 'Error', file: e.filename || '', line: e.lineno || 0, stack: e.error && e.error.stack ? String(e.error.stack) : '' });
      });
      scope.addEventListener('unhandledrejection', function (e) {
        post({ kind: 'error', where: 'promise', message: 'Unhandled promise rejection: ' + describe(e.reason), stack: e.reason && e.reason.stack ? String(e.reason.stack) : '' });
      });
    }

    // ---------------------------------------------------------- timers
    // Programs finish when their code has run and no timers are left pending.
    var pending = {};
    var pendingCount = 0;
    var realSetTimeout = scope.setTimeout.bind(scope);
    var realClearTimeout = scope.clearTimeout.bind(scope);
    var realSetInterval = scope.setInterval.bind(scope);
    var realClearInterval = scope.clearInterval.bind(scope);
    scope.setTimeout = function (fn, ms) {
      var args = Array.prototype.slice.call(arguments, 2);
      var id = realSetTimeout(function () {
        if (pending[id]) { delete pending[id]; pendingCount -= 1; }
        if (typeof fn === 'function') fn.apply(null, args);
      }, ms);
      pending[id] = true;
      pendingCount += 1;
      return id;
    };
    scope.clearTimeout = function (id) {
      if (pending[id]) { delete pending[id]; pendingCount -= 1; }
      realClearTimeout(id);
    };
    scope.setInterval = function (fn, ms) {
      var args = Array.prototype.slice.call(arguments, 2);
      var id = realSetInterval(function () { if (typeof fn === 'function') fn.apply(null, args); }, ms);
      pending[id] = true;
      pendingCount += 1;
      return id;
    };
    scope.clearInterval = function (id) {
      if (pending[id]) { delete pending[id]; pendingCount -= 1; }
      realClearInterval(id);
    };

    // ---------------------------------------------------------- loop guard
    var started = Date.now();
    var ticks = 0;
    function loop() {
      ticks += 1;
      if ((ticks & 4095) === 0 && Date.now() - started > (opts.loopMs || 3000)) {
        started = Date.now() + 1e9;
        throw new Error('This loop ran for more than ' + ((opts.loopMs || 3000) / 1000) + ' seconds, so it was stopped. Is its condition ever false?');
      }
    }

    // ---------------------------------------------------------- dialogs
    var inputs = (opts.inputs || []).slice();
    if (opts.grading || !scope.document) {
      scope.alert = function (msg) { emit('log', '[alert] ' + format(msg)); };
      scope.prompt = function (msg) {
        var answer = inputs.length ? inputs.shift() : null;
        emit('log', '[prompt] ' + format(msg === undefined ? '' : msg) + ' → ' + (answer === null ? 'null' : answer));
        return answer;
      };
      scope.confirm = function (msg) { emit('log', '[confirm] ' + format(msg) + ' → true'); return true; };
    }

    // ---------------------------------------------------------- checks
    var results = 0;
    async function check(expr, getActual, getExpected) {
      results += 1;
      if (results > 500) return false;
      var actual;
      var expected;
      try {
        actual = await getActual();
      } catch (err) {
        post({ kind: 'check', ok: false, expr: expr, got: 'threw ' + describe(err), want: safeShow(getExpected) });
        return false;
      }
      try {
        expected = await getExpected();
      } catch (err) {
        post({ kind: 'check', ok: false, expr: expr, got: show(actual), want: '(the check itself failed: ' + describe(err) + ')' });
        return false;
      }
      var ok = same(actual, expected);
      post({ kind: 'check', ok: ok, expr: expr, got: show(actual), want: show(expected) });
      return ok;
    }

    function safeShow(get) {
      try { return show(get()); } catch (e) { return '?'; }
    }

    async function throws(expr, run) {
      results += 1;
      try {
        await run();
      } catch (err) {
        post({ kind: 'check', ok: true, expr: expr, got: 'threw ' + describe(err), want: 'an error' });
        return true;
      }
      post({ kind: 'check', ok: false, expr: expr, got: 'no error', want: 'an error' });
      return false;
    }

    function finish(budget) {
      var waited = 0;
      var tick = function () {
        if (pendingCount <= 0 || waited >= (budget || 4000)) {
          post({ kind: 'done', pending: pendingCount });
          return;
        }
        waited += 10;
        realSetTimeout(tick, 10);
      };
      realSetTimeout(tick, 0);
    }

    // ---------------------------------------------------------- page helpers
    var dom = null;
    if (scope.document) {
      var doc = scope.document;
      var one = function (sel) { return doc.querySelector(sel); };
      dom = {
        $: one,
        $$: function (sel) { return Array.prototype.slice.call(doc.querySelectorAll(sel)); },
        exists: function (sel) { return Boolean(one(sel)); },
        count: function (sel) { return doc.querySelectorAll(sel).length; },
        text: function (sel) {
          var el = one(sel);
          return el ? el.textContent.replace(/\s+/g, ' ').trim() : null;
        },
        attr: function (sel, name) {
          var el = one(sel);
          return el ? el.getAttribute(name) : null;
        },
        tag: function (sel) {
          var el = one(sel);
          return el ? el.tagName.toLowerCase() : null;
        },
        style: function (sel, prop) {
          var el = one(sel);
          if (!el) return null;
          return scope.getComputedStyle(el).getPropertyValue(prop).trim();
        },
        // Any CSS colour written the way computed styles report it.
        color: function (value) {
          var probe = doc.createElement('span');
          probe.style.color = value;
          doc.body.appendChild(probe);
          var out = scope.getComputedStyle(probe).color;
          probe.remove();
          return out;
        },
        box: function (sel) {
          var el = one(sel);
          if (!el) return null;
          var r = el.getBoundingClientRect();
          return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
        },
        click: function (sel) {
          var el = one(sel);
          if (!el) throw new Error('There is no element matching ' + sel + ' to click');
          el.click();
        },
        typeInto: function (sel, value) {
          var el = one(sel);
          if (!el) throw new Error('There is no element matching ' + sel + ' to type into');
          el.focus();
          el.value = value;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        },
        submit: function (sel) {
          var form = one(sel);
          if (!form) throw new Error('There is no form matching ' + sel);
          if (form.requestSubmit) form.requestSubmit(); else form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        },
        press: function (sel, key) {
          var el = sel ? one(sel) : doc.body;
          if (!el) throw new Error('There is no element matching ' + sel);
          el.dispatchEvent(new KeyboardEvent('keydown', { key: key, bubbles: true }));
          el.dispatchEvent(new KeyboardEvent('keyup', { key: key, bubbles: true }));
        },
        wait: function (ms) { return new Promise(function (resolve) { realSetTimeout(resolve, ms || 0); }); },
        // Resizes the frame (for media queries), then waits for the layout.
        viewport: function (width) {
          post({ kind: 'viewport', width: width });
          return new Promise(function (resolve) {
            var done = false;
            var finishResize = function () { if (!done) { done = true; resolve(); } };
            scope.addEventListener('resize', function handler() { scope.removeEventListener('resize', handler); realSetTimeout(finishResize, 30); });
            realSetTimeout(finishResize, 400);
          });
        },
        html: function () { return doc.documentElement.outerHTML; }
      };
      // Links and forms in a preview: only this page exists here, so say
      // where a link or form would have gone instead of leaving a blank frame.
      doc.addEventListener('click', function (e) {
        var link = e.target && e.target.closest ? e.target.closest('a[href]') : null;
        if (!link || e.defaultPrevented) return;
        var href = link.getAttribute('href') || '';
        if (href.charAt(0) === '#') return;
        e.preventDefault();
        if (/^https?:/i.test(href) && !opts.grading) {
          try { scope.open(href, '_blank', 'noopener'); } catch (err) { /* popups blocked */ }
          emit('log', '[link] opened ' + href + ' in a new tab');
        } else {
          emit('log', '[link] would go to ' + href + (/^(mailto|tel):/i.test(href) ? '' : ' — in this preview only this page exists'));
        }
      });
      scope.addEventListener('submit', function (e) {
        if (e.defaultPrevented) return;
        e.preventDefault();
        var form = e.target;
        var pairs = [];
        try {
          new scope.FormData(form).forEach(function (value, key) { pairs.push(key + '=' + (typeof value === 'string' ? value : '[file]')); });
        } catch (err) { /* no FormData */ }
        emit('log', '[form] would send ' + (pairs.length ? pairs.join('&') : 'nothing (no named fields)') +
          ' to ' + (form.getAttribute('action') || 'this page') + ' (' + (form.getAttribute('method') || 'get').toUpperCase() + ')');
      });

      // Reports the page's height so a preview can fit its content.
      var reportSize = function () {
        try {
          var h = Math.max(doc.documentElement.scrollHeight, doc.body ? doc.body.scrollHeight : 0);
          post({ kind: 'size', height: h });
        } catch (e) { /* ignore */ }
      };
      scope.addEventListener('load', function () {
        reportSize();
        if (scope.ResizeObserver && doc.body) new scope.ResizeObserver(reportSize).observe(doc.body);
      });
    }

    var api = {
      format: format,
      show: show,
      same: same,
      check: check,
      throws: throws,
      loop: loop,
      finish: finish,
      fail: report,
      dom: dom,
      count: function () { return results; }
    };
    scope.__au = api;
    return api;
  }

  // ------------------------------------------------------------ pure helpers

  var bridgeApi = null;
  function pure() {
    if (!bridgeApi) {
      // A throwaway scope, so formatting and comparing work anywhere (tests too).
      var fake = { console: {}, setTimeout: setTimeout, clearTimeout: clearTimeout, setInterval: setInterval, clearInterval: clearInterval };
      bridgeApi = AU_BRIDGE(fake, function () {}, {});
    }
    return bridgeApi;
  }

  function format(v) { return pure().format(v); }
  function show(v) { return pure().show(v); }
  function same(a, b) { return pure().same(a, b); }

  /**
   * Skips over a string, template literal or comment starting at i.
   * @returns {number} the index just after it, or i if nothing is there.
   */
  function skipNonCode(src, i) {
    var c = src.charAt(i);
    var d = src.charAt(i + 1);
    if (c === '/' && d === '/') {
      var nl = src.indexOf('\n', i);
      return nl === -1 ? src.length : nl;
    }
    if (c === '/' && d === '*') {
      var end = src.indexOf('*/', i + 2);
      return end === -1 ? src.length : end + 2;
    }
    if (c === '"' || c === "'" || c === '`') {
      var j = i + 1;
      while (j < src.length) {
        var ch = src.charAt(j);
        if (ch === '\\') { j += 2; continue; }
        if (ch === c) return j + 1;
        if (c === '`' && ch === '$' && src.charAt(j + 1) === '{') {
          // A template expression: skip to its matching brace.
          var depth = 1;
          j += 2;
          while (j < src.length && depth > 0) {
            var skipped = skipNonCode(src, j);
            if (skipped !== j) { j = skipped; continue; }
            if (src.charAt(j) === '{') depth += 1;
            else if (src.charAt(j) === '}') depth -= 1;
            j += 1;
          }
          continue;
        }
        j += 1;
      }
      return src.length;
    }
    return i;
  }

  /** The index of the bracket that closes the one at `open`, or -1. */
  function matchBracket(src, open) {
    var depth = 0;
    var i = open;
    while (i < src.length) {
      var skipped = skipNonCode(src, i);
      if (skipped !== i) { i = skipped; continue; }
      var c = src.charAt(i);
      if (c === '(' || c === '[' || c === '{') depth += 1;
      else if (c === ')' || c === ']' || c === '}') {
        depth -= 1;
        if (depth === 0) return i;
      }
      i += 1;
    }
    return -1;
  }

  /** Splits "a, f(b, c), [d, e]" at its top-level commas. */
  function splitArgs(src) {
    var parts = [];
    var depth = 0;
    var start = 0;
    var i = 0;
    while (i < src.length) {
      var skipped = skipNonCode(src, i);
      if (skipped !== i) { i = skipped; continue; }
      var c = src.charAt(i);
      if (c === '(' || c === '[' || c === '{') depth += 1;
      else if (c === ')' || c === ']' || c === '}') depth -= 1;
      else if (c === ',' && depth === 0) { parts.push(src.slice(start, i)); start = i + 1; }
      i += 1;
    }
    parts.push(src.slice(start));
    return parts.map(function (p) { return p.trim(); }).filter(function (p, k, all) { return p !== '' || k < all.length - 1; });
  }

  /**
   * Turns the checks an exercise is written with into calls the bridge can
   * run and report: `check(add(2, 3), 5)` becomes
   * `await __au.check("add(2, 3)", () => (add(2, 3)), () => (5))`, and
   * `checkThrows(expr)` becomes `await __au.throws("expr", () => (expr))`.
   */
  function translateHarness(src) {
    src = String(src || '');
    var out = '';
    var i = 0;
    while (i < src.length) {
      var skipped = skipNonCode(src, i);
      if (skipped !== i) { out += src.slice(i, skipped); i = skipped; continue; }
      var m = /^(checkThrows|check)\s*\(/.exec(src.slice(i));
      var before = i > 0 ? src.charAt(i - 1) : '';
      if (m && !/[\w$.]/.test(before)) {
        var open = i + m[0].length - 1;
        var close = matchBracket(src, open);
        if (close !== -1) {
          var args = splitArgs(src.slice(open + 1, close));
          if (m[1] === 'check' && args.length >= 2) {
            out += 'await __au.check(' + JSON.stringify(args[0]) + ', () => (' + args[0] + '), () => (' + args[1] + '))';
            i = close + 1;
            continue;
          }
          if (m[1] === 'checkThrows' && args.length >= 1) {
            out += 'await __au.throws(' + JSON.stringify(args[0]) + ', async () => { ' + args[0] + '; })';
            i = close + 1;
            continue;
          }
        }
      }
      out += src.charAt(i);
      i += 1;
    }
    return out;
  }

  /**
   * Adds a guard to every braced loop, so an endless loop in a page stops
   * with a message instead of freezing the browser tab.
   */
  function protectLoops(src) {
    src = String(src || '');
    var out = '';
    var i = 0;
    var guard = '__au.loop();';
    while (i < src.length) {
      var skipped = skipNonCode(src, i);
      if (skipped !== i) { out += src.slice(i, skipped); i = skipped; continue; }
      var before = i > 0 ? src.charAt(i - 1) : '';
      var rest = src.slice(i, i + 8);
      var kw = /^(for|while)\b/.exec(rest);
      if (kw && !/[\w$.]/.test(before)) {
        var j = i + kw[1].length;
        while (/\s/.test(src.charAt(j))) j += 1;
        if (kw[1] === 'for' && src.slice(j, j + 5) === 'await') { j += 5; while (/\s/.test(src.charAt(j))) j += 1; }
        if (src.charAt(j) === '(') {
          var close = matchBracket(src, j);
          if (close !== -1) {
            var k = close + 1;
            while (/\s/.test(src.charAt(k))) k += 1;
            if (src.charAt(k) === '{') {
              out += src.slice(i, k + 1) + guard;
              i = k + 1;
              continue;
            }
          }
        }
      }
      var doKw = /^do\b/.exec(rest);
      if (doKw && !/[\w$.]/.test(before)) {
        var n = i + 2;
        while (/\s/.test(src.charAt(n))) n += 1;
        if (src.charAt(n) === '{') {
          out += src.slice(i, n + 1) + guard;
          i = n + 1;
          continue;
        }
      }
      out += src.charAt(i);
      i += 1;
    }
    return out;
  }

  // ------------------------------------------------------------ explanations

  var RULES = [
    [/^ReferenceError: (\S+) is not defined/, function (m) {
      return '`' + m[1] + '` doesn\'t exist at this point. Check the spelling (JavaScript is case-sensitive: `total` and `Total` are different), and that it was declared with `let`, `const` or `function` before it is used.';
    }],
    [/Cannot read propert(?:y|ies) of (undefined|null)(?: \(reading '([^']*)'\))?/, function (m) {
      return 'You asked for ' + (m[2] ? '`.' + m[2] + '` of ' : 'a property of ') + '`' + m[1] + '` — the thing before the dot has no value. Common causes: a variable that was never given a value, an array index past the end, or `document.querySelector` finding nothing (check the selector and that the element exists).';
    }],
    [/Cannot set propert(?:y|ies) of (undefined|null)/, function (m) {
      return 'You tried to set a property on `' + m[1] + '`. The object you meant isn\'t there — if it came from `querySelector`, the selector matched nothing.';
    }],
    [/(\S+) is not a function/, function (m) {
      return '`' + m[1] + '` is being called like a function, but it isn\'t one. Check the name (`toUpperCase`, not `toUppercase`), and that you aren\'t calling a value, like `total()` when `total` is a number.';
    }],
    [/Assignment to constant variable/, function () {
      return 'A `const` can\'t be given a new value. Use `let` for variables that change.';
    }],
    [/Cannot access '([^']+)' before initialization/, function (m) {
      return '`' + m[1] + '` is used above the line that creates it. Move the `let`/`const` declaration earlier.';
    }],
    [/Identifier '([^']+)' has already been declared/, function (m) {
      return '`' + m[1] + '` is declared twice. Declare a variable once (`let x = 1;`), then just assign it (`x = 2;`).';
    }],
    [/Maximum call stack size exceeded/, function () {
      return 'A function kept calling itself and never stopped. A recursive function needs a base case that returns without calling itself.';
    }],
    [/missing \) after argument list/, function () {
      return 'A `(` was never closed, or two arguments are missing a comma between them. Look at the function call on this line.';
    }],
    [/Unexpected end of input/, function () {
      return 'The code ended while something was still open — usually a missing `}` or `)`. Count your brackets: each `{` needs a `}`.';
    }],
    [/Unexpected token '?\}'?/, function () {
      return 'There is a `}` the code didn\'t expect — often one too many, or a missing `(` or `{` earlier.';
    }],
    [/Unexpected identifier/, function () {
      return 'Two words are next to each other where JavaScript expected something between them — a missing comma, operator, `;` or quote. Look just before the highlighted spot.';
    }],
    [/Invalid or unexpected token/, function () {
      return 'There is a character JavaScript can\'t read here — often a quote that was opened but not closed, or "smart quotes" pasted from a document.';
    }],
    [/Unexpected string/, function () {
      return 'A string appears where JavaScript didn\'t expect one — usually a missing `+` or comma between two values.';
    }],
    [/Unexpected number/, function () {
      return 'A number appears where JavaScript didn\'t expect one — maybe a missing operator or comma, or a name that starts with a digit.';
    }],
    [/Invalid left-hand side in assignment/, function () {
      return 'You can only assign (`=`) to a variable or property. If you meant to compare, use `===`.';
    }],
    [/await is only valid/, function () {
      return '`await` only works inside an `async` function. Mark the function `async`.';
    }],
    [/is not iterable/, function () {
      return '`for...of` and spreading need something iterable, like an array or a string. Check the value really is one.';
    }],
    [/This loop ran for more than/, function () {
      return 'Make sure the loop\'s condition eventually becomes false: the variable in the condition has to change inside the loop, in the right direction.';
    }],
    [/Unexpected token/, function () {
      return 'JavaScript found a symbol it didn\'t expect here. Check for a missing or extra bracket, comma or quote on this line or the one before.';
    }]
  ];

  /** A hint, in plain words, for a JavaScript error message (or ''). */
  function explain(message) {
    var text = String(message || '');
    for (var i = 0; i < RULES.length; i += 1) {
      var m = RULES[i][0].exec(text);
      if (m) return RULES[i][1](m);
    }
    return '';
  }

  /** The line (in the learner's code) an error happened on, from its stack. */
  function lineFromStack(stack, fileHint, offset, lines) {
    var re = /:(\d+):(\d+)\)?\s*$/;
    var rows = String(stack || '').split('\n');
    for (var i = 0; i < rows.length; i += 1) {
      if (fileHint && rows[i].indexOf(fileHint) === -1) continue;
      var m = re.exec(rows[i]);
      if (!m) continue;
      var n = Number(m[1]) - (offset || 0);
      if (n >= 1 && (!lines || n <= lines)) return n;
    }
    return 0;
  }

  // ------------------------------------------------------------ building runs

  function bridgeCall(postSource, opts) {
    return '(' + AU_BRIDGE.toString() + ')(' + postSource + ', ' + JSON.stringify(opts || {}) + ');';
  }

  /**
   * The worker program for some JavaScript plus optional checks.
   * @returns {{source: string, offset: number, lines: number}}
   */
  function workerSource(code, harness, opts) {
    var head = bridgeCall('self, function (m) { self.postMessage(m); }', opts) + '\n(async function () {\n';
    var offset = head.split('\n').length - 1;
    var user = String(code || '');
    var source = head + user + '\n;\n' +
      'await (async function () {\n' + translateHarness(harness || '') + '\n})();\n' +
      '})().then(function () { __au.finish(' + Number(opts && opts.settleMs || 4000) + '); }, function (e) { __au.fail(e, "run"); __au.finish(0); });\n';
    return { source: source, offset: offset, lines: user.split('\n').length };
  }

  function scriptTag(js, name) {
    return '<script>' + String(js).replace(/<\/script>/gi, '<\\/script>') + '\n//# sourceURL=' + name + '\n<\/script>';
  }

  var PAGE_HELPERS = ['$', '$$', 'exists', 'count', 'text', 'attr', 'tag', 'style', 'color', 'box', 'click', 'typeInto', 'submit', 'press', 'wait', 'viewport', 'html'];

  /**
   * The document for a page: the learner's files composed like the editor
   * does it, with the bridge first in <head> and the checks (if any) last.
   * @param {Array<{name, content}>} files
   * @param {{harness?: string, grading?: boolean, inputs?: string[]}} opts
   */
  function pageDocument(files, opts) {
    opts = opts || {};
    files = (files || []).map(function (f) {
      var content = String(f.content || '');
      // Guard loops in the learner's scripts so they can't freeze the tab.
      if (Compose.fileType(f.name) === 'js') content = protectLoops(content);
      return { name: f.name, content: content };
    });
    var entry = Compose.entryOf(files);
    if (!entry) {
      files = files.concat([{ name: 'index.html', content: '' }]);
      entry = 'index.html';
    }
    var bridge = '<script>' + bridgeCall('window, function (m) { try { parent.postMessage(Object.assign({ __learn: true }, m), "*"); } catch (e) {} }', {
      grading: Boolean(opts.grading),
      inputs: opts.inputs || [],
      // A page shares the tab with Learn mode, so a runaway loop is cut short.
      loopMs: 1500,
      maxLines: 500
    }) + '<\/script>';
    var doc = Compose.composeFile(files, entry, { title: 'Preview' });

    // The bridge goes first, so it sees every console.log the page makes.
    if (/<head\b[^>]*>/i.test(doc)) doc = doc.replace(/<head\b[^>]*>/i, function (m) { return m + '\n' + bridge; });
    else if (/<html\b[^>]*>/i.test(doc)) doc = doc.replace(/<html\b[^>]*>/i, function (m) { return m + '\n' + bridge; });
    else doc = bridge + '\n' + doc;

    // Linked stylesheets and scripts are folded in; scripts keep their file
    // names so errors point at "script.js:3". A deferred script moves to the
    // end of the body, which is when `defer` would have run it.
    doc = doc.replace(/<link\b[^>]*href=["']([^"']+)["'][^>]*>/gi, function (tag, href) {
      if (!/stylesheet/i.test(tag)) return tag;
      var sheet = Compose.find(files, href);
      return sheet ? '<style>\n' + sheet.content + '\n</style>' : tag;
    });
    var deferred = [];
    doc = doc.replace(/<script\b([^>]*)src=["']([^"']+)["']([^>]*)>\s*<\/script>/gi, function (tag, pre, src, post) {
      var script = Compose.find(files, src);
      if (!script) return tag;
      if (/\bdefer\b/i.test(pre + post)) {
        deferred.push(scriptTag(script.content, script.name));
        return '';
      }
      return scriptTag(script.content, script.name);
    });

    var tail = deferred.join('\n');
    if (opts.harness !== undefined) {
      var body = translateHarness(opts.harness);
      tail += scriptTag(
        'window.addEventListener("load", function () { setTimeout(async function () {\n' +
        '  try {\n' +
        '    await (async function (' + PAGE_HELPERS.join(', ') + ') {\n' + body + '\n' +
        '    })(' + PAGE_HELPERS.map(function (n) { return '__au.dom.' + n; }).join(', ') + ');\n' +
        '  } catch (e) { __au.fail(e, "checks"); }\n' +
        '  __au.finish(' + Number(opts.settleMs || 1500) + ');\n' +
        '}, 0); });', 'checks.js');
    } else {
      tail += scriptTag('window.addEventListener("load", function () { __au.finish(' + Number(opts.settleMs || 1500) + '); });', 'bridge.js');
    }
    // A function, not a string: "$$" or "$&" in the code must stay as written.
    if (/<\/body\s*>/i.test(doc)) doc = doc.replace(/<\/body\s*>(?![\s\S]*<\/body\s*>)/i, function () { return tail + '\n</body>'; });
    else doc += '\n' + tail;
    return doc;
  }

  // ------------------------------------------------------------ running (browser)

  /** What a run produced, in one shape for workers and pages. */
  function emptyResult() {
    return { output: [], errors: [], checks: [], done: false, timedOut: false, ms: 0 };
  }

  function addMessage(result, m, map) {
    if (!m || typeof m !== 'object') return;
    if (m.kind === 'log') result.output.push({ level: m.level, text: String(m.text) });
    else if (m.kind === 'clear') result.output = [];
    else if (m.kind === 'check') result.checks.push({ ok: Boolean(m.ok), expr: String(m.expr), got: String(m.got), want: String(m.want) });
    else if (m.kind === 'error') {
      var err = { message: String(m.message).replace(/^Uncaught /, ''), where: m.where || 'run', line: 0, file: '' };
      if (map) map(err, m);
      err.hint = explain(err.message);
      result.errors.push(err);
    } else if (m.kind === 'done') result.done = true;
  }

  /** Console output as the plain text an output question compares. */
  function outputText(result) {
    return result.output.filter(function (o) { return o.level !== 'error' && o.level !== 'warn'; })
      .map(function (o) { return o.text; }).join('\n');
  }

  function allOutputText(result) {
    return result.output.map(function (o) { return o.text; }).join('\n');
  }

  /**
   * Runs JavaScript in a worker.
   * @param {{code: string, harness?: string, timeoutMs?: number, inputs?: string[]}} job
   * @returns {Promise<object>} {output, errors, checks, done, timedOut, ms}
   */
  function runJs(job) {
    var built = workerSource(job.code, job.harness, { inputs: job.inputs || [], settleMs: job.settleMs || 3000 });
    var started = Date.now();
    var result = emptyResult();
    var map = function (err, m) {
      err.line = lineFromStack(m.stack, null, built.offset, built.lines);
      if (err.line) err.file = 'script.js';
    };
    return new Promise(function (resolve) {
      var url = URL.createObjectURL(new Blob([built.source], { type: 'text/javascript' }));
      var worker = new Worker(url);
      var finished = false;
      var end = function () {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        worker.terminate();
        URL.revokeObjectURL(url);
        result.ms = Date.now() - started;
        resolve(result);
      };
      var timer = setTimeout(function () { result.timedOut = true; end(); }, job.timeoutMs || 5000);
      worker.onmessage = function (e) {
        addMessage(result, e.data, map);
        if (result.done) end();
      };
      worker.onerror = function (e) {
        e.preventDefault();
        // A syntax error stops the whole script before anything runs.
        var line = e.lineno ? e.lineno - built.offset : 0;
        var err = {
          message: String(e.message || 'Error').replace(/^Uncaught /, ''),
          where: 'syntax',
          line: line >= 1 && line <= built.lines ? line : 0,
          file: 'script.js'
        };
        err.hint = explain(err.message);
        result.errors.push(err);
        end();
      };
    });
  }

  /**
   * Runs a page in a hidden sandboxed frame (for checks) and collects what
   * happened.
   * @param {{files: Array, harness?: string, timeoutMs?: number, width?: number}} job
   */
  function runPage(job) {
    var started = Date.now();
    var result = emptyResult();
    var frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts allow-forms');
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    frame.style.cssText = 'position:fixed;left:-12000px;top:0;width:' + (job.width || 800) + 'px;height:600px;border:0;visibility:hidden';
    var map = function (err, m) {
      mapPageError(err, m);
    };
    return new Promise(function (resolve) {
      var finished = false;
      var onMessage = function (e) {
        if (e.source !== frame.contentWindow || !e.data || !e.data.__learn) return;
        if (e.data.kind === 'viewport') { frame.style.width = Number(e.data.width) + 'px'; return; }
        addMessage(result, e.data, map);
        if (result.done) end();
      };
      var end = function () {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        window.removeEventListener('message', onMessage);
        frame.remove();
        result.ms = Date.now() - started;
        resolve(result);
      };
      var timer = setTimeout(function () { result.timedOut = true; end(); }, job.timeoutMs || 8000);
      window.addEventListener('message', onMessage);
      frame.srcdoc = pageDocument(job.files, { harness: job.harness || '', grading: true, inputs: job.inputs, settleMs: job.settleMs });
      document.body.appendChild(frame);
    });
  }

  function mapPageError(err, m) {
    var file = /([\w.-]+\.js)$/.exec(String(m.file || ''));
    if (file) {
      err.file = file[1];
      err.line = Number(m.line) || 0;
    } else {
      var fromStack = /([\w.-]+\.js):(\d+):\d+/.exec(String(m.stack || ''));
      if (fromStack) { err.file = fromStack[1]; err.line = Number(fromStack[2]); }
    }
    if (err.file === 'checks.js' || err.file === 'bridge.js') { err.file = ''; err.line = 0; err.where = 'checks'; }
  }

  /**
   * Shows a page in a visible frame (examples and the playground) and streams
   * its console output and errors to `onMessage`.
   * @returns {{frame: HTMLIFrameElement, update(files), destroy()}}
   */
  function livePage(frame, files, onMessage, opts) {
    opts = opts || {};
    frame.setAttribute('sandbox', 'allow-scripts allow-forms allow-modals allow-popups');
    var listener = function (e) {
      if (e.source !== frame.contentWindow || !e.data || !e.data.__learn) return;
      var m = e.data;
      if (m.kind === 'size' && opts.autoHeight) {
        frame.style.height = Math.max(opts.minHeight || 80, Math.min(opts.maxHeight || 460, Number(m.height) + 4)) + 'px';
        return;
      }
      if (m.kind === 'viewport') return;
      if (m.kind === 'error') {
        var err = { message: String(m.message).replace(/^Uncaught /, ''), where: m.where, line: 0, file: '' };
        mapPageError(err, m);
        err.hint = explain(err.message);
        onMessage({ kind: 'error', error: err });
        return;
      }
      onMessage(m);
    };
    window.addEventListener('message', listener);
    var update = function (next) {
      frame.srcdoc = pageDocument(next, {});
    };
    update(files);
    return {
      frame: frame,
      update: update,
      destroy: function () { window.removeEventListener('message', listener); }
    };
  }

  return {
    AU_BRIDGE: AU_BRIDGE,
    format: format,
    show: show,
    same: same,
    translateHarness: translateHarness,
    protectLoops: protectLoops,
    splitArgs: splitArgs,
    explain: explain,
    lineFromStack: lineFromStack,
    workerSource: workerSource,
    pageDocument: pageDocument,
    outputText: outputText,
    allOutputText: allOutputText,
    runJs: runJs,
    runPage: runPage,
    livePage: livePage,
    PAGE_HELPERS: PAGE_HELPERS
  };
}));
