/*
 * "I don't know this": finds the part of a lesson that teaches what a
 * question asks about, so a quiz can send the learner straight to it.
 *
 * Every lesson is cut into sections (at its headings) and blocks (as
 * markdown.js renders them). A question's words — its prompt, code, right
 * answer and explanation — are scored against them the way a search engine
 * does (BM25), favouring the lessons just before the quiz. The best section
 * wins; inside it, the best block is the part to highlight, and its best
 * sentence the line that matters most.
 *
 * A question can also say where it is taught: `see: lesson-id`, or
 * `see: lesson-id#words-of-a-heading`.
 *
 * Pure functions, shared by Learn mode and the tests in Node.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./markdown.js'));
  else root.LearnLookup = factory(root.LearnMarkdown);
}(typeof self !== 'undefined' ? self : this, function (MD) {
  'use strict';

  var STOP = Object.create(null);
  ('a about above after again all also always an and any are as at be because been before being below between both but by ' +
   'can could did do does doing done down each else ever every few for from get gets give given go goes going got had has have ' +
   'having he her here hers him his how i if in into is isn it its itself just know like likely made make makes many may me might ' +
   'more most much must my need needs never no not now of off often on once one only or other our out over own per put rather ' +
   'really same say says see seen shall she should show shown shows so some something still such sure take than that the their ' +
   'them then there these they thing things this those though through to too two under until up upon us use used uses using very ' +
   'want was way we well were what when where whether which while who whole whom whose why will with without would yes yet you ' +
   'your yours question answer answers correct wrong true false following option options choose pick right best statement example ' +
   'examples line lines code write written happens happen called call calls here next first second third last word words part parts ' +
   'means mean meaning thing work works working look looks').split(' ').forEach(function (w) { STOP[w] = true; });

  function stem(word) {
    var w = word;
    if (w.length > 4 && /ies$/.test(w)) return w.slice(0, -3) + 'y';
    if (w.length > 4 && /(s|x|ch|sh)es$/.test(w)) return w.slice(0, -2);
    if (w.length > 3 && /s$/.test(w) && !/(ss|us|is)$/.test(w)) return w.slice(0, -1);
    return w;
  }

  /** Tokens of code: tag names as <p>, identifiers and CSS properties as they are. */
  function codeTokens(text, out, weight) {
    var src = String(text || '');
    var m;
    var tags = /<\/?([a-zA-Z][a-zA-Z0-9-]*)/g;
    while ((m = tags.exec(src)) !== null) add(out, '<' + m[1].toLowerCase() + '>', weight);
    // Escape sequences like \n are a topic of their own.
    var escapes = /\\[a-z0"'\\]/g;
    while ((m = escapes.exec(src)) !== null) add(out, m[0], weight);
    var words = /[A-Za-z_][A-Za-z0-9_-]*/g;
    while ((m = words.exec(src)) !== null) {
      var w = m[0].toLowerCase().replace(/-+$/, '');
      if (w.length < 2) continue;
      add(out, w, weight);
      if (w.indexOf('-') !== -1) w.split('-').forEach(function (part) { if (part.length > 2 && !STOP[part]) add(out, part, weight / 2); });
    }
  }

  /** Tokens of prose: words without the common ones, lightly stemmed. */
  function proseTokens(text, out, weight) {
    var words = String(text || '').toLowerCase().replace(/'s\b/g, '').match(/[a-z][a-z0-9+#-]*/g) || [];
    words.forEach(function (w) {
      w = w.replace(/-+$/, '');
      if (w.length < 3 || STOP[w]) return;
      add(out, stem(w), weight);
      if (w.indexOf('-') !== -1) w.split('-').forEach(function (part) { if (part.length > 2 && !STOP[part]) add(out, stem(part), weight / 2); });
    });
  }

  /** A map for tokens: words like "constructor" must not find Object's own. */
  function bag() { return Object.create(null); }

  function add(out, token, weight) {
    out[token] = (out[token] || 0) + (weight === undefined ? 1 : weight);
  }

  /** Markdown text: `code spans` and fenced code as code, the rest as prose. */
  function mdTokens(text, out, proseWeight, codeWeight) {
    var src = String(text || '');
    src = src.replace(/```[^\n]*\n([\s\S]*?)```/g, function (_, code) { codeTokens(code, out, codeWeight); return ' '; });
    src = src.replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, function (_, ticks, code) { codeTokens(code, out, codeWeight); return ' '; });
    proseTokens(src, out, proseWeight);
    return out;
  }

  function tokensOf(text) { return mdTokens(text, bag(), 1, 1); }

  function asList(v) {
    if (v === undefined || v === null) return [];
    return Array.isArray(v) ? v : [v];
  }

  /**
   * What a question is about, as weighted tokens: its prompt, code, right
   * answer and explanation (never the wrong options — they are about other things).
   */
  function questionTerms(q) {
    var t = bag();
    var once = function (source, prose, code) {
      var part = mdTokens(source, bag(), prose, code);
      Object.keys(part).forEach(function (k) { add(t, k, Math.min(part[k], Math.max(prose, code))); });
    };
    once(q.prompt, 1, 1.5);
    once(q.why, 1.2, 1.8);
    if (q.code) {
      var c = bag();
      codeTokens(q.code, c, 0.6);
      Object.keys(c).forEach(function (k) { add(t, k, 0.6); });
    }
    if (q.type === 'mcq') asList(q.answer).forEach(function (a) { once(String((q.options || [])[a] || ''), 1.3, 1.8); });
    if (q.type === 'fill') (q.blanks || []).forEach(function (b) { var c = bag(); codeTokens(asList(b)[0], c, 2); proseTokens(asList(b)[0], c, 1); Object.keys(c).forEach(function (k) { add(t, k, c[k]); }); });
    if (q.type === 'spot') {
      var codeLines = String(q.code || '').split('\n');
      asList(q.answer).forEach(function (n) { var c = bag(); codeTokens(codeLines[n - 1] || '', c, 1.2); Object.keys(c).forEach(function (k) { add(t, k, 1.2); }); });
    }
    if (q.type === 'order') (q.lines || []).forEach(function (l) { var c = bag(); codeTokens(l, c, 0.4); Object.keys(c).forEach(function (k) { add(t, k, 0.4); }); });
    if (q.type === 'code' && q.task) once(q.task.prompt, 1, 1.5);
    Object.keys(t).forEach(function (k) { t[k] = Math.min(t[k], 3); });
    return t;
  }

  function sum(obj) {
    var n = 0;
    Object.keys(obj).forEach(function (k) { n += obj[k]; });
    return n;
  }

  // ------------------------------------------------------------ the index

  var CONTENT = { p: 1, list: 1, code: 0.85, callout: 1.1, quote: 1, table: 1 };

  /**
   * Cuts every lesson of a course into sections and blocks, once.
   * @param {object} course  a course from course.js
   */
  function index(course) {
    var sections = [];
    var blocks = [];
    (course.items || []).forEach(function (item) {
      if (item.type !== 'lesson') return;
      var parts = MD.blocks(item.body);
      var head = { lesson: item, heading: '', headingId: '', blocks: [], tf: bag(), len: 0, order: sections.length };
      var about = tokensOf([item.title].concat(item.objectives || []).join('\n'));
      var push = function (sec) { if (sec.blocks.length) sections.push(sec); };
      parts.forEach(function (b, n) {
        if (b.kind === 'h') {
          push(head);
          head = { lesson: item, heading: b.text, headingId: b.id, blocks: [], tf: bag(), len: 0, order: sections.length };
          mdTokens(b.text, head.tf, 1.5, 1.5);
          return;
        }
        if (!CONTENT[b.kind]) return;
        var tf = bag();
        if (b.kind === 'code') codeTokens(b.text, tf, 1);
        else mdTokens(b.text, tf, 1, 1);
        var block = { n: n, kind: b.kind, text: b.text, tf: tf, len: sum(tf), section: head };
        head.blocks.push(block);
        blocks.push(block);
        Object.keys(tf).forEach(function (k) { add(head.tf, k, tf[k]); });
      });
      push(head);
      sections.filter(function (s) { return s.lesson === item; }).forEach(function (s) { s.about = about; });
    });
    sections.forEach(function (s) { s.len = sum(s.tf); });
    return {
      course: course,
      sections: sections,
      blocks: blocks,
      sectionIdf: idf(sections),
      blockIdf: idf(blocks),
      avgSection: average(sections),
      avgBlock: average(blocks)
    };
  }

  function idf(docs) {
    var df = bag();
    docs.forEach(function (d) { Object.keys(d.tf).forEach(function (k) { df[k] = (df[k] || 0) + 1; }); });
    var out = bag();
    var n = docs.length || 1;
    Object.keys(df).forEach(function (k) { out[k] = Math.log(1 + (n - df[k] + 0.5) / (df[k] + 0.5)); });
    return out;
  }

  function average(docs) {
    return docs.reduce(function (s, d) { return s + d.len; }, 0) / (docs.length || 1) || 1;
  }

  function bm25(terms, doc, idfs, avg) {
    var k1 = 1.2;
    var b = 0.5;
    var score = 0;
    Object.keys(terms).forEach(function (t) {
      var tf = doc.tf[t];
      if (!tf) return;
      var norm = tf * (k1 + 1) / (tf + k1 * (1 - b + b * doc.len / avg));
      score += terms[t] * (idfs[t] || 0) * norm;
    });
    return score;
  }

  /**
   * How likely a lesson is to be the one a question comes from, by where it
   * sits: the lessons just before a quiz are what the quiz is about.
   */
  function nearness(owner, lesson) {
    if (!owner || !owner.chapter) return 1;
    var course = owner.chapter.course;
    var chapters = course.chapters || [];
    var mine = chapters.indexOf(owner.chapter);
    var theirs = chapters.indexOf(lesson.chapter);
    if (owner.chapter.course && owner.id && owner.id === course.final) return theirs <= mine ? 1 : 0.3;
    if (theirs !== mine) return theirs < mine ? (theirs === mine - 1 ? 0.8 : 0.65) : 0.3;
    if (owner.type !== 'quiz') return 1.3;
    var items = owner.chapter.items;
    var at = items.indexOf(owner);
    var where = items.indexOf(lesson);
    if (where > at) return 0.7;
    for (var i = where + 1; i < at; i += 1) {
      if (['quiz', 'exam', 'review'].indexOf(items[i].type) !== -1) return 1.15;
    }
    return 1.5;
  }

  /** The sentences (or list items, or table rows) of a block, as rendered text. */
  function sentences(block) {
    if (block.kind === 'code') return [];
    var text = block.text;
    var pieces;
    if (block.kind === 'list') {
      pieces = text.split('\n').map(function (l) { return l.replace(/^\s*(?:[-*]|\d+[.)])\s+/, ''); });
    } else if (block.kind === 'table') {
      pieces = text.split('\n').filter(function (l) { return !/^\s*\|?\s*:?-+/.test(l); })
        .map(function (l) { return l.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(function (c) { return c.trim(); }).join(' '); });
    } else {
      pieces = text.replace(/\n/g, ' ').split(/(?<=[.!?])\s+(?=[A-Z0-9`"*(<])/);
    }
    return pieces.map(function (p) { return MD.plain(p).replace(/\s+/g, ' ').trim(); }).filter(Boolean);
  }

  function bestSentence(block, terms, idfs) {
    var best = '';
    var top = 0;
    sentences(block).forEach(function (s) {
      var tf = tokensOf(s);
      var score = 0;
      Object.keys(terms).forEach(function (t) { if (tf[t]) score += terms[t] * (idfs[t] || 0); });
      // A little credit for being short: the key line, not the whole paragraph.
      score = score / Math.pow(Math.max(4, s.split(' ').length), 0.25);
      if (score > top) { top = score; best = s; }
    });
    return best;
  }

  function slug(text) {
    return String(text || '').toLowerCase().replace(/[^\w]+/g, '-').replace(/^-|-$/g, '');
  }

  function result(section, block, terms, idx) {
    return {
      lesson: section.lesson.id,
      title: section.lesson.title,
      heading: section.heading,
      headingId: section.headingId,
      block: block ? block.n : null,
      sentence: block ? bestSentence(block, terms, idx.blockIdf) : ''
    };
  }

  function bestBlock(section, terms, idx) {
    var best = null;
    var top = -1;
    section.blocks.forEach(function (b) {
      var score = bm25(terms, b, idx.blockIdf, idx.avgBlock) * (CONTENT[b.kind] || 1);
      if (score > top) { top = score; best = b; }
    });
    return best;
  }

  /**
   * Where a question is taught.
   * @param {object} idx     from index()
   * @param {object} q       the question
   * @param {object} owner   the quiz (or exam) it is in, for which lessons come first
   * @returns {{lesson, title, heading, headingId, block, sentence}|null}
   */
  function find(idx, q, owner) {
    var terms = questionTerms(q);
    var see = q._raw && q._raw.see ? String(q._raw.see) : (q.see || '');
    if (see) {
      var parts = see.split('#');
      var chosen = idx.sections.filter(function (s) { return s.lesson.id === parts[0]; });
      if (parts[1]) {
        var want = slug(parts[1]);
        var named = chosen.filter(function (s) { return slug(s.heading).indexOf(want) !== -1; });
        if (named.length) chosen = named;
      }
      if (chosen.length) {
        // A named heading is the section; a lesson alone, its best section.
        var pickSec = parts[1] ? chosen[0] : chosen.slice().sort(function (a, b) {
          return bm25(terms, b, idx.sectionIdf, idx.avgSection) - bm25(terms, a, idx.sectionIdf, idx.avgSection);
        })[0];
        return result(pickSec, bestBlock(pickSec, terms, idx), terms, idx);
      }
    }
    var top = 0;
    var winner = null;
    idx.sections.forEach(function (s) {
      var score = bm25(terms, s, idx.sectionIdf, idx.avgSection);
      score += 0.25 * bm25(terms, { tf: s.about, len: sum(s.about) }, idx.sectionIdf, idx.avgSection);
      score *= nearness(owner, s.lesson);
      if (score > top) { top = score; winner = s; }
    });
    if (!winner) return null;
    return result(winner, bestBlock(winner, terms, idx), terms, idx);
  }

  return {
    index: index,
    find: find,
    questionTerms: questionTerms,
    tokensOf: tokensOf,
    sentences: sentences
  };
}));
