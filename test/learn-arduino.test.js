'use strict';

// The simulated Arduino (public/learn/arduino.js): what gets compiled, and
// how a run's pin events are read back. The sketches in the course itself are
// checked by course.test.js.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const Arduino = require('../public/learn/arduino.js');
const Engine = require('../public/learn/engine.js');

const CXX = process.env.AU_CXX || 'g++';
let hasCompiler = true;
try {
  execFileSync(CXX, ['--version'], { stdio: 'ignore' });
} catch {
  hasCompiler = false;
}
const options = { skip: hasCompiler ? false : 'no C++ compiler installed' };

/** Compiles like Learn does (warnings on) and runs with the given input. */
function run(code, stdin, harness) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'au-ard-'));
  try {
    const src = Arduino.wrap(harness ? Engine.buildChecked(code, harness, '') : code);
    fs.writeFileSync(path.join(dir, 'main.cpp'), src);
    const c = spawnSync(CXX, ['-std=c++17', '-O1', '-Wall', '-Wextra', '-pedantic', 'main.cpp', '-o', 'main'], { cwd: dir, encoding: 'utf8' });
    assert.strictEqual(c.status, 0, c.stderr);
    assert.strictEqual(c.stderr, '', 'the simulator compiles without warnings');
    const r = spawnSync(path.join(dir, 'main'), { input: stdin || '', encoding: 'utf8' });
    return { stdout: r.stdout, board: Arduino.parseEvents(r.stderr) };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('isSketch and wrap: a sketch gets a main, a program or a checked function does not', () => {
  assert.ok(Arduino.isSketch('void setup() {}\nvoid loop() {}'));
  assert.ok(Arduino.isSketch('void loop() { }'), 'loop alone is enough');
  assert.ok(!Arduino.isSketch('int twice(int x) { return 2 * x; }'));
  assert.ok(!Arduino.isSketch('void setup() {}\nint main() { return 0; }'));

  const wrapped = Arduino.wrap('#include <Servo.h>\nvoid setup() {}\nvoid loop() {}');
  assert.match(wrapped, /#line 1 "main\.cpp"\n\/\/ #include <Servo\.h> \(provided\)\nvoid setup/, 'library includes are provided, and line 1 stays line 1');
  assert.match(wrapped, /#line 1 "Arduino-main\.h"/);
  assert.doesNotMatch(Arduino.wrap('int twice(int x) { return 2 * x; }'), /Arduino-main/);
});

test('parseEvents splits pin events from warnings, and stateAt replays them', () => {
  const stderr = '\x1e0 13 D1\n\x1e500 13 D0\nWarning: something\n\x1e700 9 P128\n\x1e800 20 V90\n\x1eEND 1000\n';
  const board = Arduino.parseEvents(stderr);
  assert.strictEqual(board.events.length, 4);
  assert.deepStrictEqual(board.events[2], { ms: 700, pin: 9, kind: 'P', value: 128 });
  assert.strictEqual(board.end, 1000);
  assert.strictEqual(board.rest, 'Warning: something');

  const at600 = Arduino.stateAt(board.events, 600);
  assert.deepStrictEqual(at600.map((p) => [p.pin, p.value]), [[9, 0], [13, 0], [20, 0]]);
  assert.strictEqual(at600.find((p) => p.pin === 13).changes, 2);
  assert.deepStrictEqual(Arduino.stateAt(board.events, 900).map((p) => p.value), [128, 0, 90]);
  assert.strictEqual(Arduino.pinName(14), 'A0');
  assert.strictEqual(Arduino.pinName(13), '13');
  assert.strictEqual(Arduino.parseEvents('\x1e5 2 D1').end, 5, 'without END the run lasts until the last event');
});

test('simulated time: delay takes no real time, and trace prints pin changes', options, () => {
  const blink = 'void setup() { pinMode(13, OUTPUT); }\nvoid loop() { digitalWrite(13, HIGH); delay(1000); digitalWrite(13, LOW); delay(1000); }';
  const started = Date.now();
  const r = run(blink, 'trace\nrun 2500\n');
  assert.ok(Date.now() - started < 10000);
  assert.strictEqual(r.stdout, '[0 ms] pin 13 HIGH\n[1000 ms] pin 13 LOW\n[2000 ms] pin 13 HIGH\n');
  assert.strictEqual(r.board.end, 2500);
  assert.strictEqual(r.board.events.length, 3);
  assert.strictEqual(run(blink).board.end, 10000, 'a run lasts 10 simulated seconds by default');
});

test('inputs: buttons, sensors and serial text arrive at their times', options, () => {
  const sketch = [
    'int last = HIGH;',
    'void setup() { Serial.begin(9600); pinMode(2, INPUT_PULLUP); }',
    'void loop() {',
    '  int now = digitalRead(2);',
    '  if (now == LOW && last == HIGH) { Serial.print("press at "); Serial.println(millis()); Serial.println(analogRead(A0)); }',
    '  last = now;',
    '  if (Serial.available() > 0) Serial.println("got " + Serial.readStringUntil(\'\\n\'));',
    '}'
  ].join('\n');
  const r = run(sketch, '2 LOW @300\n2 HIGH @400\nA0 612 @350\n2 LOW @500\nserial hi there @600\nrun 700\n');
  assert.strictEqual(r.stdout, 'press at 300\n0\npress at 500\n612\ngot hi there\n');
});

test('PWM, servo, tone and shiftOut are reported once per change', options, () => {
  const sketch = [
    '#include <Servo.h>',
    'Servo s;',
    'void setup() { s.attach(6); pinMode(11, OUTPUT); }',
    'void loop() {',
    '  analogWrite(9, millis() < 50 ? 64 : 255);',
    '  s.write(200);',
    '  tone(8, 440);',
    '  shiftOut(11, 12, LSBFIRST, 0b00000011);',
    '  delay(20);',
    '}'
  ].join('\n');
  const r = run(sketch, 'trace\nrun 70\n');
  const lines = r.stdout.trim().split('\n');
  assert.deepStrictEqual(lines.filter((l) => !/shiftOut/.test(l)), [
    '[0 ms] pin 9 PWM 64',
    '[0 ms] servo on pin 6 at 180 degrees',
    '[0 ms] tone on pin 8: 440 Hz',
    '[60 ms] pin 9 PWM 255'
  ], 'the same value written again is not news; a servo stops at 180');
  assert.strictEqual(lines.filter((l) => /shiftOut 11000000/.test(l)).length, 4, 'LSBFIRST reverses the bits, and every shiftOut counts');
});

test('warnings: an output pin that was never set up', options, () => {
  const r = run('void setup() { digitalWrite(7, HIGH); }\nvoid loop() {}', '');
  assert.match(r.board.rest, /pinMode\(7, OUTPUT\) was never called/);
});

test('checked functions: CHECK sees Arduino Strings and Serial output', options, () => {
  const code = 'String label(int v) { return String("T") + v; }\nvoid show(int v) { Serial.println(v, HEX); }';
  const r = run(code, '', 'CHECK(label(5), "T5");\nCHECK(OUTPUT(show(255)), "FF\\n");\nCHECK(label(1), "T2");');
  const checks = Engine.parseChecked(r.stdout).checks;
  assert.deepStrictEqual(checks.map((c) => c.ok), [true, true, false]);
  assert.strictEqual(checks[2].got, '"T1"', 'a String shows in quotes');
});
