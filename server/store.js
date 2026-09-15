'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Compose = require('../public/compose.js');
const { slugify } = Compose;
const { ASSET_NAME_RE, assetName, nextFreeName, decodeUpload } = require('./assets.js');

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,59}$/;
const MAX_SOURCE_BYTES = 2 * 1024 * 1024; // per pane

const MAX_FILES = 40;

/**
 * Checks the files a deploy carries, accepting the original three-pane shape
 * as well so projects published before multi-file still work.
 * @returns {{ok: true, files: Array} | {ok: false, status: number, error: string}}
 */
function validateSource(input) {
  const files = Compose.toFiles(input);

  if (!files.length) return { ok: false, status: 400, error: 'A project needs at least one file' };
  if (files.length > MAX_FILES) {
    return { ok: false, status: 413, error: `A project can hold at most ${MAX_FILES} files` };
  }

  const seen = new Set();
  for (const file of files) {
    if (!file || !Compose.isValidName(file.name)) {
      return {
        ok: false,
        status: 400,
        error: `"${file && file.name}" is not a valid file name. Use letters, digits, - . _ and end in .html, .css or .js`
      };
    }
    if (seen.has(file.name)) {
      return { ok: false, status: 400, error: `Two files are called "${file.name}"` };
    }
    seen.add(file.name);

    if (typeof file.content !== 'string') {
      return { ok: false, status: 400, error: `"${file.name}" must hold text` };
    }
    if (Buffer.byteLength(file.content, 'utf8') > MAX_SOURCE_BYTES) {
      return { ok: false, status: 413, error: `"${file.name}" exceeds the 2 MB limit` };
    }
  }

  if (!Compose.entryOf(files)) {
    return { ok: false, status: 400, error: 'A project needs at least one .html file' };
  }

  return { ok: true, files };
}

/** Picks a free slug from `taken`, appending -2, -3 ... on collision. */
function nextFreeSlug(base, taken) {
  const root = slugify(base);
  if (!taken.has(root)) return root;
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${root}-${n}`.slice(0, 60).replace(/-+$/, '');
    if (!taken.has(candidate)) return candidate;
  }
  return `${root}-${crypto.randomBytes(3).toString('hex')}`.slice(0, 60);
}

/**
 * File-backed storage for deployed pages.
 * Layout: <root>/<slug>/{index.html,meta.json}
 */
class DeployStore {
  constructor(root) {
    this.root = path.resolve(root);
  }

  init() {
    fs.mkdirSync(this.root, { recursive: true });
    fs.mkdirSync(this.assetsDir, { recursive: true });
    return this;
  }

  /** Images live beside the pages; "_assets" can never collide with a slug. */
  get assetsDir() {
    return path.join(this.root, '_assets');
  }

  assetPath(name) {
    if (!ASSET_NAME_RE.test(name)) return null;
    const file = path.resolve(this.assetsDir, name);
    return file === path.join(this.assetsDir, name) ? file : null;
  }

  listAssets() {
    let names = [];
    try {
      names = fs.readdirSync(this.assetsDir);
    } catch {
      return [];
    }
    return names
      .filter((name) => ASSET_NAME_RE.test(name))
      .map((name) => {
        const stat = fs.statSync(path.join(this.assetsDir, name));
        return { name, size: stat.size, updatedAt: stat.mtime.toISOString() };
      })
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  readAsset(name) {
    const file = this.assetPath(name);
    if (!file) return null;
    try {
      return fs.readFileSync(file);
    } catch {
      return null;
    }
  }

  saveAsset({ name, data }) {
    const decoded = decodeUpload(data);
    if (!decoded.ok) return decoded;

    const taken = new Set(this.listAssets().map((asset) => asset.name));
    const target = nextFreeName(assetName(name, decoded.extension), taken);
    const file = this.assetPath(target);
    if (!file) return { ok: false, status: 400, error: 'Invalid file name' };

    fs.mkdirSync(this.assetsDir, { recursive: true });
    fs.writeFileSync(file, decoded.buffer);
    return {
      ok: true,
      asset: { name: target, size: decoded.buffer.length, updatedAt: new Date().toISOString() }
    };
  }

  removeAsset(name) {
    const file = this.assetPath(name);
    if (!file || !fs.existsSync(file)) return false;
    fs.rmSync(file);
    return true;
  }

  /** Resolves a slug to a directory, refusing anything that escapes the root. */
  dirFor(slug) {
    if (!SLUG_RE.test(slug)) return null;
    const dir = path.resolve(this.root, slug);
    if (dir !== path.join(this.root, slug)) return null;
    return dir;
  }

  list() {
    let entries = [];
    try {
      entries = fs.readdirSync(this.root, { withFileTypes: true });
    } catch {
      return [];
    }
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => this.get(e.name))
      .filter(Boolean)
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  get(slug) {
    const dir = this.dirFor(slug);
    if (!dir) return null;
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
      const files = Compose.toFiles(meta.source !== undefined ? meta.source : meta);
      return {
        ...meta,
        slug,
        files: files.map((file) => file.name),
        entry: meta.entry || Compose.entryOf(files),
        source: files
      };
    } catch {
      return null;
    }
  }

  /** The served contents of one file in a deploy. */
  file(slug, name) {
    const site = this.get(slug);
    if (!site) return null;
    const wanted = name || site.entry;
    if (!Compose.isValidName(wanted)) return null;
    const body = Compose.serveFile(site.source, wanted, { title: site.name });
    return body === null ? null : { name: wanted, body, type: Compose.fileType(wanted) };
  }

  /** The deploy's entry page, for callers that just want the page. */
  html(slug) {
    const served = this.file(slug);
    return served ? served.body : null;
  }

  /** Picks a free slug, appending -2, -3 ... on collision. */
  availableSlug(base) {
    return nextFreeSlug(base, new Set(this.list().map((site) => site.slug)));
  }

  /**
   * Creates a new deploy, or updates an existing one when `slug` is given.
   * @returns {{ok: true, site: object} | {ok: false, error: string, status: number}}
   */
  save(input) {
    const checked = validateSource(input);
    if (!checked.ok) return checked;
    const files = checked.files;

    const title = String(input.name || '').trim() || 'Untitled page';
    let target = input.slug;
    let existing = null;

    if (target) {
      if (!SLUG_RE.test(target)) {
        return { ok: false, status: 400, error: 'Invalid slug' };
      }
      existing = this.get(target);
    } else {
      target = this.availableSlug(title);
    }

    const dir = this.dirFor(target);
    if (!dir) return { ok: false, status: 400, error: 'Invalid slug' };

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

    fs.mkdirSync(dir, { recursive: true });

    // Drop files the project no longer has, so a rename does not leave a ghost.
    const keep = new Set(files.map((file) => file.name));
    for (const name of fs.readdirSync(dir)) {
      if (name !== 'meta.json' && !keep.has(name)) {
        fs.rmSync(path.join(dir, name), { force: true });
      }
    }

    for (const file of files) {
      fs.writeFileSync(path.join(dir, file.name), Compose.serveFile(files, file.name, { title }), 'utf8');
    }
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ ...meta, source: files }, null, 2), 'utf8');

    return { ok: true, site: meta, created: !existing };
  }

  remove(slug) {
    const dir = this.dirFor(slug);
    if (!dir || !fs.existsSync(dir)) return false;
    fs.rmSync(dir, { recursive: true, force: true });
    return true;
  }
}

module.exports = { DeployStore, SLUG_RE, MAX_SOURCE_BYTES, MAX_FILES, validateSource, nextFreeSlug };
