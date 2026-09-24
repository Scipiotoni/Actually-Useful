'use strict';

/**
 * Loads the Learn course from disk and checks that every piece of code in it
 * really does what the course says: examples compile and print what is shown,
 * predicted outputs are right, every solution passes its own tests and every
 * starter does not. Used by course.test.js, and runnable on its own:
 *
 *   node test/course-lib.js            check everything
 *   node test/course-lib.js ch03 ch04  check some chapters
 */

const fs = require('fs');
const path = require('path');
const Course = require('../public/learn/course.js');
const Engine = require('../public/learn/engine.js');

const DIR = path.join(__dirname, '..', 'public', 'learn', 'course');

function loadCourse(only) {
  const index = Course.parseYaml(fs.readFileSync(path.join(DIR, 'course.yml'), 'utf8'), 'course.yml');
  let names = index.chapters || [];
  const missing = names.filter((n) => !fs.existsSync(path.join(DIR, n + '.yml')));
  if (only && only.length) names = names.filter((n) => only.includes(n));
  const present = names.filter((n) => fs.existsSync(path.join(DIR, n + '.yml')));
  const docs = present.map((n) => Course.parseYaml(fs.readFileSync(path.join(DIR, n + '.yml'), 'utf8'), n + '.yml'));
  let glossary = null;
  if (fs.existsSync(path.join(DIR, 'glossary.yml'))) {
    glossary = Course.parseYaml(fs.readFileSync(path.join(DIR, 'glossary.yml'), 'utf8'), 'glossary.yml');
  }
  return { course: Course.buildCourse(index, docs, { glossary }), missing };
}

const isProgram = (code) => /\bint\s+main\s*\(/.test(code);

/** Every compile-and-run job the course implies. */
function jobs(course) {
  const list = [];
  const std = (x) => (x && x.std === 'c++20' ? 'c++20' : 'c++17');

  Course.codeSamples(course).forEach((s) => {
    list.push({
      where: s.where,
      std: s.std || 'c++17',
      source: s.code,
      stdin: s.stdin,
      expect: s.error ? 'compile-error' : 'run',
      output: s.norun ? undefined : (s.ub ? s.output : s.output),
      ub: s.ub || s.norun
    });
  });

  const questionJobs = (q) => {
    if (q.type === 'output') {
      // warnings: true marks a question whose code is meant to draw a warning.
      list.push({ where: q.id, std: std(q), source: q.code, stdin: q.stdin, expect: 'run', output: q.answer, ub: q._raw.warnings === true, keepOutput: true });
    }
    if (q.type === 'fill' && isProgram(q.code)) {
      const filled = q.code.split('___').map((part, i, all) => part + (i < all.length - 1 ? q.blanks[i][0] : '')).join('');
      list.push({ where: q.id + ' (filled)', std: std(q), source: filled, stdin: q.stdin, expect: 'run', output: q.output === null ? undefined : q.output });
    }
    if (q.type === 'order' && isProgram(q.lines.join('\n'))) {
      list.push({ where: q.id + ' (ordered)', std: std(q), source: q.lines.join('\n'), stdin: q.stdin, expect: 'run', output: q.output === null ? undefined : q.output });
    }
    if ((q.type === 'mcq' || q.type === 'tf') && q.code && isProgram(q.code) && q._raw.compiles !== false) {
      list.push({ where: q.id + ' (code)', std: std(q), source: q.code, stdin: q.stdin, expect: q._raw.compiles === 'error' ? 'compile-error' : 'compile', ub: q._raw.warnings === true });
    }
    if (q.type === 'code') taskJobs(q.task, q.id);
  };

  const taskJobs = (task, where) => {
    const build = (code) => (task.harness ? Engine.buildChecked(code, task.harness, task.harnessPre) : code);
    list.push({ where: where + ' solution', std: std(task), source: build(task.solution), task, expect: 'pass' });
    if (task.starter && task._raw.starter_fails !== false) {
      list.push({ where: where + ' starter', std: std(task), source: build(task.starter), task, expect: 'not-pass', allowCompileError: Boolean(task._raw.starter_broken) });
    }
  };

  course.items.forEach((item) => {
    (item.checks || []).forEach(questionJobs);
    (item.questions || []).forEach(questionJobs);
    (item.tasks || []).forEach((t) => taskJobs(t, t.id));
    if (item.task) taskJobs(item.task, item.id);
    (item.milestones || []).forEach((m, i) => {
      const task = Object.assign({}, m, { starter: m.starter || (i === 0 ? m.starter : '') });
      taskJobs(task, m.id);
    });
  });
  return list;
}

function cut(s, n = 300) {
  s = String(s);
  return s.length > n ? s.slice(0, n) + '…' : s;
}

/** Runs one job; returns a problem string or null. */
async function runJob(runners, job) {
  const runner = runners[job.std] || runners['c++17'];
  if (job.task) {
    const task = job.task;
    let data;
    if (task.harness) {
      data = await runner.run({ source: job.source, timeoutMs: 8000 });
    } else {
      data = await runner.run({ source: job.source, inputs: task.tests.map((t) => t.input), timeoutMs: 8000 });
    }
    if (!data.compile.ok) {
      if (job.expect === 'not-pass' && job.allowCompileError) return null;
      return `${job.where}: does not compile\n${cut(data.compile.output, 1200)}`;
    }
    let passed;
    let detail = '';
    if (task.harness) {
      const parsed = Engine.parseChecked(data.runs[0].stdout);
      passed = parsed.done && parsed.checks.length > 0 && parsed.checks.every((c) => c.ok);
      const bad = parsed.checks.filter((c) => !c.ok);
      detail = bad.map((c) => `${c.expr}: got ${c.got}, want ${c.want}`).join('; ') + (parsed.done ? '' : ' (did not finish: ' + cut(data.runs[0].stderr) + ' signal ' + data.runs[0].signal + ')');
    } else {
      const results = task.tests.map((t, i) => {
        const run = data.runs[i];
        const cmp = Engine.compareOutput(run.stdout, t.output);
        return { ok: cmp.ok && !run.timedOut && !run.signal, t, run, cmp };
      });
      passed = results.every((r) => r.ok);
      detail = results.filter((r) => !r.ok).map((r) => `test in=${JSON.stringify(cut(r.t.input, 60))}: line ${r.cmp.line} got ${JSON.stringify(r.cmp.got)} want ${JSON.stringify(r.cmp.want)}${r.run.timedOut ? ' TIMEOUT' : ''}${r.run.signal ? ' ' + r.run.signal : ''}`).join('\n  ');
    }
    if (job.expect === 'pass' && !passed) return `${job.where}: solution fails its tests\n  ${detail}`;
    if (job.expect === 'not-pass' && passed) return `${job.where}: the starter code already passes every test`;
    const warnings = (data.compile.output || '').split('\n').filter((l) => /warning:/.test(l) && !/checks\.cpp/.test(l));
    if (job.expect === 'pass' && warnings.length) return `${job.where}: solution compiles with warnings\n  ${warnings.slice(0, 3).join('\n  ')}`;
    return null;
  }

  const data = await runner.run({ source: job.source, stdin: job.stdin || '', timeoutMs: 8000 });
  if (job.expect === 'compile-error') {
    return data.compile.ok ? `${job.where}: marked as an error example but it compiles` : null;
  }
  if (!data.compile.ok) return `${job.where}: does not compile\n${cut(data.compile.output, 1200)}`;
  const warnings = (data.compile.output || '').split('\n').filter((l) => /warning:/.test(l));
  if (warnings.length && !job.ub) return `${job.where}: compiles with warnings (mark the block "ub" if intended)\n  ${warnings.slice(0, 3).join('\n  ')}`;
  if (job.expect === 'compile') return null;
  const run = data.runs[0];
  if (run.timedOut) return `${job.where}: timed out`;
  if (job.output !== undefined) {
    const cmp = Engine.compareOutput(run.stdout, job.output);
    if (!cmp.ok) return `${job.where}: output differs at line ${cmp.line}: got ${JSON.stringify(cmp.got)}, want ${JSON.stringify(cmp.want)}`;
  }
  return null;
}

async function checkAll(runners, list, concurrency = 4, onProgress) {
  const problems = [];
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < list.length) {
      const job = list[next];
      next += 1;
      try {
        const problem = await runJob(runners, job);
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

function makeRunners() {
  const { createRunner } = require('../server/cpp.js');
  return {
    'c++17': createRunner({ backend: 'local', std: 'c++17', concurrency: 4 }),
    'c++20': createRunner({ backend: 'local', std: 'c++20', concurrency: 4 })
  };
}

module.exports = { loadCourse, jobs, checkAll, makeRunners, DIR };

if (require.main === module) {
  (async () => {
    const only = process.argv.slice(2);
    const { course, missing } = loadCourse(only);
    const problems = Course.validate(course);
    if (missing.length) console.log('Missing chapter files:', missing.join(', '));
    problems.forEach((p) => console.log('STRUCTURE', p));
    const list = jobs(course);
    const runners = makeRunners();
    const status = await runners['c++17'].status();
    if (!status.available) { console.log('No compiler: skipping code checks'); return; }
    const started = Date.now();
    const found = await checkAll(runners, list, 4, (d, n) => {
      if (d % 25 === 0 || d === n) process.stdout.write(`\r${d}/${n} checked`);
    });
    console.log(`\n${list.length} code checks in ${((Date.now() - started) / 1000).toFixed(1)}s`);
    found.forEach((p) => console.log('CODE', p));
    console.log(problems.length + found.length ? `${problems.length + found.length} problem(s)` : 'All good');
    process.exitCode = problems.length + found.length ? 1 : 0;
  })();
}
