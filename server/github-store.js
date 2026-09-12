'use strict';

const { compose } = require('../public/compose.js');
const { SLUG_RE, validateSource, nextFreeSlug } = require('./store.js');

const DEFAULT_API = 'https://api.github.com';
const ROOT = 'published';
const MANIFEST = `${ROOT}/index.json`;
const BLOB_MODE = '100644';

class GitHubError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

/**
 * Stores deployed pages in a GitHub repository instead of on local disk, so
 * they survive a host with an ephemeral filesystem.
 *
 * Each publish is one commit writing three files:
 *   published/index.json          the list of pages (metadata only)
 *   published/<slug>/page.json    metadata plus the three editor panes
 *   published/<slug>/index.html   the composed page, which GitHub Pages serves
 *
 * Everything is cached in memory after the first read, so serving a page costs
 * no API calls.
 */
class GitHubStore {
  constructor({ token, repo, branch, api = DEFAULT_API, fetchImpl }) {
    const [owner, name] = String(repo || '').split('/');
    if (!owner || !name) {
      throw new Error(`AU_GITHUB_REPO must look like "owner/repo", got "${repo}"`);
    }
    if (!token) throw new Error('AU_GITHUB_TOKEN is required for GitHub storage');

    this.token = token;
    this.owner = owner;
    this.repo = name;
    this.branch = branch || null;
    this.api = api.replace(/\/+$/, '');
    this.fetch = fetchImpl || globalThis.fetch;

    this.pages = new Map();     // slug -> {meta, source}
    this.index = null;          // slug -> metadata, from the manifest
    this.loading = null;
  }

  init() {
    // Warm the cache in the background; requests await ready() anyway.
    this.ready().catch((err) => {
      console.error('GitHub storage: could not load published pages —', err.message);
    });
    return this;
  }

  get base() {
    return `${this.api}/repos/${this.owner}/${this.repo}`;
  }

  /** The permanent GitHub Pages address for a slug. */
  pagesUrl(slug) {
    return `https://${this.owner.toLowerCase()}.github.io/${this.repo}/${ROOT}/${slug}/`;
  }

  async request(method, path, body) {
    const res = await this.fetch(`${this.base}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'user-agent': 'actually-useful',
        ...(body ? { 'content-type': 'application/json' } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    });

    if (res.status === 404) return null;
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      let message = `GitHub API ${res.status} on ${method} ${path}`;
      try {
        const parsed = JSON.parse(detail);
        if (parsed.message) message += ` — ${parsed.message}`;
      } catch { /* keep the plain message */ }
      throw new GitHubError(message, res.status);
    }
    if (res.status === 204) return {};
    return res.json();
  }

  async resolveBranch() {
    if (this.branch) return this.branch;
    const repo = await this.request('GET', '');
    if (!repo) throw new GitHubError(`Repository ${this.owner}/${this.repo} not found or not accessible`, 404);
    this.branch = repo.default_branch;
    return this.branch;
  }

  async readJson(path) {
    const branch = await this.resolveBranch();
    const file = await this.request('GET', `/contents/${path}?ref=${encodeURIComponent(branch)}`);
    if (!file || !file.content) return null;
    try {
      return JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'));
    } catch {
      return null;
    }
  }

  /** Loads the manifest, and every page's source, exactly once. */
  ready() {
    if (!this.loading) this.loading = this.load();
    return this.loading;
  }

  async load() {
    await this.resolveBranch();
    const manifest = await this.readJson(MANIFEST);
    const entries = (manifest && Array.isArray(manifest.pages)) ? manifest.pages : [];

    this.index = new Map(entries.map((meta) => [meta.slug, meta]));
    await Promise.all(entries.map(async (meta) => {
      if (this.pages.has(meta.slug)) return;
      const page = await this.readJson(`${ROOT}/${meta.slug}/page.json`);
      if (page) this.pages.set(meta.slug, page);
    }));
  }

  /** Writes several files as a single commit. */
  async commit(message, changes, attempt = 0) {
    const branch = await this.resolveBranch();
    const ref = await this.request('GET', `/git/ref/heads/${branch}`);
    if (!ref) throw new GitHubError(`Branch "${branch}" not found`, 404);

    const head = ref.object.sha;
    const parent = await this.request('GET', `/git/commits/${head}`);
    const tree = await this.request('POST', '/git/trees', {
      base_tree: parent.tree.sha,
      tree: changes.map((change) => (change.remove
        ? { path: change.path, mode: BLOB_MODE, type: 'blob', sha: null }
        : { path: change.path, mode: BLOB_MODE, type: 'blob', content: change.content }))
    });
    const commit = await this.request('POST', '/git/commits', {
      message,
      tree: tree.sha,
      parents: [head]
    });

    try {
      await this.request('PATCH', `/git/refs/heads/${branch}`, { sha: commit.sha });
    } catch (err) {
      // Someone else pushed between our read and write; rebuild on the new head.
      if (err.status === 422 && attempt === 0) return this.commit(message, changes, 1);
      throw err;
    }
    return commit.sha;
  }

  async list() {
    await this.ready();
    return Array.from(this.index.values())
      .map((meta) => {
        const page = this.pages.get(meta.slug);
        return { ...meta, source: page ? page.source : { html: '', css: '', js: '' } };
      })
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  async get(slug) {
    if (!SLUG_RE.test(slug)) return null;
    await this.ready();
    const page = this.pages.get(slug);
    return page ? { ...page.meta, source: page.source } : null;
  }

  async html(slug) {
    if (!SLUG_RE.test(slug)) return null;
    await this.ready();
    const page = this.pages.get(slug);
    if (!page) return null;
    return compose({ ...page.source, title: page.meta.name });
  }

  async save({ name, slug, html = '', css = '', js = '' }) {
    const invalid = validateSource({ html, css, js });
    if (!invalid.ok) return invalid;

    await this.ready();
    const title = String(name || '').trim() || 'Untitled page';

    let target = slug;
    let existing = null;
    if (target) {
      if (!SLUG_RE.test(target)) return { ok: false, status: 400, error: 'Invalid slug' };
      existing = this.index.get(target) || null;
    } else {
      target = nextFreeSlug(title, new Set(this.index.keys()));
    }

    const now = new Date().toISOString();
    const meta = {
      slug: target,
      name: title,
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now,
      version: existing ? (existing.version || 1) + 1 : 1
    };
    const source = { html, css, js };

    const nextIndex = new Map(this.index);
    nextIndex.set(target, meta);

    try {
      await this.commit(
        `Publish ${target} (v${meta.version})`,
        [
          { path: MANIFEST, content: JSON.stringify({ pages: Array.from(nextIndex.values()) }, null, 2) },
          { path: `${ROOT}/${target}/page.json`, content: JSON.stringify({ meta, source }, null, 2) },
          { path: `${ROOT}/${target}/index.html`, content: compose({ html, css, js, title }) }
        ]
      );
    } catch (err) {
      return { ok: false, status: err.status === 403 ? 403 : 502, error: githubHint(err) };
    }

    this.index = nextIndex;
    this.pages.set(target, { meta, source });
    return { ok: true, site: meta, created: !existing };
  }

  async remove(slug) {
    if (!SLUG_RE.test(slug)) return false;
    await this.ready();
    if (!this.index.has(slug)) return false;

    const nextIndex = new Map(this.index);
    nextIndex.delete(slug);

    await this.commit(
      `Unpublish ${slug}`,
      [
        { path: MANIFEST, content: JSON.stringify({ pages: Array.from(nextIndex.values()) }, null, 2) },
        { path: `${ROOT}/${slug}/page.json`, remove: true },
        { path: `${ROOT}/${slug}/index.html`, remove: true }
      ]
    );

    this.index = nextIndex;
    this.pages.delete(slug);
    return true;
  }
}

/** Turns a GitHub failure into something a person can act on. */
function githubHint(err) {
  if (err.status === 401) return 'GitHub rejected the token. Check AU_GITHUB_TOKEN has not expired.';
  if (err.status === 403) return 'The token lacks permission to write to this repository (needs Contents: read and write).';
  if (err.status === 404) return 'Repository or branch not found. Check AU_GITHUB_REPO.';
  return err.message || 'Could not reach GitHub.';
}

module.exports = { GitHubStore, GitHubError, ROOT, MANIFEST };
