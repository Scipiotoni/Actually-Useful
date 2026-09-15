'use strict';

const Compose = require('../public/compose.js');
const { escapeHtml } = Compose;
const { SLUG_RE, validateSource, nextFreeSlug } = require('./store.js');
const { ASSET_NAME_RE, assetName, nextFreeName, decodeUpload } = require('./assets.js');

const DEFAULT_API = 'https://api.github.com';
const ROOT = 'published';
const MANIFEST = `${ROOT}/index.json`;
const DIRECTORY = `${ROOT}/index.html`;
const ASSETS = `${ROOT}/assets`;
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
 *   published/index.html          a browsable directory of those pages
 *   published/<slug>/page.json    metadata plus every source file
 *   published/<slug>/<file>       each published file, which GitHub Pages serves
 *   published/assets/<file>       uploaded images, reached as ../assets/<file>
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
    this.assets = new Map();    // name -> {meta, bytes}
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

    await this.loadAssets();
  }

  /** Lists the uploaded images. Their bytes are fetched only when asked for. */
  async loadAssets() {
    const branch = await this.resolveBranch();
    const listing = await this.request('GET', `/contents/${ASSETS}?ref=${encodeURIComponent(branch)}`);
    if (!Array.isArray(listing)) return;
    listing.forEach((entry) => {
      if (entry.type !== 'file' || !ASSET_NAME_RE.test(entry.name)) return;
      const known = this.assets.get(entry.name);
      this.assets.set(entry.name, {
        meta: { name: entry.name, size: entry.size, updatedAt: known ? known.meta.updatedAt : null },
        bytes: known ? known.bytes : null
      });
    });
  }

  async listAssets() {
    await this.ready();
    return Array.from(this.assets.values())
      .map((asset) => asset.meta)
      .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')) || a.name.localeCompare(b.name));
  }

  async readAsset(name) {
    if (!ASSET_NAME_RE.test(name)) return null;
    await this.ready();
    const asset = this.assets.get(name);
    if (!asset) return null;
    if (asset.bytes) return asset.bytes;

    const branch = await this.resolveBranch();
    const file = await this.request('GET', `/contents/${ASSETS}/${name}?ref=${encodeURIComponent(branch)}`);
    if (!file || !file.content) return null;
    asset.bytes = Buffer.from(file.content, 'base64');
    return asset.bytes;
  }

  async saveAsset({ name, data }) {
    const decoded = decodeUpload(data);
    if (!decoded.ok) return decoded;

    await this.ready();
    const target = nextFreeName(assetName(name, decoded.extension), new Set(this.assets.keys()));

    try {
      await this.commit(`Add image ${target}`, [
        { path: `${ASSETS}/${target}`, bytes: decoded.buffer }
      ]);
    } catch (err) {
      return { ok: false, status: err.status === 403 ? 403 : 502, error: githubHint(err) };
    }

    const meta = { name: target, size: decoded.buffer.length, updatedAt: new Date().toISOString() };
    this.assets.set(target, { meta, bytes: decoded.buffer });
    return { ok: true, asset: meta };
  }

  async removeAsset(name) {
    if (!ASSET_NAME_RE.test(name)) return false;
    await this.ready();
    if (!this.assets.has(name)) return false;

    await this.commit(`Remove image ${name}`, [{ path: `${ASSETS}/${name}`, remove: true }]);
    this.assets.delete(name);
    return true;
  }

  /** Writes several files as a single commit. */
  async commit(message, changes, attempt = 0) {
    const branch = await this.resolveBranch();
    const ref = await this.request('GET', `/git/ref/heads/${branch}`);
    if (!ref) throw new GitHubError(`Branch "${branch}" not found`, 404);

    const head = ref.object.sha;
    const parent = await this.request('GET', `/git/commits/${head}`);
    const entries = await Promise.all(changes.map(async (change) => {
      if (change.remove) return { path: change.path, mode: BLOB_MODE, type: 'blob', sha: null };
      if (change.bytes) {
        const blob = await this.request('POST', '/git/blobs', {
          content: change.bytes.toString('base64'),
          encoding: 'base64'
        });
        return { path: change.path, mode: BLOB_MODE, type: 'blob', sha: blob.sha };
      }
      return { path: change.path, mode: BLOB_MODE, type: 'blob', content: change.content };
    }));

    const tree = await this.request('POST', '/git/trees', {
      base_tree: parent.tree.sha,
      tree: entries
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
        const files = page ? Compose.toFiles(page.source) : [];
        return { ...meta, files: files.map((file) => file.name), source: files };
      })
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  async get(slug) {
    if (!SLUG_RE.test(slug)) return null;
    await this.ready();
    const page = this.pages.get(slug);
    if (!page) return null;
    const files = Compose.toFiles(page.source);
    return {
      ...page.meta,
      files: files.map((file) => file.name),
      entry: page.meta.entry || Compose.entryOf(files),
      source: files
    };
  }

  /** The served contents of one file in a deploy. */
  async file(slug, name) {
    if (!SLUG_RE.test(slug)) return null;
    await this.ready();
    const page = this.pages.get(slug);
    if (!page) return null;

    const files = Compose.toFiles(page.source);
    const wanted = name || page.meta.entry || Compose.entryOf(files);
    if (!wanted || !Compose.isValidName(wanted)) return null;

    const body = Compose.serveFile(files, wanted, { title: page.meta.name });
    return body === null ? null : { name: wanted, body, type: Compose.fileType(wanted) };
  }

  async html(slug) {
    const served = await this.file(slug);
    return served ? served.body : null;
  }

  async save(input) {
    const checked = validateSource(input);
    if (!checked.ok) return checked;
    const files = checked.files;

    await this.ready();
    const title = String(input.name || '').trim() || 'Untitled page';

    let target = input.slug;
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
      entry: Compose.entryOf(files),
      files: files.map((file) => file.name),
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now,
      version: existing ? (existing.version || 1) + 1 : 1
    };

    const nextIndex = new Map(this.index);
    nextIndex.set(target, meta);

    const changes = [
      { path: MANIFEST, content: JSON.stringify({ pages: Array.from(nextIndex.values()) }, null, 2) },
      { path: DIRECTORY, content: renderDirectory(Array.from(nextIndex.values())) },
      { path: `${ROOT}/${target}/page.json`, content: JSON.stringify({ meta, source: files }, null, 2) }
    ];

    files.forEach((file) => {
      changes.push({
        path: `${ROOT}/${target}/${file.name}`,
        content: Compose.serveFile(files, file.name, { title })
      });
    });

    // A file the project no longer has must be deleted, or the old copy would
    // linger in the tree and keep being served.
    const previous = this.pages.get(target);
    if (previous) {
      const keep = new Set(files.map((file) => file.name));
      Compose.toFiles(previous.source).forEach((file) => {
        if (!keep.has(file.name)) changes.push({ path: `${ROOT}/${target}/${file.name}`, remove: true });
      });
    }

    try {
      await this.commit(`Publish ${target} (v${meta.version})`, changes);
    } catch (err) {
      return { ok: false, status: err.status === 403 ? 403 : 502, error: githubHint(err) };
    }

    this.index = nextIndex;
    this.pages.set(target, { meta, source: files });
    return { ok: true, site: meta, created: !existing };
  }

  async remove(slug) {
    if (!SLUG_RE.test(slug)) return false;
    await this.ready();
    if (!this.index.has(slug)) return false;

    const nextIndex = new Map(this.index);
    nextIndex.delete(slug);

    const changes = [
      { path: MANIFEST, content: JSON.stringify({ pages: Array.from(nextIndex.values()) }, null, 2) },
      { path: DIRECTORY, content: renderDirectory(Array.from(nextIndex.values())) },
      { path: `${ROOT}/${slug}/page.json`, remove: true }
    ];
    const page = this.pages.get(slug);
    Compose.toFiles(page ? page.source : {}).forEach((file) => {
      changes.push({ path: `${ROOT}/${slug}/${file.name}`, remove: true });
    });

    await this.commit(`Unpublish ${slug}`, changes);

    this.index = nextIndex;
    this.pages.delete(slug);
    return true;
  }
}

/**
 * A plain directory of everything published, so /published/ is a useful page
 * rather than a 404 when someone trims the address back.
 */
function renderDirectory(pages) {
  const sorted = pages.slice().sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  const items = sorted.length
    ? sorted.map((page) => `    <li>
      <a href="./${encodeURIComponent(page.slug)}/">${escapeHtml(page.name)}</a>
      <span>v${page.version} · ${escapeHtml(String(page.updatedAt).slice(0, 10))}</span>
    </li>`).join('\n')
    : '    <li class="empty">Nothing published yet.</li>';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Published pages</title>
<style>
:root { color-scheme: dark }
body {
  margin: 0; padding: 48px 20px; background: #0e1116; color: #e6e9ef;
  font: 16px/1.6 ui-sans-serif, system-ui, -apple-system, sans-serif;
}
main { max-width: 40rem; margin: 0 auto }
h1 { margin: 0 0 4px; font-size: 1.5rem; letter-spacing: -0.01em }
p.sub { margin: 0 0 28px; color: #97a1b2; font-size: .9rem }
ul { margin: 0; padding: 0; list-style: none; display: grid; gap: 2px }
li {
  display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 12px;
  padding: 14px 0; border-bottom: 1px solid #262e3a;
}
li a { color: #6ea8fe; font-weight: 500; text-decoration: none }
li a:hover { text-decoration: underline }
li span { margin-left: auto; color: #77839a; font-size: .8rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace }
li.empty { color: #77839a; justify-content: center; padding: 32px 0 }
</style>
</head>
<body>
<main>
  <h1>Published pages</h1>
  <p class="sub">${sorted.length} page${sorted.length === 1 ? '' : 's'}, published with Actually Useful.</p>
  <ul>
${items}
  </ul>
</main>
</body>
</html>
`;
}

/** Turns a GitHub failure into something a person can act on. */
function githubHint(err) {
  if (err.status === 401) return 'GitHub rejected the token. Check AU_GITHUB_TOKEN has not expired.';
  if (err.status === 403) return 'The token lacks permission to write to this repository (needs Contents: read and write).';
  if (err.status === 404) return 'Repository or branch not found. Check AU_GITHUB_REPO.';
  return err.message || 'Could not reach GitHub.';
}

module.exports = { GitHubStore, GitHubError, ROOT, MANIFEST, DIRECTORY, ASSETS, renderDirectory };
