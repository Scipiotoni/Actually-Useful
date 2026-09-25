/*
 * "Build anything" projects: the learner makes whatever they like, as long
 * as it uses a list of ingredients ("a loop, a function, an array, events").
 * Each ingredient is checked one or more ways:
 *
 *   code:   a regular expression that must match the learner's code (with
 *           comments removed, so a commented-out loop doesn't count);
 *           `in: html|css|js|cpp` picks which code (default: all of it).
 *   check:  for pages and JavaScript, an expression that must be true when
 *           the page or program has run, e.g. count('section') >= 3.
 *   output: a regular expression the program's output must match.
 *
 * Pure functions, shared by Learn mode and the course checks in Node.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LearnBuild = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function langOf(name) {
    var ext = String(name || '').toLowerCase().split('.').pop();
    if (ext === 'html' || ext === 'htm') return 'html';
    if (ext === 'css') return 'css';
    if (ext === 'js' || ext === 'mjs') return 'js';
    if (['cpp', 'cc', 'cxx', 'c', 'h', 'hpp'].indexOf(ext) !== -1) return 'cpp';
    return 'text';
  }

  /** Code without its comments; strings are kept as they are. */
  function stripComments(text, lang) {
    var src = String(text || '');
    if (lang === 'html') return src.replace(/<!--[\s\S]*?-->/g, '');
    if (lang === 'css') return src.replace(/\/\*[\s\S]*?\*\//g, '');
    var out = '';
    var i = 0;
    while (i < src.length) {
      var c = src.charAt(i);
      var next = src.charAt(i + 1);
      if (c === '/' && next === '/') {
        while (i < src.length && src.charAt(i) !== '\n') i += 1;
      } else if (c === '/' && next === '*') {
        var end = src.indexOf('*/', i + 2);
        i = end === -1 ? src.length : end + 2;
        out += ' ';
      } else if (c === '"' || c === "'" || (c === '`' && lang === 'js')) {
        var j = i + 1;
        while (j < src.length && src.charAt(j) !== c && !(c !== '`' && src.charAt(j) === '\n')) {
          j += src.charAt(j) === '\\' ? 2 : 1;
        }
        out += src.slice(i, j + 1);
        i = j + 1;
      } else {
        out += c;
        i += 1;
      }
    }
    return out;
  }

  /** CSS or JavaScript written inside an HTML page's <style> and <script>. */
  function inlineCode(html, lang) {
    var re = lang === 'css' ? /<style\b[^>]*>([\s\S]*?)<\/style>/gi : /<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
    var found = [];
    var m;
    while ((m = re.exec(html)) !== null) found.push(m[1]);
    if (lang === 'css') {
      var attr = /\sstyle\s*=\s*("([^"]*)"|'([^']*)')/gi;
      while ((m = attr.exec(html)) !== null) found.push(m[2] !== undefined ? m[2] : m[3]);
    }
    return found;
  }

  /** All the learner's code in one language (or every language), without comments. */
  function sources(files, lang) {
    var langs = lang ? [lang] : ['html', 'css', 'js', 'cpp'];
    var parts = [];
    langs.forEach(function (l) {
      (files || []).forEach(function (f) {
        var fileLang = langOf(f.name);
        if (fileLang === l) parts.push(stripComments(f.content, l));
        else if (fileLang === 'html' && (l === 'css' || l === 'js')) {
          inlineCode(stripComments(f.content, 'html'), l).forEach(function (code) { parts.push(stripComments(code, l)); });
        }
      });
    });
    return parts.join('\n');
  }

  function regex(source, flags) {
    return new RegExp(source, flags || '');
  }

  /** Whether the code-matching part of an ingredient is met. */
  function codeMet(req, files) {
    if (!req.code) return true;
    var lang = req.in || '';
    var flags = req.flags !== undefined ? req.flags : (lang === 'html' || lang === 'css' ? 'i' : '');
    return regex(req.code, flags).test(sources(files, lang));
  }

  /** The checks to run in the page or program, one per ingredient that has one. */
  function harness(requirements) {
    return (requirements || [])
      .filter(function (r) { return r.check; })
      .map(function (r) { return 'check(Boolean(' + r.check + '), true);'; })
      .join('\n');
  }

  /**
   * Marks a project.
   * @param {object[]} requirements  {text, code?, in?, flags?, check?, output?, hint?}
   * @param {Array<{name, content}>} files  the learner's code
   * @param {{checks?: object[], clean: boolean, output?: string, problem?: string}} run
   *        what running it gave: the harness's check results in order, whether it
   *        ran without errors, what it printed
   * @returns {{ok: boolean, checks: object[]}} one row per ingredient, plus "runs cleanly"
   */
  function grade(requirements, files, run) {
    run = run || {};
    var results = run.checks || [];
    var next = 0;
    var rows = (requirements || []).map(function (r) {
      var ok = codeMet(r, files);
      if (r.check) {
        var c = results[next];
        next += 1;
        ok = ok && Boolean(c && c.ok);
      }
      if (r.output) ok = ok && regex(r.output, r.flags || '').test(String(run.output || ''));
      return { ok: ok, expr: r.text, label: true, note: ok ? '' : (r.hint || 'Not in your project yet.') };
    });
    rows.push({
      ok: Boolean(run.clean),
      expr: 'It runs without errors',
      label: true,
      note: run.clean ? '' : (run.problem || 'Fix the errors shown below, then check again.')
    });
    return { ok: rows.every(function (r) { return r.ok; }), checks: rows };
  }

  /** Problems with a project's definition (for the course validator). */
  function problems(requirements) {
    var out = [];
    (requirements || []).forEach(function (r, i) {
      var where = 'requirement ' + (i + 1);
      if (!r || !r.text) out.push(where + ' needs a text');
      if (r && !r.code && !r.check && !r.output) out.push(where + ' needs a code, check or output test');
      ['code', 'output'].forEach(function (k) {
        if (r && r[k]) {
          try { regex(r[k], r.flags || ''); } catch (e) { out.push(where + ': ' + k + ' is not a valid regular expression'); }
        }
      });
      if (r && r.in && ['html', 'css', 'js', 'cpp'].indexOf(r.in) === -1) out.push(where + ': in must be html, css, js or cpp');
    });
    return out;
  }

  return {
    langOf: langOf,
    stripComments: stripComments,
    sources: sources,
    codeMet: codeMet,
    harness: harness,
    grade: grade,
    problems: problems
  };
}));
