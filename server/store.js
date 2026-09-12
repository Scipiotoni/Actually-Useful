'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { compose, slugify } = require('../public/compose.js');

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,59}$/;
const MAX_SOURCE_BYTES = 2 * 1024 * 1024; // per pane

/**
 * Checks the three panes a deploy carries.
 * @returns {{ok: true} | {ok: false, status: number, error: string}}
 */
function validateSource({ html = '', css = '', js = '' }) {
  for (const [field, value] of Object.entries({ html, css, js })) {
    if (typeof value !== 'string') {
      return { ok: false, status: 400, error: `"${field}" must be a string` };
    }
    if (Buffer.byteLength(value, 'utf8') > MAX_SOURCE_BYTES) {
      return { ok: false, status: 413, error: `"${field}" exceeds the 2 MB limit` };
    }
  }
  return { ok: true };
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
    return this;
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
      return { ...meta, slug };
    } catch {
      return null;
    }
  }

  html(slug) {
    const dir = this.dirFor(slug);
    if (!dir) return null;
    try {
      return fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
    } catch {
      return null;
    }
  }

  /** Picks a free slug, appending -2, -3 ... on collision. */
  availableSlug(base) {
    return nextFreeSlug(base, new Set(this.list().map((site) => site.slug)));
  }

  /**
   * Creates a new deploy, or updates an existing one when `slug` is given.
   * @returns {{ok: true, site: object} | {ok: false, error: string, status: number}}
   */
  save({ name, slug, html = '', css = '', js = '' }) {
    const invalid = validateSource({ html, css, js });
    if (!invalid.ok) return invalid;

    const title = String(name || '').trim() || 'Untitled page';
    let target = slug;
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
      source: { html, css, js },
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now,
      version: existing ? (existing.version || 1) + 1 : 1
    };

    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), compose({ html, css, js, title }), 'utf8');
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');

    return { ok: true, site: meta, created: !existing };
  }

  remove(slug) {
    const dir = this.dirFor(slug);
    if (!dir || !fs.existsSync(dir)) return false;
    fs.rmSync(dir, { recursive: true, force: true });
    return true;
  }
}

module.exports = { DeployStore, SLUG_RE, MAX_SOURCE_BYTES, validateSource, nextFreeSlug };
