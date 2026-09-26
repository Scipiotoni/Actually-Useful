/*
 * Video lessons: silent, animated explanations. A video is a script of
 * steps — type this code, highlight that tag, point at what it makes on the
 * page, say this — played on a timeline like a film. Nothing is recorded:
 * the player draws every moment from the script, so it stays sharp at any
 * size, can slow down and stop anywhere, and weighs a few kilobytes.
 *
 * This file is the timeline, with no DOM: it turns a script into timed steps
 * and says exactly what is on screen at any moment (frameAt). player.js
 * draws it.
 *
 * A script (the `video:` of an item):
 *
 *   view:  page (code and a browser), console (code and its output), or code
 *   lang:  how the code is coloured when it isn't a web page (js, cpp, css…)
 *   start: the files at the beginning — {index.html: "…"}; default one empty file
 *   css:   extra CSS for the browser only, never shown
 *   assets: pictures the page uses, {cake.svg: "<svg …>"}: the code says
 *          src="cake.svg" and the browser shows the picture
 *   steps: what happens, in order. A step can have:
 *     scene: "Title"   a chapter title card (and marker on the timeline); sub: a line under it
 *     say:   "text"    the caption (stays until the next one; "" clears it)
 *     file:  name      switch to (or create) that file
 *     type:  "text"    type it at the end of the file, or after `at:` / before `before:` some text
 *     erase: "text"    delete it, backspace by backspace
 *     replace: "old"   with: "new" — select the old text and type over it
 *     set:   "text"    the whole file becomes this, at once
 *     mark:  what to highlight in the code: "text", {text, nth, all, color} or a list
 *     point: what to highlight on the page: "css selector", {sel, label, color} or a list;
 *            "@tab" is the browser tab (where <title> shows) and "@url" the address bar
 *     zoom:  code | page — bring one side forward
 *     click: selector  the pointer moves there and clicks
 *     fill:  {sel, text}  the pointer clicks a form field and types into it
 *     tick:  selector  the pointer ticks a checkbox or picks a radio button
 *     dom:   changes a script would make, for JavaScript videos: {sel, text, html, add, remove, style, attr}
 *     print: "text"    lines appear in the console
 *     clear: true      empties the console
 *     line:  n         the line being run (0: none), for walking through a program
 *     vars:  {name: value}  the variables panel (reset: true empties it first)
 *     scroll: selector the page scrolls to it
 *     show:  page.html the browser opens that file (after clicking a link, say)
 *     run:   true      the Run button flashes: the program is running
 *     hold:  seconds   how long the step stays (default: time to read its caption)
 *     speed: n         typing speed for this step (2 = twice as fast)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LearnVideo = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var TIMING = {
    scene: 2.6,       // a title card
    cps: 17,          // characters typed per second
    newline: 0.12,    // a small pause at the end of a typed line
    eraseCps: 45,
    select: 0.55,     // selecting the text a replace types over
    pointer: 0.8,     // the pointer travelling to what it clicks
    fillCps: 11,      // typing into a form, like a person
    printLine: 0.4,
    mark: 1.8,        // time to look at a highlight with no caption
    after: 0.35       // a breath after anything else
  };

  var STEP_KEYS = ['scene', 'sub', 'say', 'file', 'type', 'at', 'before', 'erase', 'replace', 'with', 'set', 'mark', 'point',
    'zoom', 'click', 'fill', 'tick', 'dom', 'print', 'clear', 'line', 'vars', 'reset', 'scroll', 'hold', 'speed', 'label', 'show', 'run'];
  var COLORS = ['gold', 'pink', 'green', 'blue'];

  function text(v) { return v === undefined || v === null ? '' : String(v); }
  function list(v) { return v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]; }
  function isMap(v) { return Boolean(v) && typeof v === 'object' && !Array.isArray(v); }

  /** The words of a caption, without markdown, for reading time. */
  function words(s) {
    return text(s).replace(/[`*_]/g, '').split(/\s+/).filter(Boolean).length;
  }

  function readTime(say) {
    return Math.min(7.5, Math.max(2.2, 1.3 + words(say) * 0.3));
  }

  function typeTime(s, speed) {
    var nl = (s.match(/\n/g) || []).length;
    return (s.length / TIMING.cps + nl * TIMING.newline) / (speed || 1);
  }

  function normMarks(raw, label) {
    return list(raw).map(function (m) {
      if (isMap(m)) {
        return { text: text(m.text), nth: m.nth === undefined ? 1 : Number(m.nth), all: Boolean(m.all), color: COLORS.indexOf(m.color) === -1 ? '' : m.color };
      }
      return { text: text(m), nth: 1, all: false, color: '' };
    }).filter(function (m) { return m.text; });
  }

  function normPoints(raw, label) {
    return list(raw).map(function (p) {
      if (isMap(p)) return { sel: text(p.sel), label: p.label === undefined ? null : text(p.label), color: COLORS.indexOf(p.color) === -1 ? '' : p.color, all: p.all !== false };
      return { sel: text(p), label: label === undefined ? null : label, color: '', all: true };
    }).filter(function (p) { return p.sel; });
  }

  function normStep(raw) {
    raw = isMap(raw) ? raw : { say: text(raw) };
    var s = {
      scene: raw.scene === undefined ? null : text(raw.scene),
      sub: text(raw.sub),
      say: raw.say === undefined || raw.say === null ? null : text(raw.say),
      file: raw.file === undefined ? null : text(raw.file),
      type: raw.type === undefined ? null : text(raw.type),
      at: raw.at === undefined ? null : text(raw.at),
      before: raw.before === undefined ? null : text(raw.before),
      erase: raw.erase === undefined ? null : text(raw.erase),
      replace: raw.replace === undefined ? null : text(raw.replace),
      with: text(raw.with),
      set: raw.set === undefined ? null : text(raw.set),
      marks: normMarks(raw.mark),
      points: normPoints(raw.point, raw.label === undefined ? undefined : text(raw.label)),
      zoom: raw.zoom === 'code' || raw.zoom === 'page' ? raw.zoom : null,
      click: raw.click === undefined ? null : text(raw.click),
      fill: isMap(raw.fill) ? { sel: text(raw.fill.sel), text: text(raw.fill.text) } : null,
      tick: raw.tick === undefined ? null : text(raw.tick),
      dom: list(raw.dom).filter(isMap).map(function (d) {
        return {
          sel: text(d.sel),
          text: d.text === undefined ? null : text(d.text),
          html: d.html === undefined ? null : text(d.html),
          add: text(d.add),
          remove: text(d.remove),
          style: text(d.style),
          attr: isMap(d.attr) ? d.attr : null
        };
      }),
      print: raw.print === undefined ? null : text(raw.print),
      clear: Boolean(raw.clear),
      line: raw.line === undefined ? null : Number(raw.line) || 0,
      vars: isMap(raw.vars) ? raw.vars : null,
      reset: Boolean(raw.reset),
      scroll: raw.scroll === undefined ? null : text(raw.scroll),
      show: raw.show === undefined ? null : text(raw.show),
      run: Boolean(raw.run),
      hold: raw.hold === undefined ? null : Number(raw.hold),
      speed: Number(raw.speed) || 1,
      _raw: raw
    };
    return s;
  }

  function fileList(map) {
    if (!isMap(map)) return [];
    return Object.keys(map).map(function (name) {
      // A file ends with a new line, so typing at its end starts a fresh line.
      var content = text(map[name]);
      if (content && !/\n$/.test(content)) content += '\n';
      return { name: name, content: content };
    });
  }

  /**
   * A script, ready to play: its steps with start and end times.
   * @param {object} raw       the item's `video:`
   * @param {{lang?: string, web?: boolean}} defaults  from the course
   */
  function build(raw, defaults) {
    raw = isMap(raw) ? raw : {};
    defaults = defaults || {};
    var lang = text(raw.lang) || defaults.lang || 'html';
    var files = fileList(raw.start);
    var view = raw.view === 'page' || raw.view === 'console' || raw.view === 'code' ? raw.view
      : (lang === 'html' || lang === 'css' || files.some(function (f) { return /\.html?$/.test(f.name); }) ? 'page' : 'console');
    if (!files.length) {
      files = [{ name: view === 'page' ? 'index.html' : lang === 'cpp' ? 'main.cpp' : lang === 'css' ? 'style.css' : 'script.js', content: '' }];
    }
    var video = {
      view: view,
      lang: lang,
      files: files,
      css: text(raw.css),
      url: text(raw.url),
      assets: isMap(raw.assets) ? raw.assets : {},
      speed: Number(raw.speed) || 1,
      steps: list(raw.steps).map(normStep),
      duration: 0,
      scenes: []
    };
    var t = 0;
    video.steps.forEach(function (s, i) {
      s.index = i;
      s.start = t;
      s.sceneDur = s.scene !== null ? TIMING.scene : 0;
      var action = 0;
      var speed = s.speed * video.speed;
      if (s.type !== null) action += typeTime(s.type, speed);
      if (s.erase !== null) action += s.erase.length / TIMING.eraseCps / speed + 0.2;
      if (s.replace !== null) action += TIMING.select + typeTime(s.with, speed);
      if (s.click !== null) action += TIMING.pointer + 0.35;
      if (s.tick !== null) action += TIMING.pointer + 0.35;
      if (s.fill) action += TIMING.pointer + s.fill.text.length / TIMING.fillCps;
      if (s.print !== null) action += s.print.split('\n').length * TIMING.printLine;
      if (s.run) action += 0.6;
      s.actionDur = action;
      var hold;
      if (s.hold !== null && !isNaN(s.hold)) hold = s.hold;
      else if (s.say) hold = readTime(s.say);
      else if (s.marks.length || s.points.length) hold = TIMING.mark;
      else if (s.scene !== null && !action) hold = 0;
      else hold = TIMING.after;
      s.holdDur = hold;
      s.end = t + s.sceneDur + action + hold;
      if (s.scene !== null) video.scenes.push({ title: s.scene, sub: s.sub, at: t, step: i });
      t = s.end;
    });
    video.duration = t;
    return video;
  }

  // ------------------------------------------------------------ frames

  function find(content, needle, nth) {
    if (!needle) return -1;
    if (nth < 0) {
      var at = content.length;
      var found = -1;
      for (var k = 0; k < -nth; k += 1) {
        if (at <= 0) return -1;
        found = content.lastIndexOf(needle, at - 1);
        if (found === -1) return -1;
        at = found;
      }
      return found;
    }
    var pos = -1;
    for (var n = 0; n < Math.max(1, nth); n += 1) {
      pos = content.indexOf(needle, pos + 1);
      if (pos === -1) return -1;
    }
    return pos;
  }

  /** Where marks fall in a file: [{start, end, color}]. */
  function resolveMarks(content, marks) {
    var out = [];
    (marks || []).forEach(function (m, i) {
      var color = m.color || COLORS[i % COLORS.length];
      if (m.all) {
        var at = content.indexOf(m.text);
        while (at !== -1) {
          out.push({ start: at, end: at + m.text.length, color: color, group: i });
          at = content.indexOf(m.text, at + m.text.length);
        }
        return;
      }
      var pos = find(content, m.text, m.nth);
      if (pos !== -1) out.push({ start: pos, end: pos + m.text.length, color: color, group: i });
    });
    return out;
  }

  function fileOf(state, name) {
    var f = state.files.find(function (x) { return x.name === name; });
    if (!f) {
      f = { name: name, content: '' };
      state.files.push(f);
    }
    return f;
  }

  function freshState(video) {
    return {
      files: video.files.map(function (f) { return { name: f.name, content: f.content }; }),
      active: video.files[0].name,
      cursor: null,
      console: [],
      vars: [],
      line: 0,
      dom: [],
      fills: {},
      ticks: {},
      scroll: null,
      show: null,
      say: ''
    };
  }

  function setVar(state, name, value) {
    var v = state.vars.find(function (x) { return x.name === name; });
    if (v) v.value = value;
    else state.vars.push({ name: name, value: value });
  }

  /**
   * Carries out a step, completely (p = 1) or part of the way (0 ≤ p < 1).
   * Returns what is only true while the step is playing: a selection, the
   * pointer, which variables just changed.
   */
  function apply(state, s, p) {
    var live = { selection: null, pointer: null, changed: [], typing: false, running: false };
    if (s.file !== null) {
      fileOf(state, s.file);
      state.active = s.file;
    }
    var f = fileOf(state, state.active);
    var elapsed = p * s.actionDur;
    var spent = 0;
    // How far along one part of the step is (parts happen one after another).
    var part = function (dur) {
      var local = dur ? Math.max(0, Math.min(1, (elapsed - spent) / dur)) : (p > 0 || s.actionDur === 0 ? 1 : 0);
      spent += dur;
      return local;
    };
    var speed = s.speed * (state.speed || 1);

    if (s.set !== null) f.content = s.set;

    if (s.type !== null) {
      var q = part(typeTime(s.type, speed));
      var base = f.content;
      var at = base.length;
      if (s.at !== null) {
        var a = base.indexOf(s.at);
        if (a !== -1) at = a + s.at.length;
      } else if (s.before !== null) {
        var b = base.indexOf(s.before);
        if (b !== -1) at = b;
      }
      var n = Math.round(q * s.type.length);
      f.content = base.slice(0, at) + s.type.slice(0, n) + base.slice(at);
      state.cursor = { file: f.name, index: at + n };
      if (q > 0 && q < 1) live.typing = true;
    }

    if (s.erase !== null) {
      var qe = part(s.erase.length / TIMING.eraseCps / speed + 0.2);
      var e = f.content.indexOf(s.erase);
      if (e !== -1) {
        var gone = Math.round(Math.min(1, qe * 1.25) * s.erase.length);
        f.content = f.content.slice(0, e + s.erase.length - gone) + f.content.slice(e + s.erase.length);
        state.cursor = { file: f.name, index: e + s.erase.length - gone };
        if (qe > 0 && qe < 1) live.typing = true;
      }
    }

    if (s.replace !== null) {
      var r = f.content.indexOf(s.replace);
      var qs = part(TIMING.select);
      var qt = part(typeTime(s.with, speed));
      if (r !== -1) {
        if (qt === 0) {
          if (qs > 0) live.selection = { file: f.name, start: r, end: r + Math.round(qs * s.replace.length) };
          state.cursor = { file: f.name, index: r + Math.round(qs * s.replace.length) };
        } else {
          var nt = Math.round(qt * s.with.length);
          f.content = f.content.slice(0, r) + s.with.slice(0, nt) + f.content.slice(r + s.replace.length);
          state.cursor = { file: f.name, index: r + nt };
          if (qt < 1) live.typing = true;
        }
      }
    }

    var pointerStep = function (sel, extra) {
      var move = part(TIMING.pointer);
      var rest = part(extra);
      live.pointer = { sel: sel, move: move, press: move >= 1 && rest < 0.6 ? 1 - rest / 0.6 : 0, done: rest };
      return { move: move, rest: rest };
    };
    var clickDone = true;
    if (s.click !== null) clickDone = pointerStep(s.click, 0.35).move >= 1;
    if (s.tick !== null) {
      var tk = pointerStep(s.tick, 0.35);
      if (tk.move >= 1) state.ticks[s.tick] = true;
      clickDone = tk.move >= 1;
    }
    if (s.fill) {
      var fl = pointerStep(s.fill.sel, s.fill.text.length / TIMING.fillCps);
      if (fl.move >= 1) state.fills[s.fill.sel] = s.fill.text.slice(0, Math.round(fl.rest * s.fill.text.length));
      if (fl.rest > 0 && fl.rest < 1) live.typing = true;
    }

    // What a script does happens once the click has landed.
    if (s.dom.length && clickDone && (p > 0 || s.actionDur === 0)) s.dom.forEach(function (d) { state.dom.push(d); });

    if (s.run) {
      live.running = part(0.6) < 1 || s.print !== null;
    }
    if (s.clear) state.console = [];
    if (s.print !== null) {
      var lines = s.print.split('\n');
      var qp = part(lines.length * TIMING.printLine);
      var shown = Math.min(lines.length, Math.ceil(qp * lines.length - 1e-9));
      for (var k = 0; k < shown; k += 1) state.console.push(lines[k]);
    }
    if (s.line !== null) state.line = s.line;
    if (s.reset) state.vars = [];
    if (s.vars) {
      Object.keys(s.vars).forEach(function (name) {
        setVar(state, name, text(s.vars[name]));
        live.changed.push(name);
      });
    }
    if (s.scroll !== null) state.scroll = s.scroll;
    if (s.show !== null && (s.click === null || clickDone)) state.show = s.show;
    if (s.say !== null) state.say = s.say;
    return live;
  }

  /**
   * Everything on screen at time t (seconds).
   * @returns {{t, step, scene, sceneCard, files, active, cursor, typing, selection,
   *   marks, points, zoom, pointer, say, console, vars, changed, line, dom, fills,
   *   ticks, scroll, done}}
   */
  function frameAt(video, t) {
    t = Math.max(0, Math.min(video.duration, Number(t) || 0));
    var state = freshState(video);
    state.speed = video.speed;
    var frame = { t: t, step: -1, scene: -1, sceneCard: null, marks: [], points: [], zoom: null, pointer: null, selection: null, typing: false, changed: [] };
    for (var i = 0; i < video.steps.length; i += 1) {
      var s = video.steps[i];
      if (s.scene !== null) frame.scene += 1;
      // The last step stays on screen at the end, highlights and all.
      var last = i === video.steps.length - 1;
      if (t >= s.end && !last) {
        apply(state, s, 1);
        if (s.scene !== null) state.say = s.say === null ? '' : state.say;
        continue;
      }
      frame.step = i;
      var local = t - s.start;
      if (s.scene !== null && local < s.sceneDur) {
        frame.sceneCard = { title: s.scene, sub: s.sub, p: local / s.sceneDur };
        state.say = '';
        break;
      }
      if (s.scene !== null) state.say = '';
      local -= s.sceneDur;
      var p = s.actionDur ? Math.min(1, local / s.actionDur) : 1;
      var live = apply(state, s, p);
      frame.selection = live.selection;
      frame.pointer = live.pointer;
      frame.typing = live.typing;
      frame.changed = live.changed;
      frame.running = live.running;
      frame.zoom = s.zoom;
      frame.points = s.points;
      var f = state.files.find(function (x) { return x.name === state.active; });
      frame.marks = resolveMarks(f ? f.content : '', s.marks);
      // Highlights wait until the code they are about has been written.
      if (p < 1 && (s.type !== null || s.replace !== null || s.erase !== null)) {
        frame.marks = [];
        frame.points = [];
      }
      break;
    }
    if (frame.step === -1) frame.step = video.steps.length - 1;
    frame.files = state.files;
    frame.active = state.active;
    frame.cursor = state.cursor;
    frame.say = state.say;
    frame.console = state.console;
    frame.vars = state.vars;
    frame.line = state.line;
    frame.dom = state.dom;
    frame.fills = state.fills;
    frame.ticks = state.ticks;
    frame.scroll = state.scroll;
    frame.show = state.show;
    frame.done = t >= video.duration;
    return frame;
  }

  /** Line and column (from 0) of a position in a text. */
  function lineCol(content, index) {
    var before = String(content).slice(0, index);
    var line = (before.match(/\n/g) || []).length;
    return { line: line, col: index - (before.lastIndexOf('\n') + 1) };
  }

  /**
   * The page a frame shows: its HTML, with linked stylesheets folded in and
   * scripts left out (nothing runs in a video).
   */
  function pageHtml(frame, video) {
    var files = frame.files;
    var page = (frame.show && files.find(function (f) { return f.name === frame.show; })) ||
      files.find(function (f) { return /\.html?$/i.test(f.name); });
    var html = page ? page.content : '';
    html = html.replace(/<link\b[^>]*>/gi, function (tag) {
      if (!/stylesheet/i.test(tag)) return tag;
      var href = /href\s*=\s*["']([^"']+)["']/i.exec(tag);
      var sheet = href && files.find(function (f) { return f.name === href[1]; });
      return sheet ? '<style>\n' + sheet.content + '\n</style>' : '';
    });
    html = html.replace(/<script\b[\s\S]*?(<\/script\s*>|$)/gi, '');
    // Pictures come from the video's assets.
    var assets = video.assets || {};
    html = html.replace(/(\s(?:src|poster|href)\s*=\s*)(["'])([^"']+)\2/gi, function (all, attr, q, name) {
      if (!Object.prototype.hasOwnProperty.call(assets, name)) return all;
      var data = String(assets[name]);
      if (!/^data:/.test(data)) data = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(data);
      return attr + q + data + q;
    });
    if (!page) {
      var css = files.filter(function (f) { return /\.css$/i.test(f.name); }).map(function (f) { return f.content; }).join('\n');
      if (css) html = '<style>' + css + '</style>';
    }
    var extra = '<style>' + (video.css || '') + '\n.au-vp-focus{outline:3px solid #3d7dfd!important;outline-offset:2px}</style>';
    if (/<head\b[^>]*>/i.test(html)) return html.replace(/<head\b[^>]*>/i, function (m) { return m + extra; });
    if (/<html\b[^>]*>/i.test(html)) return html.replace(/<html\b[^>]*>/i, function (m) { return m + '<head>' + extra + '</head>'; });
    return '<!DOCTYPE html><html><head><meta charset="utf-8">' + extra + '</head><body>' + html + '</body></html>';
  }

  /** The captions, in order, with when they start — a transcript. */
  function transcript(video) {
    var out = [];
    video.steps.forEach(function (s) {
      if (s.scene !== null) out.push({ at: s.start, scene: s.scene, sub: s.sub });
      if (s.say) out.push({ at: s.start + s.sceneDur, say: s.say });
    });
    return out;
  }

  /**
   * What a console video's program does by the end: its code, and what it
   * prints (commands like `$ g++ …` and ✖ error lines left out). The course
   * checks run the code and compare.
   */
  function program(video) {
    var f = frameAt(video, video.duration);
    var lines = f.console.filter(function (l) { return !/^(\$ |✖)/.test(l); });
    return {
      files: f.files,
      output: lines.join('\n'),
      errors: f.console.some(function (l) { return /^✖/.test(l); })
    };
  }

  /**
   * Everything the steps of a page video point at, click or change, with the
   * page as it is at that moment — for the course checks, which make sure
   * every selector finds something.
   */
  function targets(video) {
    var out = [];
    video.steps.forEach(function (s, i) {
      var sels = s.points.map(function (p) { return p.sel; }).filter(function (sel) { return sel.charAt(0) !== '@'; });
      [s.click, s.tick, s.scroll, s.fill && s.fill.sel].forEach(function (sel) { if (sel) sels.push(sel); });
      s.dom.forEach(function (d) { sels.push(d.sel); });
      if (!sels.length) return;
      var t = i === video.steps.length - 1 ? video.duration : s.end - 1e-6;
      out.push({ step: i + 1, sels: sels, html: pageHtml(frameAt(video, t), video) });
    });
    return out;
  }

  /** Mistakes in a script, found by playing it: text that isn't there, unknown keys. */
  function problems(raw, defaults) {
    var out = [];
    if (!isMap(raw)) return ['a video needs a script (video:)'];
    if (!list(raw.steps).length) out.push('a video needs steps');
    var video = build(raw, defaults);
    var state = freshState(video);
    state.speed = video.speed;
    video.steps.forEach(function (s, i) {
      var where = 'step ' + (i + 1);
      Object.keys(s._raw).forEach(function (k) {
        if (STEP_KEYS.indexOf(k) === -1) out.push(where + ': unknown key "' + k + '"');
      });
      if (s.replace !== null && s._raw.with === undefined) out.push(where + ': replace needs with');
      if (s._raw.with !== undefined && s.replace === null) out.push(where + ': with only goes with replace');
      if ((s.at !== null || s.before !== null) && s.type === null) out.push(where + ': at/before only go with type');
      var f = fileOf(state, s.file !== null ? s.file : state.active);
      var content = s.set !== null ? s.set : f.content;
      if (s.at !== null && content.indexOf(s.at) === -1) out.push(where + ': at "' + s.at + '" is not in ' + f.name);
      if (s.before !== null && content.indexOf(s.before) === -1) out.push(where + ': before "' + s.before + '" is not in ' + f.name);
      if (s.erase !== null && content.indexOf(s.erase) === -1) out.push(where + ': erase "' + s.erase + '" is not in ' + f.name);
      if (s.replace !== null && content.indexOf(s.replace) === -1) out.push(where + ': replace "' + s.replace + '" is not in ' + f.name);
      if (s.fill && !s.fill.sel) out.push(where + ': fill needs sel and text');
      apply(state, s, 1);
      if (s.show !== null && !state.files.some(function (x) { return x.name === s.show; })) out.push(where + ': show "' + s.show + '" is not a file');
      var now = fileOf(state, state.active).content;
      s.marks.forEach(function (m) {
        if (!resolveMarks(now, [m]).length) out.push(where + ': mark "' + m.text + '"' + (m.nth !== 1 ? ' (nth ' + m.nth + ')' : '') + ' is not in ' + state.active);
      });
      if (s.sceneDur + s.actionDur + s.holdDur <= 0) out.push(where + ': does nothing');
    });
    // The code pane shows about 50 characters: longer lines scroll, and much longer ones get cut off.
    var widest = video.view === 'code' ? 100 : 60;
    state.files.forEach(function (f) {
      f.content.split('\n').forEach(function (line, n) {
        if (line.length > widest) out.push(f.name + ' line ' + (n + 1) + ' is ' + line.length + ' characters: keep lines under ' + widest + ' so they fit');
      });
    });
    return out;
  }

  return {
    TIMING: TIMING,
    build: build,
    frameAt: frameAt,
    resolveMarks: resolveMarks,
    lineCol: lineCol,
    pageHtml: pageHtml,
    transcript: transcript,
    program: program,
    targets: targets,
    problems: problems
  };
}));
