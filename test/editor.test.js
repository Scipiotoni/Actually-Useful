'use strict';

const test = require('node:test');
const assert = require('node:assert');

const MiniEditor = require('../public/editor.js');
const edits = MiniEditor.edits;

/** Applies an edit and reports the resulting document and selection. */
function apply(text, edit) {
  if (!edit) return { text, selStart: null, selEnd: null, noop: true };
  return {
    text: text.slice(0, edit.from) + edit.insert + text.slice(edit.to),
    selStart: edit.selStart,
    selEnd: edit.selEnd,
    noop: false
  };
}

// --------------------------------------------------------------- line spans

test('a line span covers whole lines, however the selection sits', () => {
  const text = 'uno\ndos\ntres';

  // Caret in the middle of the second line.
  assert.deepStrictEqual(edits.lineSpan(text, 5, 5), { from: 4, to: 7, text: 'dos' });
  // Selection crossing two lines.
  assert.deepStrictEqual(edits.lineSpan(text, 2, 6), { from: 0, to: 7, text: 'uno\ndos' });
  // The last line, which has no trailing newline.
  assert.deepStrictEqual(edits.lineSpan(text, 9, 9), { from: 8, to: 12, text: 'tres' });
  // A selection ending exactly at a line start does not drag in that line.
  assert.deepStrictEqual(edits.lineSpan(text, 0, 4), { from: 0, to: 3, text: 'uno' });
});

// ------------------------------------------------------------------ indent

test('Tab indents every line the selection touches', () => {
  const text = 'uno\ndos\ntres';
  assert.strictEqual(apply(text, edits.indent(text, 0, 12, false)).text, '  uno\n  dos\n  tres');
});

test('Shift+Tab outdents, and works with the caret at column 0', () => {
  assert.strictEqual(apply('    x', edits.indent('    x', 0, 0, true)).text, '  x');
  assert.strictEqual(apply('  x', edits.indent('  x', 0, 0, true)).text, 'x');
  // Nothing to remove is a no-op, not a mangled line.
  assert.ok(edits.indent('x', 0, 0, true) === null);
});

test('outdenting removes at most one indent level per line', () => {
  const text = '      a\n  b\nc';
  assert.strictEqual(apply(text, edits.indent(text, 0, text.length, true)).text, '    a\nb\nc');
});

test('indenting keeps the selection over the same lines', () => {
  const text = 'uno\ndos';
  const result = apply(text, edits.indent(text, 0, 7, false));
  assert.strictEqual(result.text, '  uno\n  dos');
  assert.strictEqual(result.text.slice(result.selStart, result.selEnd), '  uno\n  dos'.slice(2));
});

test('a blank line is indented without leaving stray spaces behind', () => {
  const text = 'a\n\nb';
  const out = apply(text, edits.indent(text, 0, 4, false)).text;
  assert.strictEqual(out, '  a\n  \n  b');
  assert.strictEqual(apply(out, edits.indent(out, 0, out.length, true)).text, text);
});

// ----------------------------------------------------------------- comments

test('JS comments toggle line by line, keeping the indent', () => {
  const text = '  var a = 1;\n  var b = 2;';
  const commented = apply(text, edits.toggleComment(text, 0, text.length, 'js')).text;
  assert.strictEqual(commented, '  // var a = 1;\n  // var b = 2;');
  assert.strictEqual(apply(commented, edits.toggleComment(commented, 0, commented.length, 'js')).text, text);
});

test('a half-commented block becomes fully commented, not uncommented', () => {
  const text = '// a\nb';
  assert.strictEqual(apply(text, edits.toggleComment(text, 0, text.length, 'js')).text, '// // a\n// b');
});

test('blank lines are left alone when commenting', () => {
  const text = 'a\n\nb';
  assert.strictEqual(apply(text, edits.toggleComment(text, 0, text.length, 'js')).text, '// a\n\n// b');
});

test('HTML and CSS use block comments', () => {
  const html = '<p>hi</p>';
  const wrapped = apply(html, edits.toggleComment(html, 0, html.length, 'html')).text;
  assert.strictEqual(wrapped, '<!-- <p>hi</p> -->');
  assert.strictEqual(apply(wrapped, edits.toggleComment(wrapped, 0, wrapped.length, 'html')).text, html);

  const css = 'a { color: red }';
  const wrappedCss = apply(css, edits.toggleComment(css, 0, css.length, 'css')).text;
  assert.strictEqual(wrappedCss, '/* a { color: red } */');
  assert.strictEqual(apply(wrappedCss, edits.toggleComment(wrappedCss, 0, wrappedCss.length, 'css')).text, css);
});

// -------------------------------------------------------------- moving lines

test('lines move up and down, and stop at the edges', () => {
  const text = 'a\nb\nc';
  assert.strictEqual(apply(text, edits.moveLines(text, 0, 0, true)).text, 'b\na\nc');
  assert.strictEqual(apply(text, edits.moveLines(text, 2, 2, false)).text, 'b\na\nc');
  assert.strictEqual(edits.moveLines(text, 0, 0, false), null, 'the first line cannot move up');
  assert.strictEqual(edits.moveLines(text, 4, 4, true), null, 'the last line cannot move down');
});

test('moving a block carries the whole selection', () => {
  const text = 'a\nb\nc\nd';
  const moved = apply(text, edits.moveLines(text, 0, 3, true));
  assert.strictEqual(moved.text, 'c\na\nb\nd');
  assert.strictEqual(moved.text.slice(moved.selStart, moved.selEnd), 'a\nb');
});

test('moving down onto a last line without a newline works', () => {
  const text = 'a\nb';
  assert.strictEqual(apply(text, edits.moveLines(text, 0, 0, true)).text, 'b\na');
});

// ------------------------------------------------------- duplicate and delete

test('duplicate copies the selection, or the line when there is none', () => {
  assert.strictEqual(apply('hola', edits.duplicate('hola', 2, 2)).text, 'hola\nhola');
  assert.strictEqual(apply('hola mundo', edits.duplicate('hola mundo', 0, 4)).text, 'holahola mundo');
});

test('deleting a line closes the gap and never leaves a blank line', () => {
  // A middle line takes the newline that follows it.
  assert.strictEqual(apply('uno\ndos\ntres', edits.deleteLines('uno\ndos\ntres', 5, 5)).text, 'uno\ntres');
  // The last line has no newline after it, so it takes the one before.
  assert.strictEqual(apply('uno\ndos', edits.deleteLines('uno\ndos', 5, 5)).text, 'uno');
  assert.strictEqual(apply('a\nb\nc', edits.deleteLines('a\nb\nc', 4, 4)).text, 'a\nb');
  // A trailing empty line goes too.
  assert.strictEqual(apply('a\n', edits.deleteLines('a\n', 2, 2)).text, 'a');
  // The only line leaves an empty document, not a stray newline.
  assert.strictEqual(apply('sola', edits.deleteLines('sola', 1, 1)).text, '');
  // A whole selected block goes at once.
  assert.strictEqual(apply('a\nb\nc\nd', edits.deleteLines('a\nb\nc\nd', 0, 3)).text, 'c\nd');
});

// -------------------------------------------------------------------- find

test('find locates every occurrence, honouring the case setting', () => {
  const text = 'gato perro gato loro GATO';
  assert.deepStrictEqual(
    edits.findMatches(text, 'gato', false).map((m) => m.start),
    [0, 11, 21]
  );
  assert.deepStrictEqual(
    edits.findMatches(text, 'gato', true).map((m) => m.start),
    [0, 11]
  );
  assert.deepStrictEqual(edits.findMatches(text, '', false), []);
  assert.deepStrictEqual(edits.findMatches(text, 'nada', false), []);
});

test('overlapping matches advance instead of looping forever', () => {
  const found = edits.findMatches('aaaa', 'aa', true);
  assert.deepStrictEqual(found.map((m) => m.start), [0, 2]);
});

test('replacing every match rebuilds the text left to right', () => {
  const text = 'uno dos uno';
  const found = edits.findMatches(text, 'uno', true);
  let out = '';
  let last = 0;
  found.forEach((match) => {
    out += text.slice(last, match.start) + 'tres';
    last = match.end;
  });
  assert.strictEqual(out + text.slice(last), 'tres dos tres');
});

// ----------------------------------------------------------- highlighting

test('highlighting still works for each language', () => {
  assert.match(MiniEditor.highlight('js', 'var a = 1'), /t-keyword/);
  assert.match(MiniEditor.highlight('css', 'a { color: red }'), /t-prop/);
  assert.match(MiniEditor.highlight('html', '<p class="x">hi</p>'), /t-attr/);
});

test('highlighting escapes markup so source cannot inject into the paint layer', () => {
  const out = MiniEditor.highlight('js', 'var x = "</span><img onerror=alert(1)>"');
  assert.ok(!out.includes('<img'), 'the tag must be escaped');
  assert.match(out, /&lt;img/);
});

// --------------------------------------------------------------------------
// Line arithmetic. These run on every keystroke, so they avoid allocating a
// string per line — which is what made a large file lock the editor up.
// --------------------------------------------------------------------------

const { countNewlines, lineStarts } = MiniEditor.text;

test('counting newlines matches splitting, without the allocation', () => {
  const samples = ['', 'a', 'a\nb', 'a\nb\n', '\n', '\n\n\n', 'sin saltos de linea'];
  for (const text of samples) {
    assert.strictEqual(
      countNewlines(text) + 1,
      text.split('\n').length,
      `line count for ${JSON.stringify(text)}`
    );
  }
});

test('counting newlines up to an offset stops there', () => {
  const text = 'uno\ndos\ntres';
  assert.strictEqual(countNewlines(text, 0), 0);
  assert.strictEqual(countNewlines(text, 4), 1);
  assert.strictEqual(countNewlines(text, 8), 2);
  assert.strictEqual(countNewlines(text, text.length), 2);
});

test('line starts point at the first character of every line', () => {
  const text = 'uno\ndos\ntres';
  const starts = lineStarts(text);
  assert.deepStrictEqual(starts, [0, 4, 8]);
  assert.deepStrictEqual(starts.map((at) => text.slice(at).split('\n')[0]), ['uno', 'dos', 'tres']);

  assert.deepStrictEqual(lineStarts(''), [0]);
  assert.deepStrictEqual(lineStarts('a\n'), [0, 2], 'a trailing newline opens one more line');
});

test('line arithmetic holds for a document far past the colouring limit', () => {
  const line = 'x'.repeat(80) + '\n';
  const big = line.repeat(20000);
  assert.ok(big.length > MiniEditor.COLOUR_LIMIT, 'this sample must exceed the limit');

  const starts = lineStarts(big);
  assert.strictEqual(starts.length, 20001);
  assert.strictEqual(countNewlines(big) + 1, starts.length);
  assert.strictEqual(starts[1], 81);
});

// --------------------------------------------------------------------------
// Closing tags written for you
// --------------------------------------------------------------------------

/** What the document looks like after typing ">", with | marking the caret. */
function typeAngle(text) {
  const done = edits.closeTagOn(text, text.length);
  if (!done) return text + '>';
  return text + done.insert.slice(0, done.caret) + '|' + done.insert.slice(done.caret);
}

test('typing > closes the tag and leaves the caret inside', () => {
  assert.strictEqual(typeAngle('<h1'), '<h1>|</h1>');
  assert.strictEqual(typeAngle('<div'), '<div>|</div>');
  assert.strictEqual(typeAngle('<my-widget'), '<my-widget>|</my-widget>');
});

test('attributes come along, including a > inside a quoted value', () => {
  assert.strictEqual(typeAngle('<div class="card"'), '<div class="card">|</div>');
  assert.strictEqual(typeAngle("<a href='x.html'"), "<a href='x.html'>|</a>");
  // The > in the value must not be read as the end of the tag.
  assert.strictEqual(typeAngle('<p data-q="a>b"'), '<p data-q="a>b">|</p>');
});

test('tags that never close are left alone', () => {
  for (const tag of ['<br', '<img src="x.png"', '<input type="text"', '<hr', '<meta charset="utf-8"', '<link rel="x"']) {
    assert.strictEqual(edits.closeTagOn(tag, tag.length), null, `${tag} takes no closing tag`);
  }
});

test('nothing is added where there is no open tag', () => {
  const leaveAlone = [
    '<div /',          // already self-closed
    '<div / ',
    '</div',           // this is a closing tag being typed
    'a < b',           // a comparison, not markup
    'plain text',
    '<div>text'        // the tag was closed already
  ];
  for (const text of leaveAlone) {
    assert.strictEqual(edits.closeTagOn(text, text.length), null, `${JSON.stringify(text)} should add nothing`);
  }
});

test('the caret lands between the two tags, not after them', () => {
  const done = edits.closeTagOn('<section', 8);
  assert.strictEqual(done.insert, '></section>');
  assert.strictEqual(done.caret, 1, 'one character in, just past the >');
});

// ---------------------------------------------------------------- </ completes

test('typing </ completes the tag that is still open', () => {
  const complete = (text) => {
    const done = edits.completeClosingTag(text + '<', text.length + 1);
    return done ? '<' + done.insert : null;
  };
  assert.strictEqual(complete('<div><p>texto'), '</p>');
  assert.strictEqual(complete('<div><p>a</p>'), '</div>');
  assert.strictEqual(complete('<ul><li>x</li><li>y'), '</li>');
  // Void elements never go on the stack.
  assert.strictEqual(complete('<div><br>'), '</div>');
  assert.strictEqual(complete('<div><img src="x">'), '</div>');
  // Self-closing elements do not either.
  assert.strictEqual(complete('<div><thing/>'), '</div>');
});

test('nothing is completed when everything is closed', () => {
  assert.strictEqual(edits.completeClosingTag('<div></div><', 12), null);
  assert.strictEqual(edits.completeClosingTag('texto<', 6), null);
  // The "/" has to follow a "<" directly.
  assert.strictEqual(edits.completeClosingTag('<div>x', 6), null);
});

test('a stray closing tag does not unbalance the stack', () => {
  // </span> closes nothing here, so <div> is still the open one.
  const done = edits.completeClosingTag('<div></span><', 13);
  assert.strictEqual(done && '<' + done.insert, '</div>');
});

test('typing a closer that is already there steps over it', () => {
  // Every closing character, not just quotes: ")" and "]" used to be typed
  // twice because the rule sat where they could never reach it.
  for (const key of [')', ']', '}', '"', "'", '`']) {
    assert.strictEqual(edits.skipsOver(key, 0, key), true, `${key} should step over itself`);
  }
});

test('a closer is only stepped over when it is the very next character', () => {
  assert.strictEqual(edits.skipsOver('()', 1, ')'), true);
  assert.strictEqual(edits.skipsOver('(a)', 1, ')'), false, 'there is an "a" in the way');
  assert.strictEqual(edits.skipsOver('()', 2, ')'), false, 'past the end');
  assert.strictEqual(edits.skipsOver('', 0, ')'), false);
});

test('opening characters are never stepped over', () => {
  for (const key of ['(', '[', '{', '<']) {
    assert.strictEqual(edits.skipsOver(key + key, 0, key), false, `${key} should be typed, not skipped`);
  }
});
