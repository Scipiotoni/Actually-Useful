/*
 * Reads the course: a small YAML dialect for the files in course/, and the
 * checks that every chapter is well formed (unique ids, answers in range,
 * nothing missing). Shared by the browser and the test suite.
 *
 * The dialect: `key: value` maps, `- item` lists, `key: |` blocks of literal
 * text (markdown and code go here, verbatim), "double" or 'single' quoted
 * strings, [a, b] inline lists, numbers, true/false/null, and # comments on
 * their own line. Two-space indentation; no tabs.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LearnCourse = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ------------------------------------------------------------ YAML-ish

  function parseYaml(text, fileName) {
    var lines = String(text).replace(/\r\n?/g, '\n').split('\n');
    var pos = 0;
    var file = fileName || 'course';

    function fail(message, at) {
      throw new Error(file + ':' + ((at === undefined ? pos : at) + 1) + ': ' + message);
    }
    function indentOf(line) { return /^( *)/.exec(line)[1].length; }
    function ignorable(line) { return /^\s*$/.test(line) || /^\s*#/.test(line); }
    function skip() { while (pos < lines.length && ignorable(lines[pos])) pos += 1; }
    function isItem(line) { return /^\s*-(?:\s|$)/.test(line); }

    lines.forEach(function (line, i) {
      if (/^ *\t/.test(line)) fail('tabs are not allowed for indentation', i);
    });

    function node(indent) {
      skip();
      if (pos >= lines.length) return null;
      var at = indentOf(lines[pos]);
      if (at < indent) return null;
      return isItem(lines[pos]) ? sequence(at) : mapping(at);
    }

    function block(parent) {
      var body = [];
      while (pos < lines.length) {
        var line = lines[pos];
        if (/^\s*$/.test(line)) { body.push(''); pos += 1; continue; }
        if (indentOf(line) <= parent) break;
        body.push(line);
        pos += 1;
      }
      while (body.length && body[body.length - 1] === '') body.pop();
      var min = Infinity;
      body.forEach(function (line) { if (line !== '') min = Math.min(min, indentOf(line)); });
      if (min === Infinity) min = 0;
      return body.map(function (line) { return line.slice(min); }).join('\n');
    }

    function splitFlow(inner) {
      var parts = [];
      var current = '';
      var quote = null;
      for (var i = 0; i < inner.length; i += 1) {
        var c = inner.charAt(i);
        if (quote) {
          current += c;
          if (c === '\\' && quote === '"') { current += inner.charAt(i + 1); i += 1; continue; }
          if (c === quote) quote = null;
        } else if (c === '"' || c === "'") {
          quote = c;
          current += c;
        } else if (c === ',') {
          parts.push(current);
          current = '';
        } else {
          current += c;
        }
      }
      if (current.trim() !== '' || parts.length) parts.push(current);
      return parts.map(function (p) { return p.trim(); }).filter(function (p, i, all) {
        return p !== '' || i < all.length - 1;
      });
    }

    function scalar(s, at) {
      // Quoted only when the quotes wrap the whole value; "Like this" word
      // at the start of a sentence stays plain text.
      if (s.length >= 2 && s.charAt(0) === '"' && s.charAt(s.length - 1) === '"') {
        try { return JSON.parse(s); } catch (e) { fail('bad "double-quoted" text: ' + s, at); }
      }
      if (s.length >= 2 && s.charAt(0) === "'" && s.charAt(s.length - 1) === "'") {
        return s.slice(1, -1).replace(/''/g, "'");
      }
      if (s.charAt(0) === '[') {
        if (s.charAt(s.length - 1) !== ']') fail('unclosed [list]', at);
        return splitFlow(s.slice(1, -1)).map(function (part) { return scalar(part, at); });
      }
      if (s === 'true') return true;
      if (s === 'false') return false;
      if (s === 'null' || s === '~') return null;
      if (/^-?\d+(?:\.\d+)?$/.test(s)) return Number(s);
      return s;
    }

    function mapping(indent) {
      var out = {};
      while (true) {
        skip();
        if (pos >= lines.length) break;
        var line = lines[pos];
        var at = indentOf(line);
        if (at < indent) break;
        if (at > indent) fail('unexpected indentation');
        if (isItem(line)) fail('a "- item" here needs a key above it');
        var m = /^ *([A-Za-z_][\w-]*):(?: (.*))?$/.exec(line);
        if (!m) fail('expected "key: value", got: ' + line.trim());
        var key = m[1];
        var rest = (m[2] || '').trim();
        if (Object.prototype.hasOwnProperty.call(out, key)) fail('duplicate key "' + key + '"');
        var here = pos;
        pos += 1;
        if (rest === '|' || rest === '|-' || rest === '|+') {
          out[key] = block(indent);
        } else if (rest === '') {
          skip();
          if (pos < lines.length && (indentOf(lines[pos]) > indent ||
              (indentOf(lines[pos]) === indent && isItem(lines[pos])))) {
            out[key] = node(indentOf(lines[pos]));
          } else {
            out[key] = null;
          }
        } else {
          out[key] = scalar(rest, here);
        }
      }
      return out;
    }

    function sequence(indent) {
      var out = [];
      while (true) {
        skip();
        if (pos >= lines.length) break;
        var line = lines[pos];
        var at = indentOf(line);
        if (at < indent) break;
        if (at > indent) fail('unexpected indentation');
        if (!isItem(line)) break;
        var after = line.slice(at + 1);
        if (/^\s*$/.test(after)) {
          pos += 1;
          out.push(node(indent + 1));
          continue;
        }
        var content = after.replace(/^ +/, '');
        var column = at + 1 + (after.length - content.length);
        if (content === '|' || content === '|-' || content === '|+') {
          pos += 1;
          out.push(block(at));
        } else if (/^[A-Za-z_][\w-]*:(?: |$)/.test(content)) {
          lines[pos] = new Array(column + 1).join(' ') + content;
          out.push(mapping(column));
        } else if (/^-(?:\s|$)/.test(content)) {
          lines[pos] = new Array(column + 1).join(' ') + content;
          out.push(sequence(column));
        } else {
          var here = pos;
          pos += 1;
          out.push(scalar(content.trim(), here));
        }
      }
      return out;
    }

    skip();
    if (pos >= lines.length) return null;
    var result = node(0);
    skip();
    if (pos < lines.length) fail('could not read this line: ' + lines[pos].trim());
    return result;
  }

  // ------------------------------------------------------------ course

  var ITEM_TYPES = ['lesson', 'quiz', 'challenge', 'review', 'exam', 'project'];
  var QUESTION_TYPES = ['mcq', 'tf', 'output', 'fill', 'order', 'spot', 'code'];
  var ID_RE = /^[a-z0-9][a-z0-9-]*$/;

  function text(value) {
    if (value === undefined || value === null) return '';
    return String(value);
  }

  function list(value) {
    if (value === undefined || value === null) return [];
    return Array.isArray(value) ? value : [value];
  }

  function lines(value) {
    if (Array.isArray(value)) return value.map(text);
    return text(value).split('\n');
  }

  function normalizeTests(raw) {
    return list(raw).map(function (t, i) {
      return {
        name: text(t && t.name) || 'Test ' + (i + 1),
        input: t && t.in !== undefined ? t.in : '',
        output: t && t.out !== undefined ? t.out : '',
        hidden: Boolean(t && t.hidden)
      };
    });
  }

  /** A coding exercise: a lesson task, a challenge, a milestone or an exam question. */
  function normalizeTask(raw, id) {
    return {
      id: id,
      title: text(raw.title),
      prompt: text(raw.prompt),
      starter: raw.starter === undefined ? '' : text(raw.starter),
      tests: normalizeTests(raw.tests),
      harness: raw.harness === undefined ? '' : text(raw.harness),
      harnessPre: raw.harness_pre === undefined ? '' : text(raw.harness_pre),
      solution: raw.solution === undefined ? '' : text(raw.solution),
      hints: list(raw.hints).map(text),
      explain: text(raw.explain),
      difficulty: Number(raw.difficulty) || 0,
      tags: list(raw.tags).map(text),
      std: text(raw.std),
      mode: raw.harness ? 'functions' : 'program',
      _raw: raw
    };
  }

  function normalizeQuestion(raw, id) {
    raw = raw || {};
    var q = {
      id: id,
      type: text(raw.type) || (raw.options ? 'mcq' : ''),
      prompt: text(raw.prompt),
      code: raw.code === undefined ? '' : text(raw.code),
      stdin: raw.stdin === undefined ? '' : text(raw.stdin),
      why: text(raw.why),
      std: text(raw.std),
      _raw: raw
    };
    switch (q.type) {
      case 'mcq':
        q.options = list(raw.options);
        q.answer = raw.answer;
        q.multi = Array.isArray(raw.answer);
        break;
      case 'tf':
        q.answer = raw.answer;
        break;
      case 'output':
        q.answer = raw.answer;
        break;
      case 'fill':
        q.blanks = list(raw.blanks).map(function (b) { return list(b).map(text); });
        q.output = raw.output === undefined ? null : text(raw.output);
        break;
      case 'order':
        q.lines = lines(raw.lines);
        q.alternatives = list(raw.alternatives);
        q.output = raw.output === undefined ? null : text(raw.output);
        break;
      case 'spot':
        q.answer = raw.answer;
        break;
      case 'code':
        q.task = normalizeTask(raw, id);
        break;
      default:
        break;
    }
    return q;
  }

  function normalizeQuestions(raw, owner) {
    return list(raw).map(function (q, i) {
      return normalizeQuestion(q, owner + '/' + text(q && q.id || 'q' + (i + 1)));
    });
  }

  function normalizeItem(raw, chapter, index) {
    var id = text(raw.id);
    var item = {
      id: id,
      type: text(raw.type),
      title: text(raw.title),
      subtitle: text(raw.subtitle),
      minutes: Number(raw.minutes) || 0,
      chapter: chapter,
      index: index,
      objectives: list(raw.objectives).map(text),
      body: text(raw.body),
      _raw: raw
    };

    if (item.type === 'lesson') {
      item.checks = normalizeQuestions(raw.checks, id);
      item.tasks = list(raw.tasks).map(function (t, i) {
        return normalizeTask(t || {}, id + '/' + text(t && t.id || 't' + (i + 1)));
      });
      item.cards = list(raw.cards).map(function (c, i) {
        return { id: id + '#' + (i + 1), front: text(c && c.front), back: text(c && c.back), lesson: id };
      });
    } else if (item.type === 'quiz' || item.type === 'exam' || item.type === 'review') {
      item.questions = normalizeQuestions(raw.questions, id);
      item.pass = raw.pass === undefined ? (item.type === 'exam' ? 0.8 : 0.7) : Number(raw.pass);
      item.pick = Number(raw.pick) || 0;
    } else if (item.type === 'challenge') {
      item.task = normalizeTask(raw, id);
      item.difficulty = item.task.difficulty || 1;
    } else if (item.type === 'project') {
      item.milestones = list(raw.milestones).map(function (m, i) {
        return normalizeTask(m || {}, id + '/m' + (i + 1));
      });
    }
    return item;
  }

  /**
   * Builds the course from its parsed files.
   * @param {object} index    course/course.yml
   * @param {object[]} docs   each chapter file, in order
   * @param {object} [extra]  {glossary}
   */
  function buildCourse(index, docs, extra) {
    extra = extra || {};
    var course = {
      title: text(index.title),
      subtitle: text(index.subtitle),
      intro: text(index.intro),
      method: text(index.method),
      parts: [],
      chapters: [],
      items: [],
      byId: {},
      questions: {},
      cards: [],
      glossary: list(extra.glossary && extra.glossary.terms).map(function (t) {
        return { term: text(t.term), def: text(t.def), chapter: text(t.chapter) };
      })
    };

    var partsById = {};
    list(index.parts).forEach(function (p) {
      var part = { id: text(p.id), title: text(p.title), blurb: text(p.blurb), chapters: [] };
      partsById[part.id] = part;
      course.parts.push(part);
    });

    docs.forEach(function (doc) {
      var chapter = {
        id: text(doc.id),
        number: doc.number,
        title: text(doc.title),
        part: text(doc.part),
        blurb: text(doc.blurb),
        goals: list(doc.goals).map(text),
        hours: Number(doc.hours) || 0,
        items: [],
        _raw: doc
      };
      list(doc.items).forEach(function (raw, i) {
        var item = normalizeItem(raw || {}, chapter, i);
        chapter.items.push(item);
        course.items.push(item);
        course.byId[item.id] = item;
        (item.checks || []).concat(item.questions || []).forEach(function (q) {
          course.questions[q.id] = { question: q, item: item };
        });
        (item.cards || []).forEach(function (card) { course.cards.push(card); });
      });
      course.chapters.push(chapter);
      if (partsById[chapter.part]) partsById[chapter.part].chapters.push(chapter);
    });

    return course;
  }

  // ------------------------------------------------------------ validation

  /** Everything wrong with a course, as readable sentences. Empty when fine. */
  function validate(course) {
    var problems = [];
    var seen = {};
    var report = function (where, message) { problems.push(where + ': ' + message); };

    var checkTask = function (task, where) {
      if (!task.prompt) report(where, 'a coding task needs a prompt');
      if (!task.solution) report(where, 'a coding task needs a solution');
      if (!task.tests.length && !task.harness) report(where, 'a coding task needs tests or a harness');
      task.tests.forEach(function (t, i) {
        if (typeof t.input !== 'string') report(where, 'test ' + (i + 1) + ' input must be text (quote it)');
        if (typeof t.output !== 'string') report(where, 'test ' + (i + 1) + ' output must be text (quote it)');
      });
      task.hints.forEach(function (h, i) {
        if (typeof (task._raw.hints || [])[i] === 'object') report(where, 'hint ' + (i + 1) + ' became a map — quote it');
      });
    };

    var checkQuestion = function (q, where) {
      if (seen[q.id]) report(where, 'duplicate question id ' + q.id);
      seen[q.id] = true;
      if (QUESTION_TYPES.indexOf(q.type) === -1) { report(where, 'unknown question type "' + q.type + '"'); return; }
      if (!q.prompt && q.type !== 'output' && q.type !== 'code' && q.type !== 'order' && q.type !== 'spot') report(where, 'missing prompt');
      if (q.type === 'mcq') {
        if (q.options.length < 2) report(where, 'needs at least two options');
        q.options.forEach(function (o, i) {
          if (o !== null && typeof o === 'object') report(where, 'option ' + (i + 1) + ' became a map — quote it');
        });
        list(q.answer).forEach(function (a) {
          if (typeof a !== 'number' || a < 0 || a >= q.options.length || a % 1) report(where, 'answer ' + a + ' is not an option index');
        });
        if (!list(q.answer).length) report(where, 'missing answer');
      }
      if (q.type === 'tf' && typeof q.answer !== 'boolean') report(where, 'answer must be true or false');
      if (q.type === 'output') {
        if (!q.code) report(where, 'an output question needs code');
        if (typeof q.answer !== 'string') report(where, 'answer must be text (use | or quotes)');
      }
      if (q.type === 'fill') {
        var blanks = (q.code.match(/___/g) || []).length;
        if (!blanks) report(where, 'a fill question needs ___ in its code');
        if (blanks !== q.blanks.length) report(where, blanks + ' blanks but ' + q.blanks.length + ' answers');
      }
      if (q.type === 'order' && q.lines.length < 3) report(where, 'an order puzzle needs at least three lines');
      if (q.type === 'spot') {
        var count = q.code.split('\n').length;
        list(q.answer).forEach(function (a) {
          if (typeof a !== 'number' || a < 1 || a > count) report(where, 'answer ' + a + ' is not a line number of the code');
        });
      }
      if (q.type === 'code') checkTask(q.task, where);
      if (!q.why && q.type !== 'code') report(where, 'every question should explain its answer (why:)');
    };

    course.chapters.forEach(function (chapter) {
      var where = 'chapter ' + chapter.id;
      if (!ID_RE.test(chapter.id)) report(where, 'bad chapter id');
      if (!chapter.title) report(where, 'missing title');
      if (!chapter.goals.length) report(where, 'missing goals');
      if (!course.parts.some(function (p) { return p.id === chapter.part; })) report(where, 'unknown part "' + chapter.part + '"');

      chapter.items.forEach(function (item) {
        var at = item.id || (where + ' item ' + (item.index + 1));
        if (!ID_RE.test(item.id)) report(at, 'bad or missing id');
        if (seen[item.id]) report(at, 'duplicate id');
        seen[item.id] = true;
        if (ITEM_TYPES.indexOf(item.type) === -1) report(at, 'unknown type "' + item.type + '"');
        if (!item.title) report(at, 'missing title');
        item.objectives.forEach(function (o, i) {
          if (typeof item._raw.objectives[i] === 'object') report(at, 'objective ' + (i + 1) + ' became a map — quote it');
        });

        if (item.type === 'lesson') {
          if (!item.objectives.length) report(at, 'a lesson needs objectives');
          if (!item.body) report(at, 'a lesson needs a body');
          item.checks.forEach(function (q) { checkQuestion(q, q.id); });
          item.tasks.forEach(function (t) { checkTask(t, t.id); });
          var placed = {};
          (item.body.match(/\{\{\s*(?:check|task)\s+[\w-]+\s*\}\}/g) || []).forEach(function (slot) {
            var parts = /\{\{\s*(check|task)\s+([\w-]+)\s*\}\}/.exec(slot);
            var pool = parts[1] === 'check' ? item.checks : item.tasks;
            var full = item.id + '/' + parts[2];
            if (!pool.some(function (x) { return x.id === full; })) report(at, 'placeholder ' + slot + ' names nothing');
            if (placed[full]) report(at, 'placeholder ' + slot + ' used twice');
            placed[full] = true;
          });
          item.cards.forEach(function (c) {
            if (!c.front || !c.back) report(c.id, 'a flashcard needs a front and a back');
          });
        }
        if (item.type === 'quiz' || item.type === 'exam' || item.type === 'review') {
          if (item.type !== 'review' && !item.questions.length) report(at, 'needs questions');
          item.questions.forEach(function (q) { checkQuestion(q, q.id); });
          if (item.pick && item.pick > item.questions.length) report(at, 'pick is larger than the pool');
        }
        if (item.type === 'review' && !item.body) report(at, 'a review needs a body');
        if (item.type === 'challenge') checkTask(item.task, at);
        if (item.type === 'project') {
          if (!item.milestones.length) report(at, 'a project needs milestones');
          item.milestones.forEach(function (m) { checkTask(m, m.id); });
        }
      });
    });

    return problems;
  }

  /** The fenced blocks of a markdown text, outside quotes (those are illustrations). */
  function fences(body) {
    var blocks = [];
    var lines = String(body).split('\n');
    for (var i = 0; i < lines.length; i += 1) {
      var open = /^(\s*)```([\w+-]*)\s*(.*)$/.exec(lines[i]);
      if (!open) continue;
      var code = [];
      i += 1;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) { code.push(lines[i]); i += 1; }
      blocks.push({ lang: open[2], flags: open[3].trim().split(/\s+/).filter(Boolean), code: code.join('\n') });
    }
    return blocks;
  }

  /** Every piece of C++ in lesson text, for the test that compiles them all. */
  function codeSamples(course) {
    var out = [];
    var fromBody = function (body, where) {
      var blocks = fences(body);
      blocks.forEach(function (b, i) {
        if (b.lang !== 'cpp') return;
        if (b.flags.indexOf('static') !== -1) return;
        var sample = { where: where + ' block ' + (i + 1), code: b.code, error: b.flags.indexOf('error') !== -1, stdin: '' };
        for (var j = i + 1; j < blocks.length && (blocks[j].lang === 'output' || blocks[j].lang === 'stdin'); j += 1) {
          if (blocks[j].lang === 'output') sample.output = blocks[j].code;
          if (blocks[j].lang === 'stdin') sample.stdin = blocks[j].code;
        }
        sample.std = b.flags.indexOf('cpp20') !== -1 ? 'c++20' : '';
        sample.ub = b.flags.indexOf('ub') !== -1;
        sample.norun = b.flags.indexOf('norun') !== -1;
        out.push(sample);
      });
    };

    course.items.forEach(function (item) {
      if (item.body) fromBody(item.body, item.id);
      (item.checks || []).concat(item.questions || []).forEach(function (q) {
        if (q.prompt) fromBody(q.prompt, q.id + ' prompt');
        if (q.why) fromBody(q.why, q.id + ' why');
      });
    });
    return out;
  }

  return {
    parseYaml: parseYaml,
    buildCourse: buildCourse,
    validate: validate,
    codeSamples: codeSamples,
    fences: fences,
    ITEM_TYPES: ITEM_TYPES,
    QUESTION_TYPES: QUESTION_TYPES
  };
});
