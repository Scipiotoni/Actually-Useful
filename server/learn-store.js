'use strict';

/**
 * Where Learn mode keeps your progress, so it follows you between devices.
 *
 * On disk next to the published pages, or — when GitHub storage is on — in a
 * branch of its own (au-learn by default). A separate branch matters: saving
 * progress then never triggers a GitHub Pages build, a Render redeploy, or
 * clutters the history of the branch your pages live on.
 *
 * Every save is merged with what is already stored, so two devices never
 * overwrite each other's work.
 */

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const Engine = require('../public/learn/engine.js');

const MAX_BYTES = 4 * 1024 * 1024;
const FILE = 'learn/progress.json';

function validate(progress) {
  if (!progress || typeof progress !== 'object' || Array.isArray(progress)) {
    return 'Progress must be an object';
  }
  if (Buffer.byteLength(JSON.stringify(progress), 'utf8') > MAX_BYTES) {
    return 'Progress is too large (4 MB at most)';
  }
  return null;
}

class DiskProgress {
  constructor(file) {
    this.file = file;
    this.kind = 'disk';
    this.cache = null;
    this.writing = Promise.resolve();
  }

  async read() {
    if (this.cache) return this.cache;
    try {
      this.cache = JSON.parse(await fsp.readFile(this.file, 'utf8'));
    } catch {
      this.cache = Engine.emptyProgress();
    }
    return this.cache;
  }

  async save(incoming) {
    const merged = Engine.mergeProgress(await this.read(), incoming);
    this.cache = merged;
    // Writes are chained so two saves never interleave on disk.
    this.writing = this.writing.then(async () => {
      await fsp.mkdir(path.dirname(this.file), { recursive: true });
      const temp = `${this.file}.${process.pid}.tmp`;
      await fsp.writeFile(temp, JSON.stringify(this.cache));
      await fsp.rename(temp, this.file);
    }).catch((err) => console.error('Could not save learning progress:', err.message));
    await this.writing;
    return merged;
  }
}

class GitHubProgress {
  /** @param {import('./github-store.js').GitHubStore} store */
  constructor(store, branch) {
    this.store = store;
    this.branch = branch || 'au-learn';
    this.kind = 'github';
    this.cache = null;
    this.loading = null;
    this.pending = null;   // a save waiting to be committed
    this.timer = null;
    this.flushing = null;
    this.delayMs = 4000;
  }

  async ensureBranch() {
    if (this.branchReady) return;
    const existing = await this.store.request('GET', `/git/ref/heads/${this.branch}`);
    if (!existing) {
      const base = await this.store.resolveBranch();
      const head = await this.store.request('GET', `/git/ref/heads/${base}`);
      if (!head) throw new Error(`Branch "${base}" not found`);
      await this.store.request('POST', '/git/refs', { ref: `refs/heads/${this.branch}`, sha: head.object.sha });
    }
    this.branchReady = true;
  }

  read() {
    if (this.cache) return Promise.resolve(this.cache);
    if (!this.loading) {
      this.loading = (async () => {
        let stored = null;
        try {
          const file = await this.store.request('GET', `/contents/${FILE}?ref=${encodeURIComponent(this.branch)}`);
          if (file && file.content) stored = JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'));
        } catch (err) {
          console.error('Could not load learning progress from GitHub:', err.message);
        }
        this.cache = Engine.mergeProgress(this.cache || Engine.emptyProgress(), stored || {});
        return this.cache;
      })().finally(() => { this.loading = null; });
    }
    return this.loading;
  }

  /**
   * Merges at once (so the reply is up to date) but commits a few seconds
   * later, folding a burst of saves into one commit.
   */
  async save(incoming) {
    const merged = Engine.mergeProgress(await this.read(), incoming);
    this.cache = merged;
    this.pending = merged;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.flush().catch(() => {}); }, this.delayMs);
    if (this.timer.unref) this.timer.unref();
    return merged;
  }

  async flush() {
    if (this.flushing) await this.flushing.catch(() => {});
    if (!this.pending) return;
    const data = this.pending;
    this.pending = null;
    this.flushing = (async () => {
      await this.ensureBranch();
      await this.store.commit('Save learning progress', [
        { path: FILE, content: JSON.stringify(data) }
      ], { branch: this.branch });
    })();
    try {
      await this.flushing;
    } catch (err) {
      console.error('Could not save learning progress to GitHub:', err.message);
      // Keep it for the next attempt rather than dropping it.
      this.pending = this.pending ? Engine.mergeProgress(data, this.pending) : data;
      throw err;
    } finally {
      this.flushing = null;
    }
  }
}

function createProgressStore(store, options = {}) {
  if (store && typeof store.commit === 'function' && typeof store.request === 'function') {
    return new GitHubProgress(store, options.branch || process.env.AU_LEARN_BRANCH);
  }
  const file = options.file || path.join(options.dataDir || path.join(__dirname, '..', 'data'), 'learn', 'progress.json');
  return new DiskProgress(file);
}

module.exports = { createProgressStore, DiskProgress, GitHubProgress, validate, FILE };
