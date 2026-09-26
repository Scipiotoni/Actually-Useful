'use strict';

// Compiles and runs every example, question and exercise in the C++ course:
// samples print what they claim, solutions pass their tests, starters don't.
// The HTML, CSS and JavaScript courses get the same treatment in a real
// browser (Chromium, through Playwright). It takes a few minutes, so it only
// runs when asked:
//   AU_COURSE_CHECK=1 npm test      (or: node test/course-lib.js [ch05 ...]
//                                     and node test/web-course-lib.js [css ...])

const test = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');

let hasCompiler = true;
try {
  execFileSync(process.env.AU_CXX || 'g++', ['--version'], { stdio: 'ignore' });
} catch {
  hasCompiler = false;
}

let skip = false;
if (!process.env.AU_COURSE_CHECK) skip = 'set AU_COURSE_CHECK=1 to compile the whole course';
else if (!hasCompiler) skip = 'no C++ compiler installed';

test('every code sample, question and exercise in the C++ and Arduino courses works', { skip, timeout: 30 * 60 * 1000 }, async () => {
  const lib = require('./course-lib.js');
  const jobs = [];
  for (const dir of lib.cppCourseDirs()) {
    const { course, missing } = lib.loadCourse(null, dir);
    assert.deepStrictEqual(missing, [], `${course.id} lists chapters that have no file`);
    jobs.push(...lib.jobs(course));
  }
  const problems = await lib.checkAll(lib.makeRunners(), jobs, 4);
  assert.deepStrictEqual(problems, []);
});

test('every example and exercise in the HTML, CSS and JavaScript courses works in a browser', { timeout: 20 * 60 * 1000 }, async (t) => {
  if (!process.env.AU_COURSE_CHECK) return t.skip('set AU_COURSE_CHECK=1 to check the web courses');
  const lib = require('./web-course-lib.js');
  const browser = await lib.openBrowser();
  if (!browser) return t.skip('Playwright with Chromium is not installed');
  try {
    const jobs = [];
    for (const { course, missing } of lib.loadWebCourses()) {
      assert.deepStrictEqual(missing, [], `${course.id} lists chapters that have no file`);
      jobs.push(...lib.webJobs(course));
    }
    assert.ok(jobs.length > 700, 'the web courses have their exercises');
    const problems = await lib.checkWebAll(browser.page, jobs, 4);
    assert.deepStrictEqual(problems, []);
  } finally {
    await browser.close();
  }
});
