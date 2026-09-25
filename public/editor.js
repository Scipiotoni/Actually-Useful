/**
 * MiniEditor — a dependency-free code editor.
 *
 * A transparent <textarea> sits on top of a syntax-highlighted <pre> that
 * mirrors its content, so the browser keeps native editing, selection, undo
 * and IME behaviour while we only paint the colours. A third layer behind
 * both paints search hits and the active line.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MiniEditor = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** The offset each line starts at. One pass, no per-line allocation. */
  function lineStarts(text) {
    var starts = [0];
    var at = text.indexOf('\n');
    while (at !== -1) {
      starts.push(at + 1);
      at = text.indexOf('\n', at + 1);
    }
    return starts;
  }

  /** Counts newlines without splitting, which would allocate a string per line. */
  function countNewlines(text, upto) {
    var end = upto === undefined ? text.length : upto;
    var total = 0;
    var at = text.indexOf('\n');
    while (at !== -1 && at < end) {
      total += 1;
      at = text.indexOf('\n', at + 1);
    }
    return total;
  }

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

  // C and C++. Ordered so a quote opening before a // wins, and so a digit
  // separator like 1'000'000 is eaten by the number rule rather than opening
  // a character literal.
  var CPP_RULES = [
    { cls: 'comment', re: '//[^\\n]*|/\\*[\\s\\S]*?\\*/' },
    { cls: 'meta', re: '#\\s*include\\s*(?:<[^>\\n]*>|"[^"\\n]*")' },
    { cls: 'keyword', re: '#\\s*[a-zA-Z_]+' },
    { cls: 'string', re: 'R"\\([\\s\\S]*?\\)"|' + STRING },
    { cls: 'number', re: '\\b(?:0[xX][0-9a-fA-F\']+|0[bB][01\']+|\\d[\\d\']*(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)(?:[uUlLfF]+)?' },
    { cls: 'string', re: '\'(?:\\\\.|[^\'\\\\\\n])\'' },
    { cls: 'keyword', re: '\\b(?:alignas|alignof|and|asm|break|case|catch|class|concept|const|consteval|constexpr|constinit|const_cast|continue|co_await|co_return|co_yield|decltype|default|delete|do|dynamic_cast|else|enum|explicit|export|extern|for|friend|goto|if|inline|mutable|namespace|new|noexcept|not|operator|or|private|protected|public|register|reinterpret_cast|requires|return|sizeof|static|static_assert|static_cast|struct|switch|template|this|thread_local|throw|try|typedef|typeid|typename|union|using|virtual|volatile|while|xor)\\b' },
    { cls: 'type', re: '\\b(?:auto|bool|char|char8_t|char16_t|char32_t|double|float|int|long|short|signed|unsigned|void|wchar_t|size_t|ptrdiff_t|u?int(?:8|16|32|64)_t|std|string|string_view|vector|array|map|unordered_map|set|pair|tuple|optional|unique_ptr|shared_ptr|span)\\b' },
    { cls: 'atom', re: '\\b(?:true|false|nullptr|NULL|this_thread)\\b' },
    { cls: 'fn', re: '\\b[A-Za-z_][A-Za-z0-9_]*(?=\\s*\\()' }
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
    // .txt and .md carry no syntax to colour.
    text: function (src) { return esc(src); },
    cpp: function (src) { return scan(src, CPP_RULES); },
    html: highlightHtml,
    css: function (src) { return scan(src, CSS_RULES); },
    js: function (src) { return scan(src, JS_RULES); }
  };

  // How each language spells a comment.
  var COMMENTS = {
    html: { block: ['<!--', '-->'] },
    css: { block: ['/*', '*/'] },
    js: { line: '//' },
    cpp: { line: '//' }
  };

  // Colouring costs time proportional to the whole document, on every
  // keystroke. Past this size that cost is felt as lag, so the text is painted
  // plain instead — it stays fully editable, it just stops being coloured.
  var COLOUR_LIMIT = 80 * 1024;
  var MARK_LIMIT = 2000;
  // Lines drawn above and below the viewport, so a small scroll needs no repaint.
  var OVERSCAN = 40;

  // Elements that never take a closing tag.
  var VOID_TAGS = /^(?:area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/i;
  // An opening tag that runs right up to the caret, quotes included so an
  // attribute value containing ">" does not end it early.
  var OPEN_AT_CARET = /<([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^<>"'])*)$/;
  var TAG_SCAN = /<(\/?)([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^<>"'])*)>/g;

  var PAIRS = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'", '`': '`' };
  var CLOSERS = ')]}"\'`';
  var INDENT = '  ';


  /**
   * Pure text operations. Each takes the document and a selection and returns
   * a minimal edit — {from, to, insert, selStart, selEnd} — or null when there
   * is nothing to do. Keeping them free of the DOM makes the edge cases (empty
   * lines, the last line, no trailing newline) testable on their own.
   */
  var Edits = {
    /** The offsets of the whole lines a selection touches. */
    lineSpan: function (text, start, end) {
      var from = text.lastIndexOf('\n', start - 1) + 1;
      var to = text.indexOf('\n', end);
      if (to === -1) to = text.length;
      // A selection ending exactly at a line start should not drag in the next line.
      if (end > start && end === text.lastIndexOf('\n', end - 1) + 1) to = end - 1;
      return { from: from, to: to, text: text.slice(from, to) };
    },

    indent: function (text, start, end, outward) {
      var span = Edits.lineSpan(text, start, end);
      var shifted = outward
        ? span.text.replace(/^ {1,2}/gm, '')
        : span.text.replace(/^/gm, INDENT);
      if (shifted === span.text) return null;

      var firstLine = span.text.slice(0, (span.text + '\n').indexOf('\n'));
      var firstDelta = outward
        ? -(firstLine.length - firstLine.replace(/^ {1,2}/, '').length)
        : INDENT.length;

      return {
        from: span.from,
        to: span.to,
        insert: shifted,
        selStart: Math.max(span.from, start + firstDelta),
        selEnd: Math.max(span.from, end + (shifted.length - span.text.length))
      };
    },

    toggleComment: function (text, start, end, mode) {
      var span = Edits.lineSpan(text, start, end);
      var style = COMMENTS[mode];
      var body = span.text;
      var next;

      if (style.line) {
        var lines = body.split('\n');
        var allCommented = lines.every(function (line) {
          return !line.trim() || line.trimStart().indexOf(style.line) === 0;
        });
        next = lines.map(function (line) {
          if (!line.trim()) return line;
          if (allCommented) return line.replace(new RegExp('^(\\s*)' + style.line + ' ?'), '$1');
          return line.replace(/^(\s*)/, '$1' + style.line + ' ');
        }).join('\n');
      } else {
        var open = style.block[0];
        var close = style.block[1];
        var trimmed = body.trim();
        if (trimmed.indexOf(open) === 0 && trimmed.slice(-close.length) === close) {
          next = body
            .replace(open + ' ', '')
            .replace(open, '')
            .replace(new RegExp(' ' + close.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&') + '$'), '')
            .replace(new RegExp(close.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&') + '$'), '');
        } else {
          next = open + ' ' + body + ' ' + close;
        }
      }

      if (next === body) return null;
      return { from: span.from, to: span.to, insert: next, selStart: span.from, selEnd: span.from + next.length };
    },

    moveLines: function (text, start, end, down) {
      var span = Edits.lineSpan(text, start, end);

      if (down) {
        if (span.to >= text.length) return null;
        var nextEnd = text.indexOf('\n', span.to + 1);
        if (nextEnd === -1) nextEnd = text.length;
        var below = text.slice(span.to + 1, nextEnd);
        var shift = below.length + 1;
        return {
          from: span.from,
          to: nextEnd,
          insert: below + '\n' + span.text,
          selStart: start + shift,
          selEnd: end + shift
        };
      }

      if (span.from === 0) return null;
      var prevStart = text.lastIndexOf('\n', span.from - 2) + 1;
      var above = text.slice(prevStart, span.from - 1);
      var back = above.length + 1;
      return {
        from: prevStart,
        to: span.to,
        insert: span.text + '\n' + above,
        selStart: start - back,
        selEnd: end - back
      };
    },

    duplicate: function (text, start, end) {
      if (start !== end) {
        var picked = text.slice(start, end);
        return { from: end, to: end, insert: picked, selStart: end, selEnd: end + picked.length };
      }
      var span = Edits.lineSpan(text, start, end);
      var moved = start + span.text.length + 1;
      return { from: span.to, to: span.to, insert: '\n' + span.text, selStart: moved, selEnd: moved };
    },

    deleteLines: function (text, start, end) {
      var span = Edits.lineSpan(text, start, end);
      var from = span.from;
      var to = span.to;
      // Take the newline after the block, or — on the last line, which has
      // none — the one before it, so no blank line is left behind.
      if (to < text.length) to += 1;
      else if (from > 0) from -= 1;
      if (from === to) return null;
      return { from: from, to: to, insert: '', selStart: from, selEnd: from };
    },

    /**
     * The closing tag to write when ">" is typed, or null when the tag needs
     * none — a void element, one already closed with "/>", or no tag at all.
     * @returns {{insert: string, caret: number}|null}
     */
    closeTagOn: function (text, offset) {
      var match = text.slice(0, offset).match(OPEN_AT_CARET);
      if (!match) return null;
      if (/\/\s*$/.test(match[2])) return null;
      if (VOID_TAGS.test(match[1])) return null;
      // The ">" the user typed, then the closing tag; the caret sits between.
      return { insert: '></' + match[1] + '>', caret: 1 };
    },

    /** The tag still open at this point, for completing a typed "</". */
    openTagAt: function (text) {
      var stack = [];
      var match;
      TAG_SCAN.lastIndex = 0;
      while ((match = TAG_SCAN.exec(text)) !== null) {
        var name = match[2];
        if (VOID_TAGS.test(name) || /\/\s*$/.test(match[3])) continue;

        if (match[1] === '/') {
          for (var i = stack.length - 1; i >= 0; i -= 1) {
            if (stack[i].toLowerCase() === name.toLowerCase()) {
              stack.length = i;
              break;
            }
          }
        } else {
          stack.push(name);
        }
      }
      return stack.length ? stack[stack.length - 1] : null;
    },

    /**
     * Whether typing `key` should step over the character already there
     * instead of adding a second one.
     */
    skipsOver: function (text, offset, key) {
      return CLOSERS.indexOf(key) >= 0 && text.charAt(offset) === key;
    },

    /** What to write when "/" is typed straight after a "<". */
    completeClosingTag: function (text, offset) {
      if (text.charAt(offset - 1) !== '<') return null;
      var open = Edits.openTagAt(text.slice(0, offset - 1));
      return open ? { insert: '/' + open + '>' } : null;
    },

    findMatches: function (text, query, caseSensitive) {
      var found = [];
      if (!query) return found;
      var haystack = caseSensitive ? text : text.toLowerCase();
      var needle = caseSensitive ? query : query.toLowerCase();
      var at = haystack.indexOf(needle);
      while (at !== -1) {
        found.push({ start: at, end: at + needle.length });
        at = haystack.indexOf(needle, at + Math.max(1, needle.length));
      }
      return found;
    }
  };

  function MiniEditor(host, options) {
    options = options || {};
    this.mode = options.mode || 'html';
    this.onChange = options.onChange || function () {};
    this.onCaret = options.onCaret || function () {};
    this.onColouring = options.onColouring || function () {};
    this.plain = false;

    host.classList.add('ed');
    host.innerHTML =
      '<div class="ed-gutter" aria-hidden="true"><div class="ed-nums"></div></div>' +
      '<div class="ed-body">' +
      '<div class="ed-layer">' +
      '<div class="ed-active" aria-hidden="true"></div>' +
      '<pre class="ed-marks" aria-hidden="true"></pre>' +
      '<pre class="ed-paint" aria-hidden="true"></pre>' +
      '<textarea class="ed-input" spellcheck="false" autocapitalize="off" autocorrect="off" wrap="off"></textarea>' +
      '</div>' +
      '</div>';

    this.host = host;
    this.gutter = host.querySelector('.ed-gutter');
    this.nums = host.querySelector('.ed-nums');
    this.body = host.querySelector('.ed-body');
    this.layer = host.querySelector('.ed-layer');
    this.activeLine = host.querySelector('.ed-active');
    this.marks = host.querySelector('.ed-marks');
    this.paint = host.querySelector('.ed-paint');
    this.input = host.querySelector('.ed-input');
    if (options.ariaLabel) this.input.setAttribute('aria-label', options.ariaLabel);

    this.matches = [];
    this.matchIndex = -1;

    var self = this;
    var caret = function () { self._syncCaret(); };
    this.input.addEventListener('input', function (e) {
      // Phones and some keyboards "smarten" quotes and dashes as you type,
      // which breaks code: put back what was actually typed.
      if (e && /^insert/.test(e.inputType || '')) {
        var fixed = MiniEditor.unsmart(self.input.value, self.input.selectionStart);
        if (fixed) {
          self.input.value = fixed.value;
          self.input.selectionStart = self.input.selectionEnd = fixed.cursor;
        }
      }
      self._sync();
      self.onChange();
    });
    this.input.addEventListener('keydown', function (e) { self._onKey(e); });
    this.input.addEventListener('keyup', caret);
    this.input.addEventListener('click', caret);
    this.input.addEventListener('select', caret);
    this.input.addEventListener('focus', caret);
    this.body.addEventListener('scroll', function () {
      self._syncScroll();
      if (self.plain) self._schedulePaint();
    });

    this.setValue(options.value || '');
  }

  // ---------------------------------------------------------------- basics

  MiniEditor.prototype.getValue = function () { return this.input.value; };

  MiniEditor.prototype.setValue = function (value) {
    this.input.value = value;
    this._sync();
    // Switching files should show the new contents at once, not next frame.
    this._paintQueued = false;
    this._paintNow();
  };

  MiniEditor.prototype.focus = function () { this.input.focus(); };

  /** Switches the language the painter and the comment command use. */
  MiniEditor.prototype.setMode = function (mode) {
    if (!MODES[mode] || mode === this.mode) return;
    this.mode = mode;
    this._sync();
  };

  MiniEditor.prototype.refresh = function () {
    this._cachedMetrics = null;
    this._syncScroll();
    this._schedulePaint();
  };

  /** Wrapping and the line-number gutter cannot both be right; pick one. */
  MiniEditor.prototype.setWrap = function (on) {
    this.wrapped = Boolean(on);
    this.host.classList.toggle('is-wrapped', this.wrapped);
    this.input.setAttribute('wrap', this.wrapped ? 'soft' : 'off');
    this._sync();
  };

  MiniEditor.prototype._sync = function () {
    var value = this.input.value;
    var lines = countNewlines(value) + 1;
    if (this._lineCount !== lines) {
      this._lineCount = lines;
      var buf = new Array(lines);
      for (var i = 0; i < lines; i += 1) buf[i] = i + 1;
      this.nums.textContent = buf.join('\n');
    }
    this._schedulePaint();
    this._syncCaret();
  };

  /**
   * Repainting is the expensive half, so it happens once per frame however
   * many keystrokes arrive in between. Typing is never blocked waiting for it.
   */
  MiniEditor.prototype._schedulePaint = function () {
    if (this._paintQueued) return;
    this._paintQueued = true;

    var self = this;
    var run = function () {
      self._paintQueued = false;
      self._paintNow();
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    else setTimeout(run, 16);
  };

  MiniEditor.prototype._paintNow = function () {
    var value = this.input.value;
    var plain = value.length > COLOUR_LIMIT;

    if (plain !== this.plain) {
      this.plain = plain;
      this.host.classList.toggle('is-plain', plain);
      if (!plain) this._unwindow();
      this.onColouring(!plain);
    }

    if (plain) this._paintWindow(value);
    else this.paint.innerHTML = MODES[this.mode](value) + '\n';

    this._paintMarks();
  };

  /**
   * For a document too large to colour, only the lines on screen are drawn.
   * The layer is still given the full size, so scrolling, the caret and the
   * line numbers all stay where they belong — there is simply nothing painted
   * where nobody is looking.
   */
  MiniEditor.prototype._paintWindow = function (value) {
    var m = this._metrics();
    var starts = lineStarts(value);
    var total = starts.length;

    var first = Math.max(0, Math.floor(this.body.scrollTop / m.lineHeight) - OVERSCAN);
    var visible = Math.ceil(this.body.clientHeight / m.lineHeight) + OVERSCAN * 2;
    var last = Math.min(total, first + visible);

    this._window = { first: first, last: last, starts: starts };

    var from = starts[first];
    var to = last < total ? starts[last] - 1 : value.length;

    // Sizing the layer by the longest line keeps horizontal scrolling honest
    // without asking the browser to measure every line.
    var widest = 0;
    for (var i = 0; i < total; i += 1) {
      var end = i + 1 < total ? starts[i + 1] - 1 : value.length;
      if (end - starts[i] > widest) widest = end - starts[i];
    }

    this.layer.style.height = (m.padTop * 2 + total * m.lineHeight) + 'px';
    this.layer.style.width = (m.padLeft * 2 + widest * m.charWidth) + 'px';
    this.paint.style.transform = 'translateY(' + (first * m.lineHeight) + 'px)';
    this.paint.textContent = value.slice(from, to) + '\n';
  };

  /** Puts the layer back under the stylesheet's control. */
  MiniEditor.prototype._unwindow = function () {
    this._window = null;
    this.layer.style.height = '';
    this.layer.style.width = '';
    this.paint.style.transform = '';
    this.marks.style.transform = '';
  };

  MiniEditor.prototype._syncScroll = function () {
    this.nums.style.transform = 'translateY(' + -this.body.scrollTop + 'px)';
  };

  MiniEditor.prototype._metrics = function () {
    if (!this._cachedMetrics) {
      var style = getComputedStyle(this.paint);
      var ruler = document.createElement('span');
      ruler.textContent = new Array(101).join('x');
      ruler.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;' +
        'font-family:' + style.fontFamily + ';font-size:' + style.fontSize;
      this.paint.appendChild(ruler);
      var charWidth = ruler.getBoundingClientRect().width / 100;
      this.paint.removeChild(ruler);

      this._cachedMetrics = {
        lineHeight: parseFloat(style.lineHeight) || 20,
        padTop: parseFloat(style.paddingTop) || 0,
        padLeft: parseFloat(style.paddingLeft) || 0,
        charWidth: charWidth || 8
      };
    }
    return this._cachedMetrics;
  };

  /** Position of a character offset, as a 1-based line and column. */
  MiniEditor.prototype.positionAt = function (offset) {
    var value = this.input.value;
    var lineStart = value.lastIndexOf('\n', offset - 1) + 1;
    return { line: countNewlines(value, offset) + 1, column: offset - lineStart + 1 };
  };

  MiniEditor.prototype._syncCaret = function () {
    var at = this.positionAt(this.input.selectionStart);
    if (!this.wrapped) {
      var m = this._metrics();
      this.activeLine.style.transform = 'translateY(' + (m.padTop + (at.line - 1) * m.lineHeight) + 'px)';
      this.activeLine.style.height = m.lineHeight + 'px';
    }
    this.onCaret(at);
  };

  // ------------------------------------------------------------- selection

  MiniEditor.prototype.getSelection = function () {
    return { start: this.input.selectionStart, end: this.input.selectionEnd };
  };

  MiniEditor.prototype.select = function (start, end) {
    this.input.focus();
    this.input.setSelectionRange(start, end === undefined ? start : end);
    this.reveal(start);
    this._syncCaret();
  };

  /** Scrolls an offset into view with a little room around it. */
  MiniEditor.prototype.reveal = function (offset) {
    if (this.wrapped) return;
    var m = this._metrics();
    var line = this.positionAt(offset).line - 1;
    var top = m.padTop + line * m.lineHeight;
    var viewTop = this.body.scrollTop;
    var viewBottom = viewTop + this.body.clientHeight;
    if (top < viewTop + m.lineHeight) {
      this.body.scrollTop = Math.max(0, top - m.lineHeight * 3);
    } else if (top + m.lineHeight > viewBottom - m.lineHeight) {
      this.body.scrollTop = top - this.body.clientHeight + m.lineHeight * 4;
    }
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

  MiniEditor.prototype.insertAtCursor = function (text) {
    this.input.focus();
    this._insert(text);
  };

  /** Replaces an explicit range, leaving the caret after the new text. */
  MiniEditor.prototype.replaceRange = function (start, end, text) {
    this.input.focus();
    this.input.setSelectionRange(start, end);
    this._insert(text);
    this.input.setSelectionRange(start + text.length, start + text.length);
    this._syncCaret();
  };

  // -------------------------------------------------------- line utilities

  MiniEditor.prototype.lineSpan = function () {
    var span = Edits.lineSpan(this.input.value, this.input.selectionStart, this.input.selectionEnd);
    return { start: span.from, end: span.to, text: span.text };
  };

  /** Applies one of the edits above, keeping the native undo stack. */
  MiniEditor.prototype._apply = function (edit) {
    if (!edit) return;
    this.input.focus();
    this.input.setSelectionRange(edit.from, edit.to);
    this._insert(edit.insert);
    this.input.setSelectionRange(edit.selStart, edit.selEnd);
    this._syncCaret();
  };

  /** Tab and Shift+Tab over one or many lines. */
  MiniEditor.prototype.indent = function (outward) {
    this._apply(Edits.indent(this.input.value, this.input.selectionStart, this.input.selectionEnd, outward));
  };

  /** Comments or uncomments the touched lines, in this pane's language. */
  MiniEditor.prototype.toggleComment = function () {
    this._apply(Edits.toggleComment(this.input.value, this.input.selectionStart, this.input.selectionEnd, this.mode));
  };

  /** Moves the touched lines up or down by one. */
  MiniEditor.prototype.moveLines = function (down) {
    this._apply(Edits.moveLines(this.input.value, this.input.selectionStart, this.input.selectionEnd, down));
  };

  /** Duplicates the selection, or the whole line when nothing is selected. */
  MiniEditor.prototype.duplicate = function () {
    this._apply(Edits.duplicate(this.input.value, this.input.selectionStart, this.input.selectionEnd));
  };

  MiniEditor.prototype.deleteLines = function () {
    this._apply(Edits.deleteLines(this.input.value, this.input.selectionStart, this.input.selectionEnd));
  };

  MiniEditor.prototype.gotoLine = function (number) {
    var value = this.input.value;
    var total = countNewlines(value) + 1;
    var index = Math.min(Math.max(1, number), total) - 1;

    var start = 0;
    for (var i = 0; i < index; i += 1) start = value.indexOf('\n', start) + 1;
    var end = value.indexOf('\n', start);
    this.select(start, end === -1 ? value.length : end);
  };

  /** Home goes to the first non-blank character before the line start. */
  MiniEditor.prototype.smartHome = function (extend) {
    var value = this.input.value;
    var caret = this.input.selectionStart;
    var lineStart = value.lastIndexOf('\n', caret - 1) + 1;
    var firstText = lineStart + (value.slice(lineStart).match(/^[ \t]*/) || [''])[0].length;
    var target = caret === firstText ? lineStart : firstText;
    if (extend) this.input.setSelectionRange(Math.min(target, this.input.selectionEnd), Math.max(target, this.input.selectionEnd));
    else this.input.setSelectionRange(target, target);
    this._syncCaret();
  };

  // ----------------------------------------------------------------- find

  /**
   * Finds every occurrence of `query` and paints them.
   * @returns {number} how many were found
   */
  MiniEditor.prototype.findAll = function (query, options) {
    options = options || {};
    this.matches = [];
    this.matchIndex = -1;

    this.matches = Edits.findMatches(this.input.value, query, options.caseSensitive);
    this._paintMarks();
    return this.matches.length;
  };

  /** Moves to the next (or previous) hit, wrapping around the ends. */
  MiniEditor.prototype.stepMatch = function (backwards, fromOffset) {
    if (!this.matches.length) return -1;
    // Step off the current hit: forward from where it ends, back from where
    // it starts, or the search keeps landing on the same one.
    var from = fromOffset;
    if (from === undefined) {
      from = backwards ? this.input.selectionStart : this.input.selectionEnd;
    }
    var index;

    if (backwards) {
      index = -1;
      for (var i = this.matches.length - 1; i >= 0; i -= 1) {
        if (this.matches[i].start < from) { index = i; break; }
      }
      if (index === -1) index = this.matches.length - 1;
    } else {
      index = this.matches.findIndex(function (match) { return match.start >= from; });
      if (index === -1) index = 0;
    }

    this.matchIndex = index;
    var match = this.matches[index];
    this.select(match.start, match.end);
    this._paintMarks();
    return index;
  };

  MiniEditor.prototype.clearFind = function () {
    this.matches = [];
    this.matchIndex = -1;
    this._paintMarks();
  };

  MiniEditor.prototype._paintMarks = function () {
    if (!this.matches.length) {
      this.marks.innerHTML = '';
      return;
    }
    var value = this.input.value;
    var out = '';
    var last = 0;
    var self = this;
    // Painting thousands of hits costs more than it helps; the current one is
    // still shown, and the count still reports the true total.
    var shown = this.matches.length > MARK_LIMIT
      ? this.matches.slice(Math.max(0, this.matchIndex), Math.max(0, this.matchIndex) + 1)
      : this.matches;
    shown.forEach(function (match, i) {
      out += esc(value.slice(last, match.start));
      var current = shown === self.matches ? i === self.matchIndex : true;
      out += '<mark class="' + (current ? 'on' : '') + '">' +
        esc(value.slice(match.start, match.end)) + '</mark>';
      last = match.end;
    });
    if (this.plain && this._window) {
      // Drawn in the same window as the text, or it would sit at the wrong height.
      var m = this._metrics();
      var w = this._window;
      var from = w.starts[w.first];
      var to = w.last < w.starts.length ? w.starts[w.last] - 1 : value.length;
      this.marks.style.transform = 'translateY(' + (w.first * m.lineHeight) + 'px)';
      this.marks.innerHTML = this._marksWithin(value, from, to);
      return;
    }
    this.marks.style.transform = '';
    this.marks.innerHTML = out + esc(value.slice(last)) + '\n';
  };

  /** The mark layer for one slice of the document. */
  MiniEditor.prototype._marksWithin = function (value, from, to) {
    var out = '';
    var last = from;
    var self = this;
    this.matches.forEach(function (match, i) {
      if (match.end <= from || match.start >= to) return;
      out += esc(value.slice(last, match.start));
      out += '<mark class="' + (i === self.matchIndex ? 'on' : '') + '">' +
        esc(value.slice(match.start, match.end)) + '</mark>';
      last = match.end;
    });
    return out + esc(value.slice(last, to)) + '\n';
  };

  // ------------------------------------------------------------------ keys

  MiniEditor.prototype._onKey = function (event) {
    var el = this.input;
    var value = el.value;
    var start = el.selectionStart;
    var end = el.selectionEnd;
    var mod = event.ctrlKey || event.metaKey;

    if (event.key === 'Tab') {
      event.preventDefault();
      if (start !== end || event.shiftKey) return void this.indent(event.shiftKey);
      return void this._insert(INDENT);
    }

    if (mod && !event.shiftKey && !event.altKey && (event.key === '/' || event.code === 'Slash')) {
      event.preventDefault();
      return void this.toggleComment();
    }

    if (event.altKey && !mod && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault();
      return void this.moveLines(event.key === 'ArrowDown');
    }

    if (mod && !event.shiftKey && event.key.toLowerCase() === 'd') {
      event.preventDefault();
      return void this.duplicate();
    }

    if (mod && event.shiftKey && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      return void this.deleteLines();
    }

    if (event.key === 'Home' && !mod) {
      event.preventDefault();
      return void this.smartHome(event.shiftKey);
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

    // Tag completion only makes sense in markup.
    if (this.mode === 'html' && !mod && !event.altKey && start === end) {
      if (event.key === '>') {
        var closing = Edits.closeTagOn(value, start);
        if (closing) {
          event.preventDefault();
          return void this._insert(closing.insert, closing.caret);
        }
      }
      if (event.key === '/') {
        var completed = Edits.completeClosingTag(value, start);
        if (completed) {
          event.preventDefault();
          return void this._insert(completed.insert);
        }
      }
    }

    // Typing the closer that is already sitting there steps over it. This has
    // to come before the pairing below: ")" and "]" are not keys in PAIRS, so
    // inside that branch they were unreachable and got typed twice.
    if (!mod && !event.altKey && start === end && Edits.skipsOver(value, start, event.key)) {
      event.preventDefault();
      el.selectionStart = el.selectionEnd = start + 1;
      this._syncCaret();
      return;
    }

    if (PAIRS[event.key] && !mod && !event.altKey) {
      var nextChar = value[end] || '';
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

  /**
   * Undoes keyboard "smart punctuation" in the few characters just typed
   * (before the cursor): curly quotes become ' and ", an em dash made from
   * -- goes back to --, and an en dash to -. Returns null if nothing changed.
   */
  var SMART = { '\u2018': "'", '\u2019': "'", '\u201A': "'", '\u201B': "'", '\u201C': '"', '\u201D': '"', '\u201E': '"', '\u201F': '"', '\u2014': '--', '\u2013': '-' };
  MiniEditor.unsmart = function (value, cursor) {
    var from = Math.max(0, cursor - 3);
    var recent = value.slice(from, cursor);
    if (!/[\u2018-\u201F\u2013\u2014]/.test(recent)) return null;
    var plain = recent.replace(/[\u2018-\u201F\u2013\u2014]/g, function (c) { return SMART[c] || c; });
    return { value: value.slice(0, from) + plain + value.slice(cursor), cursor: from + plain.length };
  };

  MiniEditor.highlight = function (mode, src) { return MODES[mode](src); };
  MiniEditor.COMMENTS = COMMENTS;
  MiniEditor.edits = Edits;
  MiniEditor.COLOUR_LIMIT = COLOUR_LIMIT;
  MiniEditor.text = { countNewlines: countNewlines, lineStarts: lineStarts };
  return MiniEditor;
});
