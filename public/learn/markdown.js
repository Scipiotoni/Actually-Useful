/*
 * A small, safe Markdown renderer for lessons. All text is escaped first, so
 * nothing in a lesson can inject HTML.
 *
 * Blocks: # headings, paragraphs, - and 1. lists (nested by indent), tables,
 * ```fenced code```, --- rules, > quotes and > [!tip] callouts, and
 * {{check id}} / {{task id}} slots that the app turns into live widgets.
 * Inline: `code`, **bold**, *italic*, [links](https://…) and [[Ctrl+Enter]] keys.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LearnMarkdown = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  var CALLOUTS = {
    tip: 'Tip',
    note: 'Note',
    warning: 'Watch out',
    mistake: 'Common mistake',
    remember: 'Remember',
    deep: 'Going deeper',
    try: 'Try it',
    why: 'Why?',
    analogy: 'Think of it like this',
    pro: 'Pro habit'
  };

  function safeHref(href) {
    var h = String(href).trim();
    if (/^https?:\/\//i.test(h) || /^#\//.test(h) || /^mailto:/i.test(h)) return h;
    return null;
  }

  /** Inline formatting on one already-unescaped string. */
  function inline(src) {
    var codes = [];
    // Code spans first, so nothing inside them is formatted.
    var s = String(src).replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, function (_, ticks, body) {
      codes.push('<code>' + escapeHtml(body.replace(/^ (.*) $/, '$1')) + '</code>');
      return '\u0000' + (codes.length - 1) + '\u0000';
    });
    s = escapeHtml(s);
    s = s.replace(/\[\[([^\]\n]+)\]\]/g, function (_, keys) {
      return keys.split('+').map(function (k) { return '<kbd>' + k.trim() + '</kbd>'; }).join('+');
    });
    s = s.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, function (all, label, href) {
      var raw = href.replace(/&amp;/g, '&');
      var ok = safeHref(raw);
      if (!ok) return label;
      var external = /^https?:/i.test(ok);
      return '<a href="' + escapeHtml(ok) + '"' + (external ? ' target="_blank" rel="noopener"' : '') + '>' + label + '</a>';
    });
    s = s.replace(/\*\*([^*\n]+(?:\*(?!\*)[^*\n]*)*)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^\w*])\*([^*\s][^*\n]*?)\*(?!\w)/g, '$1<em>$2</em>');
    s = s.replace(/(^|[^\w])_([^_\s][^_\n]*?)_(?!\w)/g, '$1<em>$2</em>');
    s = s.replace(/\u0000(\d+)\u0000/g, function (_, i) { return codes[Number(i)]; });
    return s;
  }

  function isTableSep(line) {
    return /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(line) && /-/.test(line);
  }

  function splitRow(line) {
    var s = line.trim().replace(/^\|/, '').replace(/\|$/, '');
    var cells = [];
    var current = '';
    var inCode = false;
    for (var i = 0; i < s.length; i += 1) {
      var c = s.charAt(i);
      if (c === '`') inCode = !inCode;
      if (c === '\\' && s.charAt(i + 1) === '|') { current += '|'; i += 1; continue; }
      if (c === '|' && !inCode) { cells.push(current.trim()); current = ''; continue; }
      current += c;
    }
    cells.push(current.trim());
    return cells;
  }

  /**
   * @param {string} md
   * @param {{code?: Function, slot?: Function}} hooks
   *   code(lang, flags, text, extras) returns HTML for a fenced block;
   *   slot(kind, id) returns HTML for a {{check id}} line.
   */
  function render(md, hooks) {
    hooks = hooks || {};
    var html = parse(md, hooks).html;
    // Numbered top-level blocks let the app point at one part of a lesson.
    if (hooks.number) {
      html = html.map(function (s, n) { return s.replace(/^<([a-z][\w-]*)/i, '<$1 data-b="' + n + '"'); });
    }
    return html.join('\n');
  }

  /**
   * The top-level blocks of a text, in the order (and with the numbers)
   * render(md, {number: true}) gives them: {kind, text, lang?, level?}.
   * kind is p, h, list, code, callout, quote, table, hr or slot; text is the
   * block's markdown.
   */
  function blocks(md) {
    return parse(md, {}).meta;
  }

  function parse(md, hooks) {
    var lines = String(md == null ? '' : md).replace(/\r\n?/g, '\n').split('\n');
    var html = [];
    var meta = [];
    var i = 0;

    function emit(out, kind, text, extra) {
      html.push(out);
      meta.push(Object.assign({ kind: kind, text: text }, extra || {}));
    }

    function para(buf) {
      if (buf.length) emit('<p>' + inline(buf.join(' ')) + '</p>', 'p', buf.join(' '));
    }

    function listAt(start) {
      // Returns [html, nextIndex] for a list starting at lines[start].
      var first = /^(\s*)([-*]|\d+[.)])\s+/.exec(lines[start]);
      var indent = first[1].length;
      var ordered = /\d/.test(first[2]);
      var startNum = ordered ? parseInt(first[2], 10) : 1;
      var items = [];
      var j = start;
      while (j < lines.length) {
        var m = /^(\s*)([-*]|\d+[.)])\s+(.*)$/.exec(lines[j]);
        if (m && m[1].length === indent && /\d/.test(m[2]) !== ordered) break;
        if (m && m[1].length === indent) {
          items.push({ text: [m[3]], sub: '' });
          j += 1;
          continue;
        }
        if (m && m[1].length > indent && items.length) {
          var nested = listAt(j);
          items[items.length - 1].sub += nested[0];
          j = nested[1];
          continue;
        }
        if (!m && /\S/.test(lines[j]) && items.length && /^\s+/.test(lines[j]) &&
            /^(\s*)/.exec(lines[j])[1].length > indent) {
          items[items.length - 1].text.push(lines[j].trim());
          j += 1;
          continue;
        }
        break;
      }
      var tag = ordered ? 'ol' : 'ul';
      var open = ordered && startNum !== 1 ? '<ol start="' + startNum + '">' : '<' + tag + '>';
      var body = items.map(function (it) {
        return '<li>' + inline(it.text.join(' ')) + it.sub + '</li>';
      }).join('');
      return [open + body + '</' + tag + '>', j];
    }

    var buf = [];
    while (i < lines.length) {
      var line = lines[i];

      var fence = /^(\s*)```([\w+-]*)\s*(.*)$/.exec(line);
      if (fence) {
        para(buf); buf = [];
        var lang = fence[2] || '';
        var flags = fence[3].trim().split(/\s+/).filter(Boolean);
        var body = [];
        i += 1;
        while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) { body.push(lines[i]); i += 1; }
        i += 1;
        var code = body.join('\n');
        // An example can be followed by the input it reads and what it prints.
        var extras = {};
        // C++ takes input and output; JavaScript output; an HTML example its
        // CSS, JS and console output.
        var follows = { cpp: /^\s*```(output|stdin)\s*$/, js: /^\s*```(output)\s*$/, html: /^\s*```(css|js|output)\s*$/ }[lang];
        if (follows && flags.indexOf('static') === -1) {
          var k = i;
          while (k < lines.length) {
            while (k < lines.length && /^\s*$/.test(lines[k])) k += 1;
            var next = follows.exec(lines[k] || '');
            if (next && extras[next[1]] !== undefined) break;
            if (!next) break;
            var inner = [];
            k += 1;
            while (k < lines.length && !/^\s*```\s*$/.test(lines[k])) { inner.push(lines[k]); k += 1; }
            k += 1;
            extras[next[1]] = inner.join('\n');
            i = k;
          }
        }
        emit(hooks.code ? hooks.code(lang, flags, code, extras) :
          '<pre><code>' + escapeHtml(code) + '</code></pre>', 'code', code, { lang: lang });
        continue;
      }

      var slot = /^\s*\{\{\s*(check|task)\s+([\w-]+)\s*\}\}\s*$/.exec(line);
      if (slot) {
        para(buf); buf = [];
        emit(hooks.slot ? hooks.slot(slot[1], slot[2]) : '', 'slot', slot[2], { slot: slot[1] });
        i += 1;
        continue;
      }

      if (/^\s*$/.test(line)) { para(buf); buf = []; i += 1; continue; }

      var heading = /^(#{1,4})\s+(.*)$/.exec(line);
      if (heading) {
        para(buf); buf = [];
        var level = Math.min(6, heading[1].length + 1); // # in a lesson is an h2
        var id = heading[2].toLowerCase().replace(/[^\w]+/g, '-').replace(/^-|-$/g, '');
        emit('<h' + level + ' id="h-' + id + '">' + inline(heading[2]) + '</h' + level + '>', 'h', heading[2], { level: level, id: 'h-' + id });
        i += 1;
        continue;
      }

      if (/^\s*(?:---+|\*\*\*+)\s*$/.test(line)) {
        para(buf); buf = [];
        emit('<hr>', 'hr', '');
        i += 1;
        continue;
      }

      if (/^\s*>/.test(line)) {
        para(buf); buf = [];
        var quoted = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) {
          quoted.push(lines[i].replace(/^\s*> ?/, ''));
          i += 1;
        }
        var callout = /^\[!(\w+)\]\s*(.*)$/.exec(quoted[0] || '');
        if (callout && CALLOUTS[callout[1].toLowerCase()]) {
          var kind = callout[1].toLowerCase();
          var title = callout[2] || CALLOUTS[kind];
          emit('<aside class="callout callout-' + kind + '"><div class="callout-title">' +
            inline(title) + '</div>' + parse(quoted.slice(1).join('\n'), hooks).html.join('\n') + '</aside>',
          'callout', quoted.slice(1).join('\n'), { callout: kind, title: title });
        } else {
          emit('<blockquote>' + parse(quoted.join('\n'), hooks).html.join('\n') + '</blockquote>', 'quote', quoted.join('\n'));
        }
        continue;
      }

      if (/^\s*\|/.test(line) && i + 1 < lines.length && isTableSep(lines[i + 1])) {
        para(buf); buf = [];
        var head = splitRow(line);
        var aligns = splitRow(lines[i + 1]).map(function (c) {
          return /^:-+:$/.test(c) ? 'center' : /-+:$/.test(c) ? 'right' : '';
        });
        i += 2;
        var rows = [];
        var tableStart = i - 2;
        while (i < lines.length && /^\s*\|/.test(lines[i])) { rows.push(splitRow(lines[i])); i += 1; }
        var cell = function (tag, text, n) {
          var align = aligns[n] ? ' style="text-align:' + aligns[n] + '"' : '';
          return '<' + tag + align + '>' + inline(text) + '</' + tag + '>';
        };
        emit('<div class="table-wrap"><table><thead><tr>' +
          head.map(function (h, n) { return cell('th', h, n); }).join('') + '</tr></thead><tbody>' +
          rows.map(function (r) {
            return '<tr>' + r.map(function (c, n) { return cell('td', c, n); }).join('') + '</tr>';
          }).join('') + '</tbody></table></div>', 'table', lines.slice(tableStart, i).join('\n'));
        continue;
      }

      if (/^\s*(?:[-*]|\d+[.)])\s+/.test(line)) {
        para(buf); buf = [];
        var list = listAt(i);
        emit(list[0], 'list', lines.slice(i, list[1]).join('\n'));
        i = list[1];
        continue;
      }

      buf.push(line.trim());
      i += 1;
    }
    para(buf);
    return { html: html, meta: meta };
  }

  /** What inline markdown looks like once rendered, as plain text. */
  function plain(src) {
    return String(src == null ? '' : src)
      .replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, function (_, ticks, body) { return body.replace(/^ (.*) $/, '$1'); })
      .replace(/\[\[([^\]\n]+)\]\]/g, function (_, keys) { return keys.split('+').map(function (k) { return k.trim(); }).join('+'); })
      .replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, '$1')
      .replace(/\*\*([^*\n]+(?:\*(?!\*)[^*\n]*)*)\*\*/g, '$1')
      .replace(/(^|[^\w*])\*([^*\s][^*\n]*?)\*(?!\w)/g, '$1$2')
      .replace(/(^|[^\w])_([^_\s][^_\n]*?)_(?!\w)/g, '$1$2');
  }

  return { render: render, blocks: blocks, inline: inline, plain: plain, escapeHtml: escapeHtml, CALLOUTS: CALLOUTS };
});
