/**
 * MiniEditor — a dependency-free code editor.
 *
 * A transparent <textarea> sits on top of a syntax-highlighted <pre> that
 * mirrors its content, so the browser keeps native editing, selection, undo
 * and IME behaviour while we only paint the colours.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MiniEditor = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  /**
   * Runs an ordered rule set over `src`. Each rule's pattern must use only
   * non-capturing groups; alternation is leftmost-first, so a quote opening
   * before a `//` correctly wins over the comment rule.
   */
  function scan(src, rules) {
    var master = new RegExp(rules.map(function (r) { return '(' + r.re + ')'; }).join('|'), 'g');
    var out = '';
    var last = 0;
    var m;
    while ((m = master.exec(src)) !== null) {
      if (m[0] === '') { master.lastIndex += 1; continue; }
      if (m.index > last) out += esc(src.slice(last, m.index));
      var rule = null;
      for (var i = 1; i < m.length; i += 1) {
        if (m[i] !== undefined) { rule = rules[i - 1]; break; }
      }
      out += rule && rule.render ? rule.render(m[0]) : '<span class="t-' + (rule ? rule.cls : 'txt') + '">' + esc(m[0]) + '</span>';
      last = m.index + m[0].length;
    }
    return out + esc(src.slice(last));
  }

  var STRING = '"(?:\\\\.|[^"\\\\\\n])*"|\'(?:\\\\.|[^\'\\\\\\n])*\'';

  var JS_RULES = [
    { cls: 'comment', re: '//[^\\n]*|/\\*[\\s\\S]*?\\*/' },
    { cls: 'string', re: STRING + '|`(?:\\\\.|[^`\\\\])*`' },
    { cls: 'keyword', re: '\\b(?:var|let|const|function|return|if|else|for|while|do|switch|case|break|continue|new|this|typeof|instanceof|in|of|class|extends|super|try|catch|finally|throw|async|await|yield|delete|void|import|export|from|default)\\b' },
    { cls: 'atom', re: '\\b(?:true|false|null|undefined|NaN|Infinity)\\b' },
    { cls: 'number', re: '\\b(?:0[xXbBoO][\\da-fA-F]+|\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)\\b' },
    { cls: 'fn', re: '\\b[A-Za-z_$][\\w$]*(?=\\s*\\()' }
  ];

  var CSS_RULES = [
    { cls: 'comment', re: '/\\*[\\s\\S]*?\\*/' },
    { cls: 'string', re: STRING },
    { cls: 'keyword', re: '@[\\w-]+' },
    { cls: 'number', re: '#[0-9a-fA-F]{3,8}\\b|\\b\\d+(?:\\.\\d+)?(?:px|em|rem|%|vh|vw|vmin|vmax|deg|ms|s|fr|ch|pt|ex)?\\b' },
    { cls: 'prop', re: '[-a-zA-Z]+(?=\\s*:)' },
    { cls: 'fn', re: '\\b[a-zA-Z-]+(?=\\()' }
  ];

  /** Colourises one `<tag ...>` token, attributes and all. */
  function renderTag(raw) {
    var rules = [
      { cls: 'string', re: STRING },
      { cls: 'attr', re: '[a-zA-Z_:][-\\w:.]*(?=\\s*=)' },
      { cls: 'tag', re: '^</?[a-zA-Z][-\\w:.]*|/?>$' },
      { cls: 'punct', re: '=' }
    ];
    return '<span class="t-tagwrap">' + scan(raw, rules) + '</span>';
  }

  var HTML_RULES = [
    { cls: 'comment', re: '<!--[\\s\\S]*?-->' },
    { cls: 'meta', re: '<!(?:doctype|DOCTYPE)[^>]*>' },
    { cls: 'tag', re: '</?[a-zA-Z][-\\w:.]*(?:\\s+(?:"[^"]*"|\'[^\']*\'|[^>"\'])*)?/?>', render: renderTag }
  ];

  // <script>/<style> bodies are handed to the JS/CSS rule sets.
  var EMBED_RE = /(<(script|style)\b[^>]*>)([\s\S]*?)(<\/\2\s*>)/gi;

  function highlightHtml(src) {
    var out = '';
    var last = 0;
    var m;
    EMBED_RE.lastIndex = 0;
    while ((m = EMBED_RE.exec(src)) !== null) {
      out += scan(src.slice(last, m.index), HTML_RULES);
      out += scan(m[1], HTML_RULES);
      out += scan(m[3], m[2].toLowerCase() === 'script' ? JS_RULES : CSS_RULES);
      out += scan(m[4], HTML_RULES);
      last = m.index + m[0].length;
    }
    return out + scan(src.slice(last), HTML_RULES);
  }

  var MODES = {
    html: highlightHtml,
    css: function (src) { return scan(src, CSS_RULES); },
    js: function (src) { return scan(src, JS_RULES); }
  };

  var PAIRS = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'", '`': '`' };
  var CLOSERS = ')]}"\'`';
  var INDENT = '  ';

  function MiniEditor(host, options) {
    options = options || {};
    this.mode = options.mode || 'html';
    this.onChange = options.onChange || function () {};

    host.classList.add('ed');
    host.innerHTML =
      '<div class="ed-gutter" aria-hidden="true"><div class="ed-nums"></div></div>' +
      '<div class="ed-body">' +
      '<pre class="ed-paint" aria-hidden="true"></pre>' +
      '<textarea class="ed-input" spellcheck="false" autocapitalize="off" autocorrect="off" wrap="off"></textarea>' +
      '</div>';

    this.host = host;
    this.gutter = host.querySelector('.ed-gutter');
    this.nums = host.querySelector('.ed-nums');
    this.body = host.querySelector('.ed-body');
    this.paint = host.querySelector('.ed-paint');
    this.input = host.querySelector('.ed-input');
    if (options.ariaLabel) this.input.setAttribute('aria-label', options.ariaLabel);

    var self = this;
    this.input.addEventListener('input', function () { self._sync(); self.onChange(); });
    this.input.addEventListener('keydown', function (e) { self._onKey(e); });
    this.input.addEventListener('scroll', function () { self._syncScroll(); });
    this.body.addEventListener('scroll', function () { self._syncScroll(); });

    this.setValue(options.value || '');
  }

  MiniEditor.prototype.getValue = function () { return this.input.value; };

  MiniEditor.prototype.setValue = function (value) {
    this.input.value = value;
    this._sync();
  };

  MiniEditor.prototype.focus = function () { this.input.focus(); };

  MiniEditor.prototype.refresh = function () { this._syncScroll(); };

  MiniEditor.prototype._sync = function () {
    var value = this.input.value;
    // The trailing newline needs a character after it or <pre> collapses it.
    this.paint.innerHTML = MODES[this.mode](value) + '\n';
    var lines = value.split('\n').length;
    if (this._lineCount !== lines) {
      this._lineCount = lines;
      var buf = new Array(lines);
      for (var i = 0; i < lines; i += 1) buf[i] = i + 1;
      this.nums.textContent = buf.join('\n');
    }
    // Match the textarea's scrollable box to the painted content.
    this.input.style.height = this.paint.scrollHeight + 'px';
    this.input.style.width = Math.max(this.paint.scrollWidth, this.body.clientWidth) + 'px';
    this._syncScroll();
  };

  MiniEditor.prototype._syncScroll = function () {
    this.nums.style.transform = 'translateY(' + -this.body.scrollTop + 'px)';
  };

  /** Replaces the selection while keeping the browser's native undo stack. */
  MiniEditor.prototype._insert = function (text, selectStart, selectEnd) {
    var el = this.input;
    var start = el.selectionStart;
    var ok = false;
    try { ok = document.execCommand('insertText', false, text); } catch (e) { ok = false; }
    if (!ok) {
      el.setRangeText(text, el.selectionStart, el.selectionEnd, 'end');
    }
    if (selectStart !== undefined) {
      el.selectionStart = start + selectStart;
      el.selectionEnd = start + (selectEnd === undefined ? selectStart : selectEnd);
    }
    this._sync();
    this.onChange();
  };

  MiniEditor.prototype._onKey = function (event) {
    var el = this.input;
    var value = el.value;
    var start = el.selectionStart;
    var end = el.selectionEnd;

    if (event.key === 'Tab') {
      event.preventDefault();
      var lineStart = value.lastIndexOf('\n', start - 1) + 1;
      if (start !== end || event.shiftKey) {
        // Indent or outdent every touched line.
        var block = value.slice(lineStart, end);
        var shifted = event.shiftKey
          ? block.replace(/^ {1,2}/gm, '')
          : block.replace(/^/gm, INDENT);
        el.selectionStart = lineStart;
        el.selectionEnd = end;
        this._insert(shifted);
        el.selectionStart = lineStart;
        el.selectionEnd = lineStart + shifted.length;
        return;
      }
      this._insert(INDENT);
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      var ls = value.lastIndexOf('\n', start - 1) + 1;
      var indent = (value.slice(ls, start).match(/^[ \t]*/) || [''])[0];
      var before = value[start - 1];
      var after = value[start];
      if (before && '{[('.indexOf(before) >= 0) {
        var inner = indent + INDENT;
        if (after && '}])'.indexOf(after) >= 0) {
          this._insert('\n' + inner + '\n' + indent, 1 + inner.length);
        } else {
          this._insert('\n' + inner);
        }
        return;
      }
      if (before === '>' && after === '<' && value.slice(start).charAt(1) === '/') {
        var inner2 = indent + INDENT;
        this._insert('\n' + inner2 + '\n' + indent, 1 + inner2.length);
        return;
      }
      this._insert('\n' + indent);
      return;
    }

    if (PAIRS[event.key] && !event.ctrlKey && !event.metaKey) {
      var nextChar = value[end] || '';
      // Skip over a closer we just typed rather than doubling it.
      if (start === end && event.key === nextChar && CLOSERS.indexOf(event.key) >= 0 && '([{'.indexOf(event.key) < 0) {
        event.preventDefault();
        el.selectionStart = el.selectionEnd = end + 1;
        return;
      }
      if (start === end && /[\w$]/.test(nextChar)) return; // don't auto-close mid-word
      event.preventDefault();
      var selected = value.slice(start, end);
      this._insert(event.key + selected + PAIRS[event.key], 1, 1 + selected.length);
      return;
    }

    if (event.key === 'Backspace' && start === end && start > 0) {
      var prev = value[start - 1];
      if (PAIRS[prev] && value[start] === PAIRS[prev]) {
        event.preventDefault();
        el.selectionStart = start - 1;
        el.selectionEnd = start + 1;
        this._insert('');
      }
    }
  };

  MiniEditor.highlight = function (mode, src) { return MODES[mode](src); };
  return MiniEditor;
});
