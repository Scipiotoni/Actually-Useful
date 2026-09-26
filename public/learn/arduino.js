/*
 * A simulated Arduino Uno, for the Arduino course. Real hardware can't be
 * plugged into a web page, so a sketch is compiled with the ordinary C++
 * compiler together with this small "Arduino.h": the same functions an Uno
 * offers (pinMode, digitalWrite, delay, Serial, analogRead, analogWrite,
 * millis, shiftOut, Servo…), acting on a board that exists only in memory.
 *
 *   - Time is simulated: delay(1000) takes no real time, so a sketch that
 *     blinks for ten seconds finishes at once. A run lasts 10 simulated
 *     seconds unless the input says otherwise.
 *   - Serial prints go to the program's output — the Serial Monitor.
 *   - Every change of an output pin is reported on stderr as an event, which
 *     Learn draws on a board you can replay (parseEvents), and — with `trace`
 *     in the input — also printed, so exercises can check what the pins did.
 *   - Inputs are a script in the program's input box, one line each:
 *       2 LOW @1500      pin 2 reads LOW from 1.5 s on (buttons, switches)
 *       A0 612           analogRead(A0) gives 612 (a sensor, a knob)
 *       serial hello @0  "hello" arrives on the serial port
 *       run 3000         simulate 3 seconds instead of 10
 *       trace            print every pin change as it happens
 *
 * wrap() puts the simulator in front of the learner's code. #line keeps error
 * messages pointing at their own lines. Shared by Learn and the course checks.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LearnArduino = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var HEADER = [
    '#include <cstdio>',
    '#include <iostream>',
    '#include <cstdlib>',
    '#include <cstring>',
    '#include <cctype>',
    '#include <cstdint>',
    '#include <cmath>',
    '#include <string>',
    '#include <vector>',
    '#include <algorithm>',
    '',
    'typedef uint8_t byte;',
    'typedef bool boolean;',
    'typedef unsigned int word;',
    '// Constants, not macros, so they never clash with other names.',
    'constexpr int HIGH = 0x1;',
    'constexpr int LOW = 0x0;',
    'constexpr int INPUT = 0x0;',
    'constexpr int OUTPUT = 0x1;',
    'constexpr int INPUT_PULLUP = 0x2;',
    'constexpr int LED_BUILTIN = 13;',
    'constexpr int A0 = 14;',
    'constexpr int A1 = 15;',
    'constexpr int A2 = 16;',
    'constexpr int A3 = 17;',
    'constexpr int A4 = 18;',
    'constexpr int A5 = 19;',
    'constexpr int DEC = 10;',
    'constexpr int HEX = 16;',
    'constexpr int OCT = 8;',
    'constexpr int BIN = 2;',
    'constexpr int LSBFIRST = 0;',
    'constexpr int MSBFIRST = 1;',
    '#define PI 3.1415926535897932384626433832795',
    '#define HALF_PI 1.5707963267948966192313216916398',
    '#define TWO_PI 6.283185307179586476925286766559',
    '#define F(text) (text)',
    '#define PROGMEM',
    '#define bitRead(value, b) (((value) >> (b)) & 0x01)',
    '#define bitSet(value, b) ((value) |= (1UL << (b)))',
    '#define bitClear(value, b) ((value) &= ~(1UL << (b)))',
    '#define bitWrite(value, b, v) ((v) ? bitSet(value, b) : bitClear(value, b))',
    '#define bit(b) (1UL << (b))',
    '#define lowByte(w) ((uint8_t) ((w) & 0xff))',
    '#define highByte(w) ((uint8_t) ((w) >> 8))',
    '#define sq(x) ((x) * (x))',
    '',
    'template <class T, class U> auto min(T a, U b) -> decltype(a < b ? a : b) { return b < a ? b : a; }',
    'template <class T, class U> auto max(T a, U b) -> decltype(a < b ? a : b) { return a < b ? b : a; }',
    'template <class T, class L, class H> T constrain(T x, L low, H high) { return x < low ? T(low) : (x > high ? T(high) : x); }',
    'inline long map(long x, long inMin, long inMax, long outMin, long outMax) {',
    '  return (x - inMin) * (outMax - outMin) / (inMax - inMin) + outMin;',
    '}',
    '',
    '// Arduino\'s String, the parts beginners use.',
    'class String {',
    ' public:',
    '  std::string s;',
    '  String() {}',
    '  String(const char* c) : s(c ? c : "") {}',
    '  String(const std::string& x) : s(x) {}',
    '  explicit String(char c) : s(1, c) {}',
    '  String(int v, int base = 10) : s(number((long long) v, base)) {}',
    '  String(unsigned int v, int base = 10) : s(number((long long) v, base)) {}',
    '  String(long v, int base = 10) : s(number((long long) v, base)) {}',
    '  String(unsigned long v, int base = 10) : s(number((long long) v, base)) {}',
    '  String(double v, int decimals = 2) : s(fixed(v, decimals)) {}',
    '  static std::string number(long long v, int base) {',
    '    if (base == 10) return std::to_string(v);',
    '    unsigned long long u = v < 0 ? (unsigned long long) (uint32_t) v : (unsigned long long) v;',
    '    if (u == 0) return "0";',
    '    std::string out;',
    '    while (u) { int d = (int) (u % base); out.insert(out.begin(), (char) (d < 10 ? \'0\' + d : \'A\' + d - 10)); u /= base; }',
    '    return out;',
    '  }',
    '  static std::string fixed(double v, int decimals) {',
    '    char buf[64];',
    '    std::snprintf(buf, sizeof buf, "%.*f", decimals < 0 ? 0 : decimals, v);',
    '    return buf;',
    '  }',
    '  unsigned int length() const { return (unsigned int) s.size(); }',
    '  const char* c_str() const { return s.c_str(); }',
    '  long toInt() const { return std::atol(s.c_str()); }',
    '  float toFloat() const { return (float) std::atof(s.c_str()); }',
    '  char charAt(unsigned int i) const { return i < s.size() ? s[i] : 0; }',
    '  char operator[](unsigned int i) const { return charAt(i); }',
    '  int indexOf(char c) const { size_t i = s.find(c); return i == std::string::npos ? -1 : (int) i; }',
    '  int indexOf(const String& t) const { size_t i = s.find(t.s); return i == std::string::npos ? -1 : (int) i; }',
    '  String substring(unsigned int from) const { return from < s.size() ? String(s.substr(from)) : String(); }',
    '  String substring(unsigned int from, unsigned int to) const { return from < to && from < s.size() ? String(s.substr(from, to - from)) : String(); }',
    '  bool startsWith(const String& t) const { return s.compare(0, t.s.size(), t.s) == 0; }',
    '  bool endsWith(const String& t) const { return s.size() >= t.s.size() && s.compare(s.size() - t.s.size(), t.s.size(), t.s) == 0; }',
    '  bool equals(const String& t) const { return s == t.s; }',
    '  void toUpperCase() { for (char& c : s) c = (char) std::toupper((unsigned char) c); }',
    '  void toLowerCase() { for (char& c : s) c = (char) std::tolower((unsigned char) c); }',
    '  void trim() { size_t a = s.find_first_not_of(" \\t\\r\\n"); size_t b = s.find_last_not_of(" \\t\\r\\n"); s = a == std::string::npos ? "" : s.substr(a, b - a + 1); }',
    '  String& operator+=(const String& t) { s += t.s; return *this; }',
    '  String& operator+=(const char* t) { s += t; return *this; }',
    '  String& operator+=(char c) { s += c; return *this; }',
    '  bool operator==(const String& t) const { return s == t.s; }',
    '  bool operator==(const char* t) const { return s == t; }',
    '  bool operator!=(const String& t) const { return s != t.s; }',
    '  bool operator!=(const char* t) const { return s != t; }',
    '};',
    'inline String operator+(const String& a, const String& b) { return String(a.s + b.s); }',
    'inline String operator+(const String& a, const char* b) { return String(a.s + b); }',
    'inline String operator+(const char* a, const String& b) { return String(a + b.s); }',
    'inline String operator+(const String& a, char b) { return String(a.s + b); }',
    'inline String operator+(const String& a, int b) { return a + String(b); }',
    'inline String operator+(const String& a, long b) { return a + String(b); }',
    'inline String operator+(const String& a, unsigned long b) { return a + String(b); }',
    'inline String operator+(const String& a, double b) { return a + String(b); }',
    '// So a check can show a String it got: "Temp: 21"',
    'inline std::ostream& operator<<(std::ostream& o, const String& t) { return o << \'"\' << t.s << \'"\'; }',
    '',
    '// The simulated board.',
    'namespace sim {',
    'struct Change { unsigned long long at; int pin; int value; std::string text; };',
    'inline unsigned long long& now() { static unsigned long long t = 0; return t; }',
    'inline unsigned long long& limit() { static unsigned long long t = 10000000ULL; return t; }',
    'inline bool& tracing() { static bool on = false; return on; }',
    'inline bool& harness() { static bool on = false; return on; }',
    'inline int* modes() { static int m[20] = {0}; return m; }',
    'inline int* outs() { static int o[20] = {0}; return o; }',
    'inline int* ins() { static int v[20] = {0}; return v; }',
    'inline bool* scripted() { static bool b[20] = {false}; return b; }',
    'inline bool* warned() { static bool w[20] = {false}; return w; }',
    'inline std::vector<Change>& script() { static std::vector<Change> s; return s; }',
    'inline size_t& nextChange() { static size_t n = 0; return n; }',
    'inline std::string& serialIn() { static std::string s; return s; }',
    'inline long& printedLines() { static long n = 0; return n; }',
    'inline int pinIndex(int pin) { return pin >= 0 && pin < 20 ? pin : -1; }',
    'inline const char* pinName(int pin) { static char name[16]; if (pin >= 14) std::snprintf(name, sizeof name, "A%d", pin - 14); else std::snprintf(name, sizeof name, "%d", pin); return name; }',
    'inline void applyScript() {',
    '  std::vector<Change>& s = script();',
    '  while (nextChange() < s.size() && s[nextChange()].at <= now()) {',
    '    const Change& c = s[nextChange()];',
    '    if (c.pin < 0) serialIn() += c.text + "\\n";',
    '    else { ins()[c.pin] = c.value; scripted()[c.pin] = true; }',
    '    nextChange() += 1;',
    '  }',
    '}',
    'inline void finish() {',
    '  std::fprintf(stderr, "\\x1e" "END %llu\\n", now() / 1000ULL);',
    '  std::cout.flush();',
    '  std::fflush(stdout);',
    '  std::fflush(stderr);',
    '  std::exit(0);',
    '}',
    'inline void advance(unsigned long long us) {',
    '  unsigned long long end = now() + us;',
    '  if (!harness() && end >= limit()) { now() = limit(); applyScript(); finish(); }',
    '  now() = end;',
    '  applyScript();',
    '}',
    'inline long& eventCount() { static long n = 0; return n; }',
    'inline bool unchanged(int pin, char kind, long value) {',
    '  // PWM, servo and tone are often written on every pass of loop(): only a new value is news.',
    '  static long last[3][32];',
    '  static bool ready = false;',
    '  if (!ready) { for (auto& row : last) for (long& v : row) v = -1; ready = true; }',
    '  int k = kind == \'P\' ? 0 : kind == \'V\' ? 1 : kind == \'T\' ? 2 : -1;',
    '  if (k < 0 || pin < 0 || pin >= 32) return false;',
    '  if (last[k][pin] == value) return true;',
    '  last[k][pin] = value;',
    '  return false;',
    '}',
    'inline void event(int pin, char kind, long value) {',
    '  if (unchanged(pin, kind, value)) return;',
    '  // A pin switched thousands of times (no delay) would flood the output.',
    '  eventCount() += 1;',
    '  if (eventCount() > 3000) {',
    '    if (eventCount() == 3001) std::fprintf(stderr, "Warning: more than 3000 pin changes; the rest are not shown. Is a delay() missing?\\n");',
    '    return;',
    '  }',
    '  std::fprintf(stderr, "\\x1e%llu %d %c%ld\\n", now() / 1000ULL, pin, kind, value);',
    '  if (tracing()) {',
    '    char line[96] = "";',
    '    if (kind == \'D\') { std::snprintf(line, sizeof line, "[%llu ms] pin %s %s\\n", now() / 1000ULL, pinName(pin), value ? "HIGH" : "LOW"); std::cout << line; }',
    '    else if (kind == \'P\') { std::snprintf(line, sizeof line, "[%llu ms] pin %s PWM %ld\\n", now() / 1000ULL, pinName(pin), value); std::cout << line; }',
    '    else if (kind == \'V\') { std::snprintf(line, sizeof line, "[%llu ms] servo on pin %s at %ld degrees\\n", now() / 1000ULL, pinName(pin), value); std::cout << line; }',
    '    else if (kind == \'T\') { std::snprintf(line, sizeof line, "[%llu ms] tone on pin %s: %ld Hz\\n", now() / 1000ULL, pinName(pin), value); std::cout << line; }',
    '    else if (kind == \'S\') {',
    '      char bits[9]; for (int i = 0; i < 8; i++) bits[i] = (value >> (7 - i)) & 1 ? \'1\' : \'0\'; bits[8] = 0;',
    '      std::snprintf(line, sizeof line, "[%llu ms] shiftOut %s\\n", now() / 1000ULL, bits); std::cout << line;',
    '    }',
    '  }',
    '}',
    'inline void warnOnce(int pin, const char* what) {',
    '  int i = pinIndex(pin);',
    '  if (i < 0 || warned()[i]) return;',
    '  warned()[i] = true;',
    '  std::fprintf(stderr, "Warning: %s\\n", what);',
    '}',
    'inline int parsePin(const char* word) {',
    '  if (word[0] == \'A\' || word[0] == \'a\') return 14 + std::atoi(word + 1);',
    '  return std::atoi(word);',
    '}',
    'inline void start() {',
    '  char line[512];',
    '  while (std::fgets(line, sizeof line, stdin)) {',
    '    char* at = std::strchr(line, \'@\');',
    '    unsigned long long when = 0;',
    '    if (at) { when = std::strtoull(at + 1, nullptr, 10) * 1000ULL; *at = 0; }',
    '    char word[64] = "";',
    '    char rest[448] = "";',
    '    if (std::sscanf(line, "%63s %447[^\\n]", word, rest) < 1) continue;',
    '    std::string text(rest);',
    '    while (!text.empty() && (text.back() == \' \' || text.back() == \'\\r\')) text.pop_back();',
    '    Change c{when, 0, 0, ""};',
    '    if (!std::strcmp(word, "trace")) { tracing() = true; continue; }',
    '    if (!std::strcmp(word, "run")) { limit() = std::strtoull(rest, nullptr, 10) * 1000ULL; continue; }',
    '    if (!std::strcmp(word, "serial")) { c.pin = -1; c.text = text; }',
    '    else {',
    '      c.pin = pinIndex(parsePin(word));',
    '      if (c.pin < 0) continue;',
    '      c.value = text == "HIGH" ? 1 : text == "LOW" ? 0 : std::atoi(text.c_str());',
    '    }',
    '    script().push_back(c);',
    '  }',
    '  std::stable_sort(script().begin(), script().end(), [](const Change& a, const Change& b) { return a.at < b.at; });',
    '  applyScript();',
    '}',
    '}  // namespace sim',
    '',
    'inline unsigned long millis() { return (unsigned long) (sim::now() / 1000ULL); }',
    'inline unsigned long micros() { return (unsigned long) sim::now(); }',
    'inline void delay(unsigned long ms) { sim::advance(ms * 1000ULL); }',
    'inline void delayMicroseconds(unsigned int us) { sim::advance(us); }',
    'inline void pinMode(int pin, int mode) {',
    '  int i = sim::pinIndex(pin);',
    '  if (i < 0) return;',
    '  sim::modes()[i] = mode;',
    '}',
    'inline void digitalWrite(int pin, int value) {',
    '  int i = sim::pinIndex(pin);',
    '  if (i < 0) return;',
    '  if (sim::modes()[i] != OUTPUT) sim::warnOnce(pin, ("digitalWrite on pin " + std::string(sim::pinName(pin)) + ", but pinMode(" + std::string(sim::pinName(pin)) + ", OUTPUT) was never called: on a real board the LED would barely glow.").c_str());',
    '  int v = value ? HIGH : LOW;',
    '  if (sim::outs()[i] != v) { sim::outs()[i] = v; sim::event(pin, \'D\', v); }',
    '}',
    'inline int digitalRead(int pin) {',
    '  int i = sim::pinIndex(pin);',
    '  if (i < 0) return LOW;',
    '  if (sim::scripted()[i]) return sim::ins()[i] ? HIGH : LOW;',
    '  if (sim::modes()[i] == INPUT_PULLUP) return HIGH;',
    '  if (sim::modes()[i] == OUTPUT) return sim::outs()[i];',
    '  return LOW;',
    '}',
    'inline int analogRead(int pin) {',
    '  int i = sim::pinIndex(pin < 14 ? pin + 14 : pin);',
    '  sim::advance(100);',
    '  if (i < 0) return 0;',
    '  int v = sim::ins()[i];',
    '  return v < 0 ? 0 : (v > 1023 ? 1023 : v);',
    '}',
    'inline void analogWrite(int pin, int value) {',
    '  int i = sim::pinIndex(pin);',
    '  if (i < 0) return;',
    '  int v = value < 0 ? 0 : (value > 255 ? 255 : value);',
    '  sim::outs()[i] = v;',
    '  sim::event(pin, \'P\', v);',
    '}',
    'inline void tone(int pin, unsigned int frequency) { sim::event(pin, \'T\', (long) frequency); }',
    'inline void tone(int pin, unsigned int frequency, unsigned long) { sim::event(pin, \'T\', (long) frequency); }',
    'inline void noTone(int pin) { sim::event(pin, \'T\', 0); }',
    'inline void shiftOut(int dataPin, int clockPin, int bitOrder, uint8_t value) {',
    '  (void) clockPin;',
    '  uint8_t v = value;',
    '  if (bitOrder == LSBFIRST) { uint8_t r = 0; for (int b = 0; b < 8; b++) if (value & (1 << b)) r |= (uint8_t) (1 << (7 - b)); v = r; }',
    '  sim::event(dataPin, \'S\', v);',
    '}',
    'inline unsigned long& simSeed() { static unsigned long s = 1; return s; }',
    'inline void randomSeed(unsigned long seed) { simSeed() = seed ? seed : 1; }',
    'inline long random(long high) { simSeed() = simSeed() * 1103515245UL + 12345UL; return high > 0 ? (long) ((simSeed() >> 16) % (unsigned long) high) : 0; }',
    'inline long random(long low, long high) { return high > low ? low + random(high - low) : low; }',
    '',
    '// The Serial Monitor.',
    'class SimSerial {',
    ' public:',
    '  void begin(long) {}',
    '  void end() {}',
    '  explicit operator bool() const { return true; }',
    '  int available() { return (int) sim::serialIn().size(); }',
    '  int read() { std::string& s = sim::serialIn(); if (s.empty()) return -1; int c = (unsigned char) s[0]; s.erase(0, 1); return c; }',
    '  int peek() { std::string& s = sim::serialIn(); return s.empty() ? -1 : (unsigned char) s[0]; }',
    '  String readStringUntil(char end) { std::string& s = sim::serialIn(); size_t i = s.find(end); std::string out = s.substr(0, i); s.erase(0, i == std::string::npos ? s.size() : i + 1); return String(out); }',
    '  String readString() { std::string out = sim::serialIn(); sim::serialIn().clear(); return String(out); }',
    '  long parseInt() { std::string& s = sim::serialIn(); size_t i = s.find_first_of("-0123456789"); if (i == std::string::npos) { s.clear(); return 0; } char* e = nullptr; long v = std::strtol(s.c_str() + i, &e, 10); s.erase(0, (size_t) (e - s.c_str())); return v; }',
    '  void flush() { std::cout.flush(); }',
    '  size_t write(uint8_t c) { return out(std::string(1, (char) c)); }',
    '  size_t print(const char* t) { return out(t ? t : ""); }',
    '  size_t print(const String& t) { return out(t.s); }',
    '  size_t print(const std::string& t) { return out(t); }',
    '  size_t print(char c) { return out(std::string(1, c)); }',
    '  size_t print(unsigned char v, int base = DEC) { return out(String::number(v, base)); }',
    '  size_t print(int v, int base = DEC) { return out(String::number(v, base)); }',
    '  size_t print(unsigned int v, int base = DEC) { return out(String::number(v, base)); }',
    '  size_t print(long v, int base = DEC) { return out(String::number(v, base)); }',
    '  size_t print(unsigned long v, int base = DEC) { return out(String::number((long long) v, base)); }',
    '  size_t print(long long v, int base = DEC) { return out(String::number(v, base)); }',
    '  size_t print(unsigned long long v, int base = DEC) { return out(String::number((long long) v, base)); }',
    '  size_t print(double v, int decimals = 2) { return out(String::fixed(v, decimals)); }',
    '  size_t println() { return out("\\n"); }',
    '  template <class T> size_t println(const T& v) { size_t n = print(v); return n + out("\\n"); }',
    '  template <class T> size_t println(const T& v, int format) { size_t n = print(v, format); return n + out("\\n"); }',
    ' private:',
    '  size_t out(const std::string& t) {',
    '    if (sim::printedLines() > 2000) return 0;',
    '    for (char c : t) if (c == \'\\n\') sim::printedLines() += 1;',
    '    std::cout << t;',
    '    if (sim::printedLines() > 2000) std::cout << "\\n... (the Serial Monitor stops here: more than 2000 lines)\\n";',
    '    return t.size();',
    '  }',
    '};',
    'inline SimSerial Serial;',
    '',
    '// A hobby servo: write() an angle from 0 to 180.',
    'class Servo {',
    ' public:',
    '  void attach(int p) { pin = p; }',
    '  void attach(int p, int, int) { pin = p; }',
    '  void detach() { pin = -1; }',
    '  bool attached() const { return pin >= 0; }',
    '  void write(int angle) { value = angle < 0 ? 0 : (angle > 180 ? 180 : angle); if (pin >= 0) sim::event(pin, \'V\', value); }',
    '  int read() const { return value; }',
    ' private:',
    '  int pin = -1;',
    '  int value = 90;',
    '};',
    '',
    '// The two functions of a sketch, if it has them.',
    '__attribute__((weak)) void setup();',
    '__attribute__((weak)) void loop();',
    'namespace sim { inline bool present(void (*f)()) { return f != nullptr; } }',
    '',
    '// For checks: run the sketch for a while, then look at the board.',
    'inline void simRun(unsigned long ms) {',
    '  static bool started = false;',
    '  sim::harness() = true;',
    '  unsigned long long end = sim::now() + ms * 1000ULL;',
    '  if (!started) { started = true; if (sim::present(setup)) setup(); }',
    '  while (sim::now() < end && sim::present(loop)) { loop(); sim::advance(10); }',
    '}',
    'inline int pinState(int pin) { int i = sim::pinIndex(pin); return i < 0 ? 0 : sim::outs()[i]; }',
    'inline void simSet(int pin, int value) { int i = sim::pinIndex(pin); if (i >= 0) { sim::ins()[i] = value; sim::scripted()[i] = true; } }',
    ''
  ].join('\n');

  // Runs setup() once and loop() until the simulated time is up.
  var MAIN = [
    'int main() {',
    '  sim::start();',
    '  if (sim::present(setup)) setup();',
    '  while (sim::present(loop)) { loop(); sim::advance(10); }',
    '  sim::finish();',
    '}',
    ''
  ].join('\n');

  // Libraries a sketch may include: the simulator provides what they would.
  var PROVIDED = /^[ \t]*#\s*include\s*[<"](Arduino|Servo|Wire|SPI)\.h[>"][ \t]*$/gm;

  /** Whether code is a sketch (setup and loop, no main). */
  function isSketch(code) {
    var src = String(code || '');
    return /\bvoid\s+(setup|loop)\s*\(/.test(src) && !/\bint\s+main\s*\(/.test(src);
  }

  /**
   * The source to compile: the simulator, then the learner's code (with its
   * own line numbers), then — for a sketch — the main that runs it.
   */
  function wrap(code) {
    var src = String(code || '').replace(PROVIDED, function (line) { return '// ' + line.trim() + ' (provided)'; });
    return '#line 1 "Arduino.h"\n' + HEADER + '\n#line 1 "main.cpp"\n' + src.replace(/\s*$/, '\n') +
      (isSketch(src) ? '#line 1 "Arduino-main.h"\n' + MAIN : '');
  }

  /**
   * What happened on the board: the pin events a run reported on stderr, and
   * that stderr without them (warnings and errors).
   * @returns {{events: Array<{ms, pin, kind, value}>, end: number, rest: string}}
   */
  function parseEvents(stderr) {
    var events = [];
    var end = 0;
    var rest = [];
    String(stderr || '').split('\n').forEach(function (line) {
      var m = /^\x1e(\d+) (\d+) ([DPVTS])(-?\d+)$/.exec(line);
      if (m) {
        events.push({ ms: Number(m[1]), pin: Number(m[2]), kind: m[3], value: Number(m[4]) });
        return;
      }
      var e = /^\x1eEND (\d+)$/.exec(line);
      if (e) { end = Number(e[1]); return; }
      rest.push(line);
    });
    if (!end && events.length) end = events[events.length - 1].ms;
    return { events: events, end: end, rest: rest.join('\n').trim() };
  }

  /** The state of every pin that was used, at a moment of the run. */
  function stateAt(events, ms) {
    var pins = {};
    events.forEach(function (e) {
      if (!pins[e.pin]) pins[e.pin] = { pin: e.pin, kind: e.kind, value: 0, changes: 0 };
      if (e.ms <= ms) {
        pins[e.pin].kind = e.kind;
        pins[e.pin].value = e.value;
        pins[e.pin].changes += 1;
      }
    });
    return Object.keys(pins).map(function (k) { return pins[k]; }).sort(function (a, b) { return a.pin - b.pin; });
  }

  function pinName(pin) {
    return pin >= 14 ? 'A' + (pin - 14) : String(pin);
  }

  return {
    HEADER: HEADER,
    MAIN: MAIN,
    isSketch: isSketch,
    wrap: wrap,
    parseEvents: parseEvents,
    stateAt: stateAt,
    pinName: pinName
  };
}));
