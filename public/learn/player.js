/*
 * The player for Learn mode's video lessons. It draws the frames video.js
 * works out — code being typed, with its highlights; the page it makes, in a
 * little browser; arrows from one to the other; captions — and plays them
 * like a film. Hovering over it slows it down, clicking pauses it, and there
 * is no sound: everything is shown.
 *
 *   LearnPlayer.create(video, {highlight(code, mode), inline(md), title, onEnd})
 *     → {el, play(), pause(), toggle(), seek(t), time(), playing(), destroy()}
 */
(function (root) {
  'use strict';

  var V = root.LearnVideo;
  var LAYOUT = { wide: { w: 960, h: 540 }, tall: { w: 520, h: 820 } };
  var LINE_H = 21;
  var PAD_X = 12;
  var PAD_Y = 10;
  var SLOW = 0.45;
  var MODES = { html: 'html', htm: 'html', css: 'css', js: 'js', mjs: 'js', cpp: 'cpp', cc: 'cpp', h: 'cpp', hpp: 'cpp' };

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }

  function clock(s) {
    s = Math.max(0, Math.floor(s));
    return Math.floor(s / 60) + ':' + (s % 60 < 10 ? '0' : '') + (s % 60);
  }

  /** Position of an element inside the stage (unscaled), by offsets. */
  function offsetIn(node, stage) {
    var x = 0;
    var y = 0;
    while (node && node !== stage) {
      x += node.offsetLeft;
      y += node.offsetTop;
      node = node.offsetParent;
    }
    return { x: x, y: y };
  }

  function query(doc, sel, all) {
    try { return all ? Array.prototype.slice.call(doc.querySelectorAll(sel), 0, 12) : [doc.querySelector(sel)].filter(Boolean); } catch (e) { return []; }
  }

  function create(video, opts) {
    opts = opts || {};
    var highlight = opts.highlight || function (code) { return code.replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); };
    var inline = opts.inline || function (s) { return highlight(s, 'text'); };
    var usesVars = video.steps.some(function (s) { return s.vars; });

    // ---------------------------------------------------------------- the DOM
    var fig = el('figure', 'vp');
    fig.tabIndex = 0;
    fig.setAttribute('role', 'region');
    fig.setAttribute('aria-label', 'Video: ' + (opts.title || 'lesson') + '. Space pauses, arrows skip.');
    var screen = el('div', 'vp-screen');
    var stage = el('div', 'vp-stage view-' + video.view);
    screen.appendChild(stage);
    fig.appendChild(screen);

    // Code
    var codePane = el('div', 'vp-pane vp-code');
    var tabs = el('div', 'vp-tabs');
    var scroller = el('div', 'vp-scroll');
    var layer = el('div', 'vp-layer');
    var gutter = el('div', 'vp-gutter');
    var pre = el('pre', 'vp-pre');
    var codeEl = el('code');
    pre.appendChild(codeEl);
    var execBand = el('div', 'vp-exec');
    var marksLayer = el('div', 'vp-marks');
    var selBox = el('div', 'vp-selection');
    var caret = el('div', 'vp-caret');
    layer.append(execBand, gutter, marksLayer, selBox, pre, caret);
    scroller.appendChild(layer);
    codePane.append(tabs, scroller);
    stage.appendChild(codePane);

    // Page, or console
    var sidePane = null;
    var frame = null;
    var view = null;
    var pointsLayer = null;
    var pointer = null;
    var tabTitle = null;
    var urlText = null;
    var runFlag = null;
    var consoleBox = null;
    var varsBox = null;
    if (video.view === 'page') {
      sidePane = el('div', 'vp-pane vp-browser');
      var chrome = el('div', 'vp-chrome');
      var dots = el('span', 'vp-dots');
      dots.append(el('i'), el('i'), el('i'));
      tabTitle = el('span', 'vp-tabtitle', 'Untitled');
      chrome.append(dots, tabTitle);
      var urlBar = el('div', 'vp-url');
      urlText = el('span', null, '');
      urlBar.append(el('span', 'vp-lock', '🔒'), urlText);
      view = el('div', 'vp-view');
      frame = el('iframe', 'vp-frame');
      frame.setAttribute('sandbox', 'allow-same-origin');
      frame.setAttribute('tabindex', '-1');
      frame.setAttribute('aria-hidden', 'true');
      frame.title = 'The page in the video';
      pointsLayer = el('div', 'vp-points');
      pointer = el('div', 'vp-pointer');
      pointer.innerHTML = '<svg viewBox="0 0 24 24" width="26" height="26"><path d="M4 2l15 11-6.5 1.2L16.5 22l-3 1.3-3.6-7.6L4 20z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg><span class="vp-ripple"></span>';
      view.append(frame, pointsLayer, pointer);
      sidePane.append(chrome, urlBar, view);
      stage.appendChild(sidePane);
    } else if (video.view === 'console') {
      sidePane = el('div', 'vp-pane vp-console');
      var head = el('div', 'vp-console-head');
      head.append(el('span', 'vp-dots'), el('span', null, video.lang === 'cpp' ? 'Terminal — ./program' : 'Console'));
      head.firstChild.append(el('i'), el('i'), el('i'));
      runFlag = el('span', 'vp-run', '▶ Run');
      head.appendChild(runFlag);
      consoleBox = el('div', 'vp-console-lines');
      sidePane.append(head, consoleBox);
      if (usesVars) {
        varsBox = el('div', 'vp-vars');
        sidePane.appendChild(varsBox);
        sidePane.classList.add('has-vars');
      }
      stage.appendChild(sidePane);
    }

    var svgNS = 'http://www.w3.org/2000/svg';
    var links = document.createElementNS(svgNS, 'svg');
    links.setAttribute('class', 'vp-links');
    links.innerHTML = '<defs>' + ['gold', 'pink', 'green', 'blue'].map(function (c) {
      return '<marker id="vp-arrow-' + c + '" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" class="vp-arrow-' + c + '"/></marker>';
    }).join('') + '</defs>';
    stage.appendChild(links);

    var caption = el('div', 'vp-caption');
    var captionText = el('div', 'vp-caption-text');
    caption.appendChild(captionText);
    var sceneCard = el('div', 'vp-scene');
    var sceneNum = el('div', 'vp-scene-num');
    var sceneTitle = el('div', 'vp-scene-title');
    var sceneSub = el('div', 'vp-scene-sub');
    sceneCard.append(sceneNum, sceneTitle, sceneSub);
    var slowBadge = el('div', 'vp-slow', '🐢 slow motion');
    var pausedBadge = el('div', 'vp-paused', '❚❚ Paused — click to play');
    var flash = el('div', 'vp-flash');
    var poster = el('div', 'vp-poster');
    var posterBtn = el('div', 'vp-poster-btn', '▶');
    var posterText = el('div', 'vp-poster-text');
    posterText.append(el('b', null, opts.title || 'Play the video'), el('span', null, clock(video.duration) + ' · no sound needed · hover to slow down · click to pause'));
    poster.append(posterBtn, posterText);
    var endCard = el('div', 'vp-end');
    var endTitle = el('div', 'vp-end-title', '✓ That\'s the video!');
    var replay = el('button', 'vp-end-btn', '↺ Watch again');
    replay.type = 'button';
    endCard.append(endTitle, el('div', 'vp-end-sub', 'Rewind to any part with the bar below, or move on when you\'re ready.'), replay);
    stage.append(caption, sceneCard, slowBadge, pausedBadge, flash, endCard, poster);

    // Controls
    var controls = el('div', 'vp-controls');
    var playBtn = el('button', 'vp-btn vp-play', '▶');
    playBtn.type = 'button';
    playBtn.setAttribute('aria-label', 'Play');
    var timeEl = el('span', 'vp-time', '0:00 / ' + clock(video.duration));
    var bar = el('div', 'vp-bar');
    bar.setAttribute('role', 'slider');
    bar.setAttribute('aria-label', 'Position in the video');
    bar.tabIndex = -1;
    var fill = el('div', 'vp-bar-fill');
    var knob = el('div', 'vp-bar-knob');
    bar.append(fill, knob);
    video.scenes.forEach(function (sc) {
      var tick = el('i', 'vp-bar-tick');
      tick.style.left = (sc.at / video.duration * 100) + '%';
      tick.title = sc.title;
      bar.appendChild(tick);
    });
    var rateEl = el('span', 'vp-rate', '1×');
    var restartBtn = el('button', 'vp-btn', '↺');
    restartBtn.type = 'button';
    restartBtn.title = 'From the start';
    restartBtn.setAttribute('aria-label', 'From the start');
    controls.append(playBtn, timeEl, bar, rateEl, restartBtn);
    fig.appendChild(controls);

    var chapters = null;
    if (video.scenes.length > 1) {
      chapters = el('ol', 'vp-chapters');
      video.scenes.forEach(function (sc, i) {
        var li = el('li');
        var b = el('button', null);
        b.type = 'button';
        b.append(el('span', 'vp-ch-time', clock(sc.at)), el('span', null, sc.title));
        b.addEventListener('click', function () { seek(sc.at); play(); });
        li.appendChild(b);
        chapters.appendChild(li);
      });
      fig.appendChild(chapters);
    }

    // ---------------------------------------------------------------- state
    var t = 0;
    var playing = false;
    var started = false;
    var ended = false;
    var hover = false;
    var rate = 1;
    var raf = 0;
    var last = 0;
    var dirty = true;
    var layout = 'wide';
    var cw = 8.1;
    var frameReady = false;
    var lastCodeKey = '';
    var lastTabsKey = '';
    var lastPageKey = '';
    var lastWrite = 0;
    var lastStep = -1;
    var lastSay = null;
    var lastConsole = '';
    var lastVars = '';
    var markEls = [];
    var pointEls = [];
    var pointKey = '';
    var focusEl = null;
    var codeScroll = { top: 0, left: 0 };
    var pageScroll = null;
    var destroyed = false;
    var lastSecond = -1;
    var settle = 0;

    function measure() {
      var probe = el('span', null, 'mmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmm');
      probe.style.visibility = 'hidden';
      probe.style.position = 'absolute';
      pre.appendChild(probe);
      var w = probe.getBoundingClientRect().width / 40;
      var scale = stage.getBoundingClientRect().width / LAYOUT[layout].w || 1;
      probe.remove();
      if (w > 0) cw = w / scale;
    }

    function fit() {
      var width = fig.clientWidth || 800;
      var next = width < 600 ? 'tall' : 'wide';
      if (next !== layout || !stage.classList.contains('is-' + next)) {
        stage.classList.remove('is-wide', 'is-tall');
        stage.classList.add('is-' + next);
        layout = next;
      }
      var size = LAYOUT[layout];
      var scale = width / size.w;
      stage.style.width = size.w + 'px';
      stage.style.height = size.h + 'px';
      stage.style.transform = 'scale(' + scale + ')';
      screen.style.height = Math.round(size.h * scale) + 'px';
      measure();
      pointKey = '';
      markKey = '';
      dirty = true;
    }

    // ---------------------------------------------------------------- drawing

    function modeOf(name) {
      var ext = String(name).split('.').pop().toLowerCase();
      return MODES[ext] || video.lang || 'text';
    }

    function drawTabs(f) {
      var key = f.files.map(function (x) { return x.name; }).join('|') + '#' + f.active;
      if (key === lastTabsKey) return;
      lastTabsKey = key;
      tabs.textContent = '';
      f.files.forEach(function (x) {
        var tab = el('span', 'vp-tab' + (x.name === f.active ? ' is-active' : ''), x.name);
        tabs.appendChild(tab);
      });
    }

    function drawCode(f) {
      var file = f.files.find(function (x) { return x.name === f.active; }) || { name: '', content: '' };
      var key = file.name + '\u0000' + file.content;
      if (key !== lastCodeKey) {
        lastCodeKey = key;
        codeEl.innerHTML = highlight(file.content, modeOf(file.name)) || '';
        var n = file.content.split('\n').length;
        var nums = [];
        for (var i = 1; i <= n; i += 1) nums.push(i);
        gutter.textContent = nums.join('\n');
        layer.style.height = (PAD_Y * 2 + n * LINE_H + 40) + 'px';
      }
      var content = file.content;
      // The caret
      var showCaret = f.cursor && f.cursor.file === file.name;
      caret.hidden = !showCaret;
      var focus = null;
      if (showCaret) {
        var lc = V.lineCol(content, f.cursor.index);
        caret.style.left = (gutterWidth() + PAD_X + lc.col * cw) + 'px';
        caret.style.top = (PAD_Y + lc.line * LINE_H) + 'px';
        caret.classList.toggle('is-typing', Boolean(f.typing));
        if (f.typing) focus = { line: lc.line, col: lc.col };
      }
      // The line being run
      execBand.hidden = !f.line;
      if (f.line) {
        execBand.style.top = (PAD_Y + (f.line - 1) * LINE_H) + 'px';
        if (!focus) focus = { line: f.line - 1, col: 0 };
      }
      // A selection (while replacing)
      selBox.hidden = !(f.selection && f.selection.file === file.name && f.selection.end > f.selection.start);
      if (!selBox.hidden) {
        var a = V.lineCol(content, f.selection.start);
        var b = V.lineCol(content, f.selection.end);
        selBox.style.left = (gutterWidth() + PAD_X + a.col * cw) + 'px';
        selBox.style.top = (PAD_Y + a.line * LINE_H) + 'px';
        selBox.style.width = Math.max(2, (a.line === b.line ? b.col - a.col : 1) * cw) + 'px';
        selBox.style.height = LINE_H + 'px';
      }
      drawMarks(f, content);
      if (!focus && f.marks.length) {
        var m = V.lineCol(content, f.marks[0].start);
        // Wide enough to show every highlight, if they fit.
        var right = 0;
        f.marks.forEach(function (x) { right = Math.max(right, V.lineCol(content, x.end).col); });
        focus = { line: m.line, col: right, mark: true };
      }
      // Keep what matters in view.
      var viewH = scroller.clientHeight;
      var viewW = scroller.clientWidth;
      if (focus) {
        var y = PAD_Y + focus.line * LINE_H;
        if (y < codeScroll.top + LINE_H || y > codeScroll.top + viewH - LINE_H * 3) codeScroll.top = Math.max(0, y - viewH / 2.5);
        var x = gutterWidth() + PAD_X + focus.col * cw;
        if (x > codeScroll.left + viewW - 60) codeScroll.left = x - viewW + 120;
        else if (x < codeScroll.left + gutterWidth() + 20) codeScroll.left = Math.max(0, x - gutterWidth() - 40);
      }
    }

    function gutterWidth() { return 38; }

    var markKey = '';
    function drawMarks(f, content) {
      var key = f.step + ':' + f.marks.map(function (m) { return m.start + '-' + m.end; }).join(',') + ':' + cw;
      if (key === markKey) return;
      markKey = key;
      marksLayer.textContent = '';
      markEls = [];
      f.marks.forEach(function (m) {
        var a = V.lineCol(content, m.start);
        var b = V.lineCol(content, m.end);
        for (var line = a.line; line <= b.line; line += 1) {
          var lineText = content.split('\n')[line] || '';
          var from = line === a.line ? a.col : lineText.search(/\S|$/);
          var to = line === b.line ? b.col : lineText.length;
          if (to <= from) continue;
          var box = el('div', 'vp-mark c-' + m.color);
          box.style.left = (gutterWidth() + PAD_X + from * cw - 3) + 'px';
          box.style.top = (PAD_Y + line * LINE_H - 1) + 'px';
          box.style.width = ((to - from) * cw + 6) + 'px';
          box.style.height = (LINE_H + 2) + 'px';
          marksLayer.appendChild(box);
          markEls.push({ box: box, group: m.group, color: m.color, x: gutterWidth() + PAD_X + from * cw - 3, y: PAD_Y + line * LINE_H - 1, w: (to - from) * cw + 6, h: LINE_H + 2 });
        }
      });
    }

    function writePage(html) {
      var d = frame.contentDocument;
      if (!frameReady || !d || !d.documentElement) return false;
      var parsed = new DOMParser().parseFromString(html, 'text/html');
      d.replaceChild(d.importNode(parsed.documentElement, true), d.documentElement);
      return true;
    }

    function applyEffects(d, f) {
      f.dom.forEach(function (c) {
        query(d, c.sel, true).forEach(function (e) {
          if (c.text !== null) e.textContent = c.text;
          if (c.html !== null) e.innerHTML = c.html;
          c.add.split(/\s+/).filter(Boolean).forEach(function (k) { e.classList.add(k); });
          c.remove.split(/\s+/).filter(Boolean).forEach(function (k) { e.classList.remove(k); });
          if (c.style) e.setAttribute('style', (e.getAttribute('style') || '') + ';' + c.style);
          if (c.attr) {
            Object.keys(c.attr).forEach(function (name) {
              var v = c.attr[name];
              if (v === null || v === false) e.removeAttribute(name);
              else e.setAttribute(name, v === true ? '' : String(v));
            });
          }
        });
      });
      Object.keys(f.fills).forEach(function (sel) {
        query(d, sel).forEach(function (e) { e.value = f.fills[sel]; });
      });
      Object.keys(f.ticks).forEach(function (sel) {
        query(d, sel).forEach(function (e) { e.checked = true; });
      });
    }

    function drawPage(f) {
      var html = V.pageHtml(f, video);
      var key = html + '\u0000' + f.dom.length + '\u0000' + JSON.stringify(f.fills) + JSON.stringify(f.ticks);
      var now = performance.now();
      if (key !== lastPageKey && !(playing && f.typing && now - lastWrite < 110 && lastPageKey)) {
        if (writePage(html)) {
          lastPageKey = key;
          lastWrite = now;
          applyEffects(frame.contentDocument, f);
          pointKey = '';
          if (pageScroll !== null) frame.contentWindow.scrollTo(0, pageScroll);
        }
      }
      var d = frame.contentDocument;
      if (!d || !d.body) return;
      var title = d.title;
      var shown = f.show || video.url || (f.files.find(function (x) { return /\.html?$/.test(x.name); }) || { name: '' }).name;
      urlText.textContent = 'my-site.example/' + shown;
      tabTitle.textContent = title || 'Untitled';
      tabTitle.classList.toggle('is-empty', !title);
      // The focused field
      var target = null;
      if (f.pointer && f.pointer.move >= 1) target = query(d, f.pointer.sel)[0] || null;
      if (focusEl !== target) {
        if (focusEl && focusEl.classList) focusEl.classList.remove('au-vp-focus');
        focusEl = target;
        if (focusEl && /^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(focusEl.tagName)) focusEl.classList.add('au-vp-focus');
      }
      drawPoints(f, d);
      drawPointer(f, d);
      scrollPage(f, d);
    }

    function drawPoints(f, d) {
      var found = [];
      var chromeOn = {};
      f.points.forEach(function (p, gi) {
        // The browser's own parts: the tab (where <title> shows) and the address bar.
        if (p.sel === '@tab' || p.sel === '@url') {
          chromeOn[p.sel] = { label: p.label === null ? (p.sel === '@tab' ? 'the tab' : 'the address') : p.label, color: p.color || ['gold', 'pink', 'green', 'blue'][gi % 4] };
          return;
        }
        query(d, p.sel, p.all).forEach(function (e, n) { found.push({ el: e, p: p, gi: gi, n: n }); });
      });
      [['@tab', tabTitle], ['@url', urlText.parentNode]].forEach(function (pair) {
        var on = chromeOn[pair[0]];
        pair[1].classList.toggle('vp-pointed', Boolean(on));
        ['gold', 'pink', 'green', 'blue'].forEach(function (c) { pair[1].classList.toggle('c-' + c, Boolean(on) && on.color === c); });
        if (on) pair[1].setAttribute('data-label', on.label);
        else pair[1].removeAttribute('data-label');
      });
      var key = f.step + ':' + found.length;
      if (key !== pointKey) {
        pointKey = key;
        pointsLayer.textContent = '';
        pointEls = found.map(function (x) {
          var color = x.p.color || ['gold', 'pink', 'green', 'blue'][x.gi % 4];
          var box = el('div', 'vp-pt c-' + color);
          if (x.n === 0) {
            var many = found.filter(function (y) { return y.gi === x.gi; }).length;
            var label = x.p.label !== null ? x.p.label : '<' + x.el.tagName.toLowerCase() + '>';
            if (label) box.appendChild(el('span', 'vp-pt-label', label + (many > 1 && x.p.label === null ? ' ×' + many : '')));
          }
          box.style.animationDelay = (x.n * 0.08) + 's';
          pointsLayer.appendChild(box);
          return { box: box, el: x.el, gi: x.gi, color: color };
        });
      }
      pointEls.forEach(function (x) {
        var r = x.el.getBoundingClientRect();
        x.rect = r;
        x.box.classList.toggle('label-inside', r.top < 26);
        x.box.style.left = (r.left - 4) + 'px';
        x.box.style.top = (r.top - 4) + 'px';
        x.box.style.width = (r.width + 8) + 'px';
        x.box.style.height = (r.height + 8) + 'px';
      });
    }

    function drawPointer(f, d) {
      if (!f.pointer) { pointer.classList.remove('is-on'); return; }
      var target = query(d, f.pointer.sel)[0];
      var vw = view.clientWidth;
      var vh = view.clientHeight;
      var from = { x: vw - 36, y: vh - 30 };
      var to = from;
      if (target) {
        var r = target.getBoundingClientRect();
        to = { x: r.left + Math.min(r.width / 2, 40), y: r.top + r.height / 2 };
      }
      var k = f.pointer.move;
      var ease = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      pointer.classList.add('is-on');
      pointer.style.transform = 'translate(' + (from.x + (to.x - from.x) * ease) + 'px,' + (from.y + (to.y - from.y) * ease) + 'px)';
      pointer.classList.toggle('is-pressing', f.pointer.press > 0);
    }

    function scrollPage(f, d) {
      var win = frame.contentWindow;
      var se = d.scrollingElement || d.documentElement;
      var max = Math.max(0, se.scrollHeight - view.clientHeight);
      if (!max) { pageScroll = 0; return; }
      var target = null;
      var focusOn = pointEls.length ? pointEls[0].el : null;
      if (!focusOn && f.pointer) focusOn = query(d, f.pointer.sel)[0] || null;
      if (!focusOn && f.scroll) focusOn = query(d, f.scroll)[0] || null;
      if (focusOn) {
        var r = focusOn.getBoundingClientRect();
        if (r.top < 10 || r.bottom > view.clientHeight - 10) target = se.scrollTop + r.top - view.clientHeight / 3;
      } else if (f.typing && f.cursor) {
        var file = f.files.find(function (x) { return x.name === f.cursor.file; });
        if (file && /\.html?$/.test(file.name) && file.content.length - f.cursor.index < 40) target = max;
      }
      var cur = se.scrollTop;
      if (target !== null) {
        target = Math.max(0, Math.min(max, target));
        var next = Math.abs(target - cur) < 1 ? target : cur + (target - cur) * 0.18;
        win.scrollTo(0, next);
      }
      pageScroll = se.scrollTop;
    }

    function drawConsole(f) {
      runFlag.classList.toggle('is-on', Boolean(f.running));
      var key = f.console.join('\n');
      if (key !== lastConsole) {
        var grew = f.console.length > (lastConsole ? lastConsole.split('\n').length : 0);
        lastConsole = key;
        consoleBox.textContent = '';
        f.console.forEach(function (line, i) {
          var kind = /^✖/.test(line) ? ' is-error' : /^\$ /.test(line) ? ' is-cmd' : '';
          var row = el('div', 'vp-out' + kind + (grew && i === f.console.length - 1 ? ' is-new' : ''), line === '' ? ' ' : line);
          consoleBox.appendChild(row);
        });
        consoleBox.scrollTop = consoleBox.scrollHeight;
      }
      if (varsBox) {
        var vkey = JSON.stringify(f.vars) + '|' + f.changed.join(',') + '|' + f.step;
        if (vkey !== lastVars) {
          lastVars = vkey;
          varsBox.textContent = '';
          var label = el('div', 'vp-vars-title', 'Variables');
          varsBox.appendChild(label);
          var row = el('div', 'vp-vars-row');
          f.vars.forEach(function (v) {
            var cell = el('div', 'vp-var' + (f.changed.indexOf(v.name) !== -1 ? ' is-changed' : ''));
            cell.append(el('div', 'vp-var-name', v.name), el('div', 'vp-var-value', v.value));
            row.appendChild(cell);
          });
          varsBox.appendChild(row);
        }
      }
    }

    var linkEls = {};
    var linkKey = '';
    function drawLinks() {
      var key = lastStep + ':' + markEls.length + ':' + pointEls.length + ':' + layout;
      if (key !== linkKey) {
        linkKey = key;
        Object.keys(linkEls).forEach(function (g) { linkEls[g].remove(); });
        linkEls = {};
      }
      if (!markEls.length || !pointEls.length || !view) return;
      var origin = offsetIn(layer, stage);
      var viewAt = offsetIn(view, stage);
      var codeTop = offsetIn(scroller, stage);
      var groups = {};
      markEls.forEach(function (m) { if (!(m.group in groups)) groups[m.group] = { mark: m }; });
      pointEls.forEach(function (p) { if (groups[p.gi] && !groups[p.gi].point) groups[p.gi].point = p; });
      Object.keys(groups).forEach(function (g) {
        var pair = groups[g];
        var d = null;
        if (pair.point && pair.point.rect) {
          var mx = origin.x + pair.mark.x - scroller.scrollLeft;
          var my = origin.y + pair.mark.y - scroller.scrollTop;
          var r = pair.point.rect;
          var markVisible = my >= codeTop.y - 4 && my <= codeTop.y + scroller.clientHeight - 10 && mx + pair.mark.w <= codeTop.x + scroller.clientWidth + 20;
          var pointVisible = r.bottom >= 0 && r.top <= view.clientHeight;
          if (markVisible && pointVisible) {
            if (layout === 'wide') {
              var x1 = Math.min(mx + pair.mark.w, codeTop.x + scroller.clientWidth);
              var y1 = my + pair.mark.h / 2;
              var px = viewAt.x + r.left - 6;
              var py = viewAt.y + Math.max(8, Math.min(view.clientHeight - 8, r.top + Math.min(r.height, 60) / 2));
              var dx = Math.max(40, (px - x1) / 2);
              d = 'M' + x1 + ' ' + y1 + ' C' + (x1 + dx) + ' ' + y1 + ' ' + (px - dx) + ' ' + py + ' ' + px + ' ' + py;
            } else {
              var bx = mx + Math.min(pair.mark.w, 60) / 2;
              var by = my + pair.mark.h;
              var tx = viewAt.x + r.left + Math.min(r.width, 80) / 2;
              var ty = viewAt.y + Math.max(0, r.top) - 8;
              var dy = Math.max(30, (ty - by) / 2);
              d = 'M' + bx + ' ' + by + ' C' + bx + ' ' + (by + dy) + ' ' + tx + ' ' + (ty - dy) + ' ' + tx + ' ' + ty;
            }
          }
        }
        var path = linkEls[g];
        if (!path) {
          path = document.createElementNS(svgNS, 'path');
          path.setAttribute('class', 'vp-link c-' + pair.mark.color);
          path.setAttribute('marker-end', 'url(#vp-arrow-' + pair.mark.color + ')');
          path.setAttribute('pathLength', '1');
          links.appendChild(path);
          linkEls[g] = path;
        }
        if (d) {
          path.setAttribute('d', d);
          path.style.display = '';
        } else {
          path.style.display = 'none';
        }
      });
    }

    function render() {
      var f = V.frameAt(video, t);
      // Scene cards
      if (f.sceneCard) {
        var p = f.sceneCard.p;
        sceneCard.classList.add('is-on');
        sceneCard.style.opacity = String(p < 0.15 ? p / 0.15 : p > 0.85 ? (1 - p) / 0.15 : 1);
        sceneNum.textContent = 'Part ' + (f.scene + 1) + (video.scenes.length > 1 ? ' of ' + video.scenes.length : '');
        sceneTitle.textContent = f.sceneCard.title;
        sceneSub.textContent = f.sceneCard.sub || '';
      } else {
        sceneCard.classList.remove('is-on');
        sceneCard.style.opacity = '0';
      }
      stage.classList.toggle('zoom-code', f.zoom === 'code');
      stage.classList.toggle('zoom-page', f.zoom === 'page');
      drawTabs(f);
      drawCode(f);
      if (frame) drawPage(f);
      if (consoleBox) drawConsole(f);
      // Smooth scrolling of the code
      scroller.scrollTop += (codeScroll.top - scroller.scrollTop) * 0.2;
      scroller.scrollLeft += (codeScroll.left - scroller.scrollLeft) * 0.25;
      if (Math.abs(codeScroll.top - scroller.scrollTop) < 1) scroller.scrollTop = codeScroll.top;
      drawLinks();
      if (f.step !== lastStep) {
        lastStep = f.step;
        stage.classList.remove('step-in');
        void stage.offsetWidth; // restart the pop-in animations
        stage.classList.add('step-in');
      }
      if (f.say !== lastSay) {
        lastSay = f.say;
        captionText.innerHTML = f.say ? inline(f.say) : '';
        caption.classList.toggle('is-empty', !f.say);
        captionText.classList.remove('is-new');
        void captionText.offsetWidth;
        captionText.classList.add('is-new');
      }
      // Controls
      var ratio = video.duration ? t / video.duration : 0;
      fill.style.width = (ratio * 100) + '%';
      knob.style.left = (ratio * 100) + '%';
      var sec = Math.floor(t);
      if (sec !== lastSecond) {
        lastSecond = sec;
        timeEl.textContent = clock(t) + ' / ' + clock(video.duration);
        bar.setAttribute('aria-valuenow', String(sec));
      }
      if (chapters) {
        Array.prototype.forEach.call(chapters.children, function (li, i) { li.classList.toggle('is-current', i === f.scene); });
      }
      dirty = false;
    }

    // ---------------------------------------------------------------- playing

    function setPlaying(on) {
      playing = on;
      playBtn.textContent = on ? '❚❚' : '▶';
      playBtn.setAttribute('aria-label', on ? 'Pause' : 'Play');
      fig.classList.toggle('is-playing', on);
      pausedBadge.classList.toggle('is-on', !on && started && !ended);
    }

    function play() {
      if (destroyed) return;
      if (t >= video.duration) seek(0);
      started = true;
      ended = false;
      poster.classList.add('is-gone');
      endCard.classList.remove('is-on');
      setPlaying(true);
    }

    function pause() { setPlaying(false); }

    function showFlash(icon) {
      flash.textContent = icon;
      flash.classList.remove('is-on');
      void flash.offsetWidth;
      flash.classList.add('is-on');
    }

    function toggle() {
      if (playing) { pause(); showFlash('❚❚'); } else { play(); showFlash('▶'); }
    }

    function seek(to) {
      t = Math.max(0, Math.min(video.duration, to));
      if (t < video.duration) { ended = false; endCard.classList.remove('is-on'); }
      lastPageKey = lastPageKey ? lastPageKey + '*' : '';
      dirty = true;
    }

    function finish() {
      ended = true;
      setPlaying(false);
      pausedBadge.classList.remove('is-on');
      endCard.classList.add('is-on');
      if (opts.onEnd) opts.onEnd();
    }

    function loop(now) {
      if (destroyed) return;
      raf = requestAnimationFrame(loop);
      if (!fig.isConnected) return;
      var dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
      last = now;
      var want = hover && playing ? SLOW : 1;
      var before = rate;
      rate += (want - rate) * Math.min(1, dt * 5);
      if (Math.abs(want - rate) < 0.01) rate = want;
      if (rate !== before) {
        rateEl.textContent = (Math.round(rate * 100) / 100) + '×';
        rateEl.classList.toggle('is-slow', rate < 0.95);
        slowBadge.classList.toggle('is-on', rate < 0.95);
      }
      if (playing) {
        t += dt * rate;
        dirty = true;
        if (t >= video.duration) {
          t = video.duration;
          render();
          finish();
          return;
        }
      }
      // Paused, it only redraws for a moment after a change, while scrolling settles.
      if (dirty) settle = now + 1200;
      if (playing || dirty || now < settle || Math.abs(codeScroll.top - scroller.scrollTop) > 0.5 || Math.abs(codeScroll.left - scroller.scrollLeft) > 0.5) render();
    }

    // ---------------------------------------------------------------- input

    screen.addEventListener('click', function () {
      fig.focus({ preventScroll: true });
      toggle();
    });
    // Slow motion follows a mouse; a tap on a phone is not a hover.
    screen.addEventListener('pointerenter', function (e) { if (e.pointerType !== 'touch') hover = true; });
    screen.addEventListener('pointerleave', function () { hover = false; });
    playBtn.addEventListener('click', toggle);
    restartBtn.addEventListener('click', function () { seek(0); play(); });
    replay.addEventListener('click', function (e) { e.stopPropagation(); seek(0); play(); });

    var dragging = false;
    function seekFromEvent(e) {
      var r = bar.getBoundingClientRect();
      var x = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
      seek(Math.max(0, Math.min(1, x / r.width)) * video.duration);
      if (!started) { started = true; poster.classList.add('is-gone'); }
    }
    bar.addEventListener('pointerdown', function (e) {
      dragging = true;
      if (bar.setPointerCapture) bar.setPointerCapture(e.pointerId);
      seekFromEvent(e);
    });
    bar.addEventListener('pointermove', function (e) { if (dragging) seekFromEvent(e); });
    bar.addEventListener('pointerup', function () { dragging = false; });

    fig.addEventListener('keydown', function (e) {
      if (e.target !== fig) return;
      if (e.key === ' ' || e.key === 'k' || e.key === 'Enter') { e.preventDefault(); toggle(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); seek(t + 5); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); seek(t - 5); }
      else if (e.key === 'Home') { e.preventDefault(); seek(0); }
    });

    var onVisibility = function () { if (document.hidden && playing) pause(); };
    document.addEventListener('visibilitychange', onVisibility);

    var observer = typeof ResizeObserver === 'function' ? new ResizeObserver(function () { fit(); }) : null;
    if (observer) observer.observe(fig);
    else window.addEventListener('resize', fit);

    if (frame) {
      frame.addEventListener('load', function () {
        frameReady = true;
        lastPageKey = '';
        dirty = true;
      });
      frame.srcdoc = '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body></body></html>';
    }

    stage.classList.add('is-wide');
    requestAnimationFrame(function () { fit(); render(); });
    raf = requestAnimationFrame(loop);

    return {
      el: fig,
      video: video,
      play: play,
      pause: pause,
      toggle: toggle,
      seek: function (to) { seek(to); if (!started) { started = true; poster.classList.add('is-gone'); } },
      time: function () { return t; },
      playing: function () { return playing; },
      rate: function () { return rate; },
      destroy: function () {
        destroyed = true;
        cancelAnimationFrame(raf);
        if (observer) observer.disconnect();
        else window.removeEventListener('resize', fit);
        document.removeEventListener('visibilitychange', onVisibility);
      }
    };
  }

  root.LearnPlayer = { create: create };
}(typeof self !== 'undefined' ? self : this));
