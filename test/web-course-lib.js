'use strict';

/**
 * Checks the HTML, CSS and JavaScript courses in a real browser: every example
 * runs without errors and prints what the lesson says, predicted outputs are
 * right, every solution passes its checks and every starter does not.
 *
 * It needs Playwright with Chromium. Used by course.test.js, and on its own:
 *
 *   node test/web-course-lib.js              every web course
 *   node test/web-course-lib.js html js03    a course, or single chapters
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const Course = require('../public/learn/course.js');
const Engine = require('../public/learn/engine.js');
const Build = require('../public/learn/build.js');
const Video = require('../public/learn/video.js');

const LEARN = path.join(__dirname, '..', 'public', 'learn');

/** The course folders listed in courses.yml. */
function courseDirs() {
  const list = Course.parseYaml(fs.readFileSync(path.join(LEARN, 'courses.yml'), 'utf8'), 'courses.yml');
  return list.courses.map((c) => path.join(LEARN, String(c.dir)));
}

function loadCourseAt(dir, only) {
  const read = (file) => Course.parseYaml(fs.readFileSync(path.join(dir, file), 'utf8'), path.basename(dir) + '/' + file);
  const index = read('course.yml');
  let names = index.chapters || [];
  const missing = names.filter((n) => !fs.existsSync(path.join(dir, n + '.yml')));
  const present = names.filter((n) => fs.existsSync(path.join(dir, n + '.yml')));
  const chosen = only && only.length && !only.includes(String(index.id)) ? present.filter((n) => only.includes(n)) : present;
  const glossary = fs.existsSync(path.join(dir, 'glossary.yml')) ? read('glossary.yml') : null;
  const docs = chosen.map((n) => read(n + '.yml'));
  return { course: Course.buildCourse(index, docs, { glossary }), missing, index };
}

/** The web courses (lang: web), optionally narrowed to course or chapter ids. */
function loadWebCourses(only) {
  return courseDirs()
    .filter((dir) => fs.existsSync(path.join(dir, 'course.yml')))
    .map((dir) => ({ dir, index: Course.parseYaml(fs.readFileSync(path.join(dir, 'course.yml'), 'utf8'), 'course.yml') }))
    .filter(({ index }) => index.lang === 'web')
    .filter(({ index }) => !only || !only.length || only.includes(String(index.id)) ||
      (index.chapters || []).some((c) => only.includes(c)))
    .map(({ dir }) => loadCourseAt(dir, only));
}

function merge(given, mine) {
  const out = (given || []).map((f) => ({ name: f.name, content: f.content }));
  (mine || []).forEach((f) => {
    const at = out.findIndex((g) => g.name === f.name);
    if (at === -1) out.push({ name: f.name, content: f.content }); else out[at] = { name: f.name, content: f.content };
  });
  return out;
}

/** Every run the web course implies. */
function webJobs(course) {
  const list = [];
  Course.codeSamples(course).forEach((s) => {
    if (s.lang !== 'js' && s.lang !== 'html') return;
    list.push({
      where: s.where,
      kind: s.lang === 'js' ? 'js' : 'page',
      code: s.code,
      files: s.files,
      output: s.norun ? undefined : s.output,
      expect: s.error ? 'error' : 'run'
    });
  });

  const questionJobs = (q) => {
    if (q.type === 'output' && q.lang === 'js') {
      list.push({ where: q.id, kind: 'js', code: q.code, output: q.answer, expect: q._raw.error ? 'error' : 'run' });
    }
    if (q.type === 'fill' && q.lang === 'js' && q.output !== null && q.output !== undefined) {
      const filled = q.code.split('___').map((part, i, all) => part + (i < all.length - 1 ? q.blanks[i][0] : '')).join('');
      list.push({ where: q.id + ' (filled)', kind: 'js', code: filled, output: q.output, expect: 'run' });
    }
    if (q.type === 'order' && q.lang === 'js' && q.output !== null && q.output !== undefined) {
      list.push({ where: q.id + ' (ordered)', kind: 'js', code: q.lines.join('\n'), output: q.output, expect: 'run' });
    }
    if ((q.type === 'mcq' || q.type === 'tf') && q.code && q.lang === 'js' && q._raw.runs !== false) {
      list.push({ where: q.id + ' (code)', kind: 'js', code: q.code, expect: q._raw.error ? 'error' : 'run' });
    }
    if (q.type === 'code') taskJobs(q.task, q.id);
  };

  const taskJobs = (task, where, first) => {
    if (task.kind === 'page') {
      const given = task.given.length ? task.given : (first ? first.given : []);
      const starter = task.files.length ? task.files : (first ? first.files : []);
      list.push({ where: where + ' solution', kind: 'page', files: merge(merge(given, starter), task.solutionFiles), harness: task.harness, width: task.width, expect: 'pass' });
      if (task.files.length && task._raw.starter_fails !== false) {
        list.push({ where: where + ' starter', kind: 'page', files: merge(given, starter), harness: task.harness, width: task.width, expect: 'not-pass' });
      }
    } else {
      list.push({ where: where + ' solution', kind: 'js', code: task.solution, harness: task.harness, expect: 'pass' });
      if (task.starter && task._raw.starter_fails !== false) {
        list.push({ where: where + ' starter', kind: 'js', code: task.starter, harness: task.harness, expect: 'not-pass' });
      }
    }
  };

  course.items.forEach((item) => {
    (item.checks || []).forEach(questionJobs);
    (item.questions || []).forEach(questionJobs);
    (item.tasks || []).forEach((t) => taskJobs(t, t.id));
    if (item.task) taskJobs(item.task, item.id);
    if (item.build) {
      // A build-anything project: the example meets every ingredient; the starter doesn't.
      const b = item.build;
      const example = b.kind === 'page' ? merge(b.files, b.exampleFiles) : [{ name: 'main.js', content: b.example }];
      const starter = b.kind === 'page' ? b.files : [{ name: 'main.js', content: b.starter }];
      [['example', example, 'pass'], ['starter', starter, 'not-pass']].forEach(([label, mine, expect]) => {
        list.push({
          where: item.id + ' ' + label, kind: b.kind === 'page' ? 'page' : 'js', build: b, mine, expect,
          files: merge(b.given, mine), code: b.kind === 'page' ? undefined : mine[0].content,
          harness: Build.harness(b.requirements), width: b.width
        });
      });
    }
    if (item.video && item.video.view === 'page') {
      // Every selector a video points at, clicks or changes must find something.
      Video.targets(item.video).forEach((t) => {
        list.push({ where: item.id + ' step ' + t.step, kind: 'targets', html: t.html, sels: t.sels });
      });
    }
    if (item.video && item.video.view === 'console' && item.video.lang === 'js') {
      // The program a console video writes prints what the video shows.
      const prog = Video.program(item.video);
      list.push({ where: item.id + ' (program)', kind: 'js', code: prog.files[0].content, output: prog.output, expect: 'run', allowErrors: prog.errors });
    }
    (item.milestones || []).forEach((m, i) => {
      taskJobs(m, m.id, i > 0 ? item.milestones[0] : null);
      // Each milestone must ask for something new: the previous one's
      // solution should not already pass it.
      const prev = item.milestones[i - 1];
      if (!prev || m._raw.starter_fails === false) return;
      if (m.kind === 'page') {
        const first = item.milestones[0];
        const given = m.given.length ? m.given : first.given;
        list.push({ where: m.id + ' (previous solution)', kind: 'page', files: merge(merge(given, first.files), prev.solutionFiles), harness: m.harness, width: m.width, expect: 'not-pass' });
      } else if (m.kind === 'js') {
        list.push({ where: m.id + ' (previous solution)', kind: 'js', code: prev.solution, harness: m.harness, expect: 'not-pass' });
      }
    });
  });
  return list;
}

function findPlaywright() {
  const candidates = [process.env.AU_PLAYWRIGHT, 'playwright', '/opt/node22/lib/node_modules/playwright'].filter(Boolean);
  for (const name of candidates) {
    try { return require(name); } catch (e) { /* try the next */ }
  }
  return null;
}

/** A browser with Learn mode's scripts loaded, ready to run jobs. */
async function openBrowser() {
  const playwright = findPlaywright();
  if (!playwright) return null;
  const { createApp } = require('../server/index.js');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'au-web-course-'));
  const server = createApp({ dataDir, password: '', cpp: { backend: 'off' } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const launch = {};
  if (process.env.AU_CHROMIUM) launch.executablePath = process.env.AU_CHROMIUM;
  const browser = await playwright.chromium.launch(launch);
  const page = await browser.newPage();
  await page.goto(base + '/learn/does-not-exist.txt').catch(() => {});
  await page.setContent('<!doctype html><title>checks</title><body></body>');
  await page.addScriptTag({ url: base + '/compose.js' });
  await page.addScriptTag({ url: base + '/learn/web.js' });
  return {
    page,
    close: async () => {
      await browser.close();
      server.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  };
}

function cut(s, n = 300) {
  s = String(s);
  return s.length > n ? s.slice(0, n) + '…' : s;
}

/** Runs one job in the browser; returns a problem string or null. */
async function runWebJob(page, job) {
  if (job.kind === 'targets') {
    const missing = await page.evaluate((j) => {
      const doc = new DOMParser().parseFromString(j.html, 'text/html');
      return j.sels.filter((sel) => {
        try { return !doc.querySelector(sel); } catch (e) { return true; }
      });
    }, job);
    return missing.length ? `${job.where}: nothing on the page matches ${missing.map((m) => JSON.stringify(m)).join(', ')}` : null;
  }
  const r = await page.evaluate(async (j) => {
    const W = window.LearnWeb;
    const res = j.kind === 'js'
      ? await W.runJs({ code: j.code, harness: j.harness, timeoutMs: 8000 })
      : await W.runPage({ files: j.files, harness: j.harness, width: j.width || 800, timeoutMs: 10000 });
    return { output: W.outputText(res), all: W.allOutputText(res), errors: res.errors, checks: res.checks, done: res.done, timedOut: res.timedOut };
  }, job);
  const errs = r.errors.map((e) => `${e.message}${e.line ? ' (line ' + e.line + ')' : ''}`).join('; ');
  if (job.build) {
    const g = Build.grade(job.build.requirements, job.mine, { checks: r.checks, clean: r.done && !r.timedOut && !r.errors.length, output: r.all });
    const missing = g.checks.filter((c) => !c.ok).map((c) => c.expr).join('; ');
    if (job.expect === 'pass' && !g.ok) return `${job.where}: misses ${missing}${errs ? ' | errors: ' + cut(errs) : ''}`;
    if (job.expect === 'not-pass' && g.ok) return `${job.where}: already meets every requirement`;
    return null;
  }
  if (job.expect === 'pass' || job.expect === 'not-pass') {
    const syntax = r.errors.some((e) => e.where === 'syntax');
    const passed = !syntax && r.done && r.checks.length > 0 && r.checks.every((c) => c.ok) && !r.errors.some((e) => e.where === 'checks');
    if (job.expect === 'pass' && !passed) {
      const bad = r.checks.filter((c) => !c.ok).map((c) => `${c.expr}: got ${c.got}, want ${c.want}`).join('; ');
      return `${job.where}: solution fails — ${bad || '(no failed checks)'}${errs ? ' | errors: ' + cut(errs) : ''}${r.timedOut ? ' | TIMED OUT' : ''}${r.checks.length ? '' : ' | no checks ran'}`;
    }
    if (job.expect === 'pass' && r.errors.length) return `${job.where}: solution passes but reports errors: ${cut(errs)}`;
    if (job.expect === 'not-pass' && passed) return `${job.where}: already passes every check`;
    return null;
  }
  if (r.timedOut) return `${job.where}: timed out`;
  if (job.expect === 'error') {
    return r.errors.length ? null : `${job.where}: marked as an error example but it runs cleanly`;
  }
  if (r.errors.length && !job.allowErrors) return `${job.where}: errors: ${cut(errs)}`;
  if (job.allowErrors && !r.errors.length) return `${job.where}: the video shows an error, but the code runs cleanly`;
  if (job.output !== undefined) {
    const cmp = Engine.compareOutput(r.output, job.output);
    if (!cmp.ok) return `${job.where}: console differs at line ${cmp.line}: got ${JSON.stringify(cmp.got)}, want ${JSON.stringify(cmp.want)}`;
  }
  return null;
}

async function checkWebAll(page, list, concurrency = 4, onProgress) {
  const problems = [];
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < list.length) {
      const job = list[next];
      next += 1;
      try {
        const problem = await runWebJob(page, job);
        if (problem) problems.push(problem);
      } catch (err) {
        problems.push(`${job.where}: ${err.message}`);
      }
      done += 1;
      if (onProgress) onProgress(done, list.length);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return problems;
}

module.exports = { loadWebCourses, loadCourseAt, courseDirs, webJobs, openBrowser, runWebJob, checkWebAll };

if (require.main === module) {
  (async () => {
    const only = process.argv.slice(2);
    const loaded = loadWebCourses(only);
    let structure = 0;
    const list = [];
    loaded.forEach(({ course, missing }) => {
      if (missing.length) console.log(`${course.id}: missing chapter files: ${missing.join(', ')}`);
      Course.validate(course).forEach((p) => { structure += 1; console.log('STRUCTURE', course.id, p); });
      list.push(...webJobs(course));
    });
    const browser = await openBrowser();
    if (!browser) { console.log('Playwright is not installed: skipping the browser checks'); process.exitCode = structure ? 1 : 0; return; }
    const started = Date.now();
    const found = await checkWebAll(browser.page, list, 4, (d, n) => {
      if (d % 25 === 0 || d === n) process.stdout.write(`\r${d}/${n} checked`);
    });
    await browser.close();
    console.log(`\n${list.length} browser checks in ${((Date.now() - started) / 1000).toFixed(1)}s`);
    found.forEach((p) => console.log('CODE', p));
    console.log(structure + found.length ? `${structure + found.length} problem(s)` : 'All good');
    process.exitCode = structure + found.length ? 1 : 0;
  })();
}
