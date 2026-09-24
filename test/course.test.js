'use strict';

// Compiles and runs every example, question and exercise in the course:
// samples print what they claim, solutions pass their tests, starters don't.
// It takes a few minutes, so it only runs when asked:
//   AU_COURSE_CHECK=1 npm test      (or: node test/course-lib.js [ch05 ...])

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

test('every code sample, question and exercise in the course works', { skip, timeout: 30 * 60 * 1000 }, async () => {
  const lib = require('./course-lib.js');
  const { course, missing } = lib.loadCourse();
  assert.deepStrictEqual(missing, []);
  const problems = await lib.checkAll(lib.makeRunners(), lib.jobs(course), 4);
  assert.deepStrictEqual(problems, []);
});
