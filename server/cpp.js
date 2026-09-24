'use strict';

/**
 * Compiles and runs C++ for Learn mode and the editor.
 *
 * Browsers cannot run C++, so the server does it. Three ways, tried in order:
 *
 *   local     g++ or clang++ on this machine — fastest, works offline
 *   godbolt   the Compiler Explorer API (godbolt.org) when there is no compiler
 *   wandbox   the Wandbox API (wandbox.org) as a last resort
 *
 * AU_CPP_BACKEND=local|godbolt|wandbox|off pins one; the default "auto" uses
 * whichever of them works first.
 *
 * A program runs with a time limit, a memory limit and a cap on how much it
 * may print, in its own throwaway directory, and is killed together with
 * anything it started. This is a single-user tool behind a password, so the
 * limits exist to stop honest mistakes (an infinite loop, a runaway print)
 * from taking the server down, not to contain a hostile program.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const LIMITS = {
  files: 16,
  sourceBytes: 256 * 1024,
  stdinBytes: 64 * 1024,
  inputs: 24,
  outputBytes: 64 * 1024,       // kept per stream
  killBytes: 4 * 1024 * 1024,   // printing past this means a runaway loop
  runMs: 5000,
  maxRunMs: 15000,
  compileMs: 60000,
  memoryKb: 1024 * 1024
};

const FILE_NAME = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}\.(?:cpp|cc|cxx|c\+\+|h|hpp|hh|hxx|inl|ipp|txt|dat|csv|in)$/;
const SOURCE_EXT = /\.(?:cpp|cc|cxx|c\+\+)$/;

class RunError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

/** Checks a request and returns the files to build. */
function normalizeRequest(body) {
  body = body || {};
  let files;
  if (Array.isArray(body.files)) {
    files = body.files.map((file) => ({ name: String(file && file.name || ''), content: file && file.content }));
  } else if (typeof body.source === 'string') {
    files = [{ name: 'main.cpp', content: body.source }];
  } else {
    throw new RunError('Send "source" (a string) or "files" (a list of {name, content})');
  }

  if (!files.length) throw new RunError('There is nothing to compile');
  if (files.length > LIMITS.files) throw new RunError(`At most ${LIMITS.files} files`);

  let total = 0;
  const seen = new Set();
  for (const file of files) {
    if (!FILE_NAME.test(file.name)) throw new RunError(`"${file.name}" is not a usable C++ file name`);
    if (seen.has(file.name)) throw new RunError(`Two files are called "${file.name}"`);
    seen.add(file.name);
    if (typeof file.content !== 'string') throw new RunError(`"${file.name}" must hold text`);
    total += Buffer.byteLength(file.content, 'utf8');
  }
  if (total > LIMITS.sourceBytes) throw new RunError('The source is too large (256 KB at most)', 413);
  if (!files.some((file) => SOURCE_EXT.test(file.name))) {
    throw new RunError('There is no .cpp file to compile');
  }

  let inputs;
  if (Array.isArray(body.inputs)) inputs = body.inputs.map((value) => String(value == null ? '' : value));
  else inputs = [typeof body.stdin === 'string' ? body.stdin : ''];
  if (!inputs.length) inputs = [''];
  if (inputs.length > LIMITS.inputs) throw new RunError(`At most ${LIMITS.inputs} inputs per run`);
  if (inputs.some((input) => Buffer.byteLength(input, 'utf8') > LIMITS.stdinBytes)) {
    throw new RunError('An input is too large (64 KB at most)', 413);
  }

  const requested = Number(body.timeoutMs);
  const runMs = Number.isFinite(requested) && requested > 0
    ? Math.min(requested, LIMITS.maxRunMs)
    : LIMITS.runMs;

  return { files, inputs, runMs };
}

/** Keeps at most `limit` bytes of a stream, remembering whether it was cut. */
class Capture {
  constructor(limit) {
    this.limit = limit;
    this.chunks = [];
    this.kept = 0;
    this.seen = 0;
  }
  push(chunk) {
    this.seen += chunk.length;
    if (this.kept >= this.limit) return;
    const room = this.limit - this.kept;
    const part = chunk.length > room ? chunk.subarray(0, room) : chunk;
    this.chunks.push(part);
    this.kept += part.length;
  }
  get truncated() { return this.seen > this.kept; }
  text() { return Buffer.concat(this.chunks).toString('utf8'); }
}

/** A tiny counting semaphore: compiling is memory-hungry, so few at once. */
class Gate {
  constructor(size) {
    this.size = size;
    this.active = 0;
    this.waiting = [];
  }
  async use(task) {
    if (this.active >= this.size) await new Promise((resolve) => this.waiting.push(resolve));
    this.active += 1;
    try {
      return await task();
    } finally {
      this.active -= 1;
      const next = this.waiting.shift();
      if (next) next();
    }
  }
}

/** Runs a command to completion, collecting its output. */
function execute(cmd, args, { cwd, input = '', timeoutMs, limit = LIMITS.outputBytes, env, group = false }) {
  return new Promise((resolve) => {
    const started = Date.now();
    let child;
    try {
      child = spawn(cmd, args, {
        cwd,
        env: env || process.env,
        stdio: ['pipe', 'pipe', 'pipe'],
        // Its own process group, so a program that forks can be killed whole.
        detached: group
      });
    } catch (err) {
      resolve({ error: err, stdout: '', stderr: '', exitCode: null, signal: null, ms: 0 });
      return;
    }

    const out = new Capture(limit);
    const errs = new Capture(limit);
    let timedOut = false;
    let flooded = false;
    let settled = false;

    const kill = () => {
      try {
        if (group) process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch { /* already gone */ }
    };
    const timer = setTimeout(() => { timedOut = true; kill(); }, timeoutMs);

    const watch = (capture) => (chunk) => {
      capture.push(chunk);
      if (out.seen + errs.seen > LIMITS.killBytes && !flooded) { flooded = true; kill(); }
    };
    child.stdout.on('data', watch(out));
    child.stderr.on('data', watch(errs));
    // A program that exits without reading its input closes the pipe early.
    child.stdin.on('error', () => {});

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ error: err, stdout: out.text(), stderr: errs.text(), exitCode: null, signal: null, ms: Date.now() - started });
    });
    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (group) kill(); // anything it left running in the background
      resolve({
        stdout: out.text(),
        stderr: errs.text(),
        exitCode: code,
        signal: timedOut || flooded ? 'SIGKILL' : signal,
        timedOut,
        truncated: out.truncated || errs.truncated || flooded,
        flooded,
        ms: Date.now() - started
      });
    });

    child.stdin.end(input);
  });
}

// ------------------------------------------------------------------ local

const CANDIDATES = ['g++', 'clang++', 'c++'];

class LocalBackend {
  constructor(options = {}) {
    this.name = 'local';
    this.candidates = options.compiler ? [options.compiler] : CANDIDATES;
    this.gate = new Gate(options.concurrency || Math.max(1, Math.min(2, os.cpus().length)));
    this.cacheSize = options.cacheSize || 32;
    this.cache = new Map(); // key -> {dir, warnings}
    this.building = new Map(); // key -> promise, so identical builds share one
    this.root = null;
    this.detecting = null;
    this.usePch = options.pch !== false;
    this.forceStd = options.std || null;
    this.pch = new Map();   // header-set key -> 'building' | 'ready' | 'failed'
    this.pchLimit = options.pchLimit || 6;
  }

  /** Finds a working compiler once; null when this machine has none. */
  detect() {
    if (!this.detecting) this.detecting = this._detect();
    return this.detecting;
  }

  async _detect() {
    for (const cmd of this.candidates) {
      const probe = await execute(cmd, ['--version'], { timeoutMs: 10000 });
      if (probe.error || probe.exitCode !== 0) continue;
      const first = (probe.stdout.split('\n')[0] || cmd).trim();
      const version = (first.match(/(\d+)\.\d+(?:\.\d+)?/) || [])[0] || '';
      const major = parseInt(version, 10) || 0;
      const clang = /clang/i.test(first);
      // C++20 is solid from GCC 10 and Clang 10; older compilers get C++17.
      const std = this.forceStd || (major >= 10 ? 'c++20' : 'c++17');
      this.root = await fsp.mkdtemp(path.join(os.tmpdir(), 'au-cpp-'));
      return { cmd, label: first, version, std, clang };
    }
    return null;
  }

  async available() {
    return Boolean(await this.detect());
  }

  async describe() {
    const found = await this.detect();
    return found ? { backend: 'local', compiler: found.label, std: found.std } : null;
  }

  flags(found) {
    return [
      `-std=${found.std}`,
      '-O1',
      '-Wall', '-Wextra', '-pedantic',
      // Makes v[i] past the end stop with a message instead of misbehaving
      // silently — worth far more to a learner than the few % it costs.
      '-D_GLIBCXX_ASSERTIONS',
      '-fdiagnostics-color=never'
    ];
  }

  /**
   * Standard headers are most of the work in compiling a small program, and
   * the same few sets come up again and again. The first time a set is seen it
   * is precompiled in the background; after that, programs including exactly
   * that set compile two to three times faster. Nothing else changes: the
   * precompiled header holds only what the program includes itself.
   */
  pchFor(files, flags, found) {
    if (!this.usePch || found.clang || files.filter((f) => SOURCE_EXT.test(f.name)).length !== 1) return null;
    const source = files.find((f) => SOURCE_EXT.test(f.name)).content;
    const headers = pchHeaders(source);
    if (!headers) return null;

    const key = crypto.createHash('sha1').update(flags.join(' ') + '\0' + headers.join('\n')).digest('hex').slice(0, 20);
    const dir = path.join(this.root, 'pch', key);
    const header = path.join(dir, 'au.h');
    const state = this.pch.get(key);
    if (state === 'ready') return header;
    if (!state && this.pch.size < this.pchLimit) {
      this.pch.set(key, 'building');
      this.buildPch(dir, header, headers, flags, found)
        .then((ok) => this.pch.set(key, ok ? 'ready' : 'failed'))
        .catch(() => this.pch.set(key, 'failed'));
    }
    return null;
  }

  async buildPch(dir, header, headers, flags, found) {
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(header, headers.map((name) => `#include <${name}>`).join('\n') + '\n');
    // nice: never let a background job slow down the program being waited on.
    const args = [found.cmd, ...flags, '-x', 'c++-header', header, '-o', header + '.gch'];
    const result = await execute('nice', ['-n', '15', ...args], { cwd: dir, timeoutMs: LIMITS.compileMs * 2 });
    return !result.error && result.exitCode === 0 && fs.existsSync(header + '.gch');
  }

  async build(files) {
    const found = await this.detect();
    const flags = this.flags(found);
    const key = crypto.createHash('sha256')
      .update(found.label + '\0' + flags.join(' ') + '\0' + JSON.stringify(files))
      .digest('hex');

    // The same program requested twice at once (an exam marking several
    // answers, two tabs) is built once; both wait for that build.
    if (this.building.has(key)) return this.building.get(key);
    const job = this._build(files, found, flags, key).finally(() => this.building.delete(key));
    this.building.set(key, job);
    return job;
  }

  async _build(files, found, flags, key) {
    const cached = this.cache.get(key);
    if (cached && fs.existsSync(path.join(cached.dir, 'prog'))) {
      this.cache.delete(key); // re-insert: most recently used last
      this.cache.set(key, cached);
      return { ok: true, dir: cached.dir, output: cached.warnings, ms: 0, cached: true };
    }

    const dir = path.join(this.root, key.slice(0, 24));
    await fsp.rm(dir, { recursive: true, force: true });
    await fsp.mkdir(dir, { recursive: true });
    await Promise.all(files.map((file) => fsp.writeFile(path.join(dir, file.name), file.content)));

    const sources = files.filter((file) => SOURCE_EXT.test(file.name)).map((file) => file.name);
    const pch = this.pchFor(files, flags, found);
    const extra = pch ? ['-include', pch] : [];
    const result = await this.gate.use(() => execute(found.cmd, [...flags, ...extra, ...sources, '-o', 'prog'], {
      cwd: dir,
      timeoutMs: LIMITS.compileMs,
      limit: LIMITS.outputBytes
    }));

    const output = (result.stderr + result.stdout).trim();
    if (result.timedOut) {
      await fsp.rm(dir, { recursive: true, force: true });
      return { ok: false, output: 'The compiler took too long and was stopped.', ms: result.ms };
    }
    if (result.exitCode !== 0) {
      await fsp.rm(dir, { recursive: true, force: true });
      return { ok: false, output: output || 'The compiler failed without saying why.', ms: result.ms };
    }

    this.cache.set(key, { dir, warnings: output });
    while (this.cache.size > this.cacheSize) {
      const [oldKey, oldest] = this.cache.entries().next().value;
      this.cache.delete(oldKey);
      fsp.rm(oldest.dir, { recursive: true, force: true }).catch(() => {});
    }
    return { ok: true, dir, output, ms: result.ms, cached: false };
  }

  async runOne(dir, input, runMs) {
    const work = await fsp.mkdtemp(path.join(this.root, 'run-'));
    try {
      // ulimit is per process and inherited; the shell applies it, then
      // becomes the program. A failed ulimit (unsupported) is not fatal.
      const script = `ulimit -v ${LIMITS.memoryKb} 2>/dev/null; ulimit -f 16384 2>/dev/null; ` +
        `ulimit -t ${Math.ceil(runMs / 1000) + 1} 2>/dev/null; exec "$0"`;
      const result = await execute('/bin/sh', ['-c', script, path.join(dir, 'prog')], {
        cwd: work,
        input,
        timeoutMs: runMs,
        group: true,
        env: { PATH: process.env.PATH || '/usr/bin:/bin', HOME: work, LANG: 'C.UTF-8' }
      });
      if (result.error) throw result.error;
      return {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        signal: result.signal || null,
        timedOut: Boolean(result.timedOut),
        truncated: Boolean(result.truncated),
        ms: result.ms
      };
    } finally {
      fsp.rm(work, { recursive: true, force: true }).catch(() => {});
    }
  }

  async run({ files, inputs, runMs }) {
    const found = await this.detect();
    if (!found) throw new RunError('No C++ compiler on this machine', 503);

    const built = await this.build(files);
    const compile = { ok: built.ok, output: built.output, ms: built.ms, cached: Boolean(built.cached) };
    if (!built.ok) return { backend: 'local', compiler: found.label, std: found.std, compile, runs: [] };

    const runs = [];
    for (const input of inputs) runs.push(await this.runOne(built.dir, input, runMs));
    return { backend: 'local', compiler: found.label, std: found.std, compile, runs };
  }
}

/**
 * The standard headers a program includes, when a precompiled header for them
 * would behave exactly like the program's own includes; null otherwise.
 * Anything that could change how a header reads — a #define before it, a
 * header of the project's own — rules it out.
 */
function pchHeaders(source) {
  const lines = String(source).split('\n');
  const headers = [];
  let lastInclude = -1;
  lines.forEach((line, i) => {
    const m = line.match(/^\s*#\s*include\s*<([a-z_]+)>\s*(?:\/\/.*)?$/);
    if (m) { headers.push(m[1]); lastInclude = i; }
  });
  if (!headers.length) return null;
  for (let i = 0; i < lastInclude; i += 1) {
    const line = lines[i].trim();
    if (!line.startsWith('#')) continue;
    if (/^#\s*include\s*<[a-z_]+>/.test(line)) continue;
    return null;
  }
  return Array.from(new Set(headers));
}

// ------------------------------------------------------------------ remote

function joinText(lines) {
  if (typeof lines === 'string') return lines;
  if (!Array.isArray(lines)) return '';
  return lines.map((line) => (line && typeof line.text === 'string' ? line.text : '')).join('\n');
}

/** The single source a remote service gets: headers inlined, .cpp files joined. */
function flatten(files) {
  if (files.length === 1) return files[0].content;
  const headers = new Map(files.filter((f) => !SOURCE_EXT.test(f.name)).map((f) => [f.name, f.content]));
  const inline = (text, depth) => text.replace(/^[ \t]*#[ \t]*include[ \t]*"([^"]+)"[^\n]*$/gm, (line, name) => {
    if (!headers.has(name) || depth > 8) return line;
    return `// ---- ${name}\n${inline(headers.get(name), depth + 1)}\n// ---- end ${name}`;
  });
  return files.filter((f) => SOURCE_EXT.test(f.name))
    .map((f) => `// ==== ${f.name}\n${inline(f.content, 0)}`)
    .join('\n');
}

class GodboltBackend {
  constructor(options = {}) {
    this.name = 'godbolt';
    this.api = (options.api || 'https://godbolt.org').replace(/\/+$/, '');
    this.compiler = options.compilerId || 'g132';
    this.fetch = options.fetchImpl || globalThis.fetch;
    this.gate = new Gate(3);
  }

  async available() { return typeof this.fetch === 'function'; }

  async describe() {
    return { backend: 'godbolt', compiler: `Compiler Explorer (${this.compiler})`, std: 'c++20' };
  }

  async runOne(source, input, runMs) {
    const res = await this.gate.use(() => this.fetch(`${this.api}/api/compiler/${encodeURIComponent(this.compiler)}/compile`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        source,
        lang: 'c++',
        allowStoreCodeDebug: false,
        options: {
          userArguments: '-std=c++20 -O1 -Wall -Wextra -pedantic -D_GLIBCXX_ASSERTIONS',
          executeParameters: { args: [], stdin: input },
          compilerOptions: { executorRequest: true, skipAsm: true },
          filters: { execute: true },
          tools: [],
          libraries: []
        }
      }),
      signal: AbortSignal.timeout(LIMITS.compileMs + runMs)
    }));
    if (!res.ok) throw new RunError(`Compiler Explorer answered ${res.status}`, 502);
    return res.json();
  }

  async run({ files, inputs, runMs }) {
    const source = flatten(files);
    const replies = await Promise.all(inputs.map((input) => this.runOne(source, input, runMs)));
    const first = replies[0] || {};
    const build = first.buildResult || first;
    const compileOk = build.code === 0 || (first.didExecute && build.code == null);
    const compile = {
      ok: Boolean(compileOk),
      output: [joinText(build.stderr), joinText(build.stdout)].filter(Boolean).join('\n').trim(),
      ms: 0,
      cached: false
    };
    if (!compile.ok) return { backend: 'godbolt', compiler: this.compiler, std: 'c++20', compile, runs: [] };

    const runs = replies.map((reply) => ({
      stdout: joinText(reply.stdout),
      stderr: joinText(reply.stderr),
      exitCode: typeof reply.code === 'number' ? reply.code : null,
      signal: null,
      timedOut: Boolean(reply.timedOut),
      truncated: Boolean(reply.truncated),
      ms: Number(reply.execTime) || 0
    }));
    return { backend: 'godbolt', compiler: this.compiler, std: 'c++20', compile, runs };
  }
}

class WandboxBackend {
  constructor(options = {}) {
    this.name = 'wandbox';
    this.api = (options.api || 'https://wandbox.org').replace(/\/+$/, '');
    this.compiler = options.compilerId || 'gcc-head';
    this.fetch = options.fetchImpl || globalThis.fetch;
    this.gate = new Gate(2);
  }

  async available() { return typeof this.fetch === 'function'; }

  async describe() {
    return { backend: 'wandbox', compiler: `Wandbox (${this.compiler})`, std: 'c++20' };
  }

  async runOne(files, input, runMs) {
    const [main, ...rest] = files.slice().sort((a, b) => Number(SOURCE_EXT.test(b.name)) - Number(SOURCE_EXT.test(a.name)));
    const res = await this.gate.use(() => this.fetch(`${this.api}/api/compile.json`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        compiler: this.compiler,
        code: main.content,
        codes: rest.map((file) => ({ file: file.name, code: file.content })),
        options: 'warning',
        'compiler-option-raw': ['-std=c++20', '-O1', '-D_GLIBCXX_ASSERTIONS',
          ...rest.filter((f) => SOURCE_EXT.test(f.name)).map((f) => f.name)].join('\n'),
        stdin: input
      }),
      signal: AbortSignal.timeout(LIMITS.compileMs + runMs)
    }));
    if (!res.ok) throw new RunError(`Wandbox answered ${res.status}`, 502);
    return res.json();
  }

  async run({ files, inputs, runMs }) {
    const replies = await Promise.all(inputs.map((input) => this.runOne(files, input, runMs)));
    const first = replies[0] || {};
    const compilerSaid = [first.compiler_error, first.compiler_output].filter(Boolean).join('\n').trim();
    // Wandbox reports a failed build as a non-zero status with no program output.
    const failed = first.status !== undefined && String(first.status) !== '0' &&
      !first.program_output && !first.program_error && /error/i.test(compilerSaid);
    const compile = { ok: !failed, output: compilerSaid, ms: 0, cached: false };
    if (failed) return { backend: 'wandbox', compiler: this.compiler, std: 'c++20', compile, runs: [] };

    const runs = replies.map((reply) => ({
      stdout: reply.program_output || '',
      stderr: reply.program_error || '',
      exitCode: reply.status !== undefined ? Number(reply.status) : null,
      signal: reply.signal || null,
      timedOut: /time ?limit|timed? ?out/i.test(String(reply.signal || '') + String(reply.program_message || '')),
      truncated: false,
      ms: 0
    }));
    return { backend: 'wandbox', compiler: this.compiler, std: 'c++20', compile, runs };
  }
}

// ------------------------------------------------------------------ runner

/**
 * Picks a backend and runs requests on it.
 * @param {{backend?: string, compiler?: string, fetchImpl?: Function}} options
 */
function createRunner(options = {}) {
  const choice = String(options.backend || process.env.AU_CPP_BACKEND || 'auto').toLowerCase();
  const all = {
    local: () => new LocalBackend({
      compiler: options.compiler || process.env.AU_CXX,
      concurrency: options.concurrency,
      std: options.std,
      pch: options.pch
    }),
    godbolt: () => new GodboltBackend({
      fetchImpl: options.fetchImpl,
      api: options.godboltApi || process.env.AU_GODBOLT_API,
      compilerId: process.env.AU_GODBOLT_COMPILER
    }),
    wandbox: () => new WandboxBackend({
      fetchImpl: options.fetchImpl,
      api: options.wandboxApi || process.env.AU_WANDBOX_API,
      compilerId: process.env.AU_WANDBOX_COMPILER
    })
  };

  let order;
  if (choice === 'off') order = [];
  else if (all[choice]) order = [choice];
  else order = ['local', 'godbolt', 'wandbox'];
  const backends = order.map((name) => all[name]());

  let picking = null;
  const pick = () => {
    if (!picking) {
      picking = (async () => {
        for (const backend of backends) {
          if (await backend.available()) return backend;
        }
        return null;
      })();
    }
    return picking;
  };

  return {
    limits: LIMITS,

    async status() {
      const backend = await pick();
      if (!backend) {
        return {
          available: false,
          reason: choice === 'off' ? 'C++ is switched off (AU_CPP_BACKEND=off).' : 'No C++ compiler was found.'
        };
      }
      return { available: true, ...(await backend.describe()) };
    },

    async run(body) {
      const request = normalizeRequest(body);
      const backend = await pick();
      if (!backend) throw new RunError('No C++ compiler is available on this server', 503);

      try {
        return await backend.run(request);
      } catch (err) {
        // A remote service can be down; try the next remote one before giving up.
        const rest = backends.slice(backends.indexOf(backend) + 1).filter((b) => b.name !== 'local');
        for (const next of rest) {
          try { return await next.run(request); } catch { /* keep trying */ }
        }
        if (err instanceof RunError) throw err;
        throw new RunError(`Could not run the program: ${err.message}`, 502);
      }
    }
  };
}

module.exports = { createRunner, normalizeRequest, flatten, pchHeaders, RunError, LIMITS, LocalBackend, GodboltBackend, WandboxBackend };
