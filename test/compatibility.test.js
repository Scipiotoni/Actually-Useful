'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { DeployStore } = require('../server/store.js');
const Compose = require('../public/compose.js');

/**
 * The exact shapes found in the live repository on 2026-09-22, when this
 * editor already had four published projects. Every one of them has to keep
 * loading and serving, whatever changes afterwards.
 */
const LIVE_SHAPES = {
  // Published before multi-file existed: three panes, no entry, no file list.
  'dominion-command': {
    meta: { slug: 'dominion-command', name: 'Dominion command', version: 6 },
    source: { html: '<h1>Dominion</h1>', css: 'h1{color:#0f0}', js: '' }
  },
  // A single-page project in the current shape.
  portal: {
    meta: { slug: 'portal', name: 'Portal', entry: 'index.html', files: ['index.html'], version: 5 },
    source: [{ name: 'index.html', content: '<h1>Portal</h1>' }]
  },
  // Five pages linking to each other.
  'five-pages': {
    meta: {
      slug: 'five-pages',
      name: 'Untitled page',
      entry: 'index.html',
      files: ['index.html', 'easymath.html', 'easysteam.html', 'rubberbandcar.html', 'holographicprojector.html'],
      version: 3
    },
    source: [
      { name: 'index.html', content: '<a href="easymath.html">math</a><a href="easysteam.html">steam</a>' },
      { name: 'easymath.html', content: '<h1>math</h1>' },
      { name: 'easysteam.html', content: '<h1>steam</h1>' },
      { name: 'rubberbandcar.html', content: '<h1>car</h1>' },
      { name: 'holographicprojector.html', content: '<h1>projector</h1>' }
    ]
  }
};

function storeWithLiveProjects() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'au-compat-'));
  const store = new DeployStore(root).init();
  for (const [slug, page] of Object.entries(LIVE_SHAPES)) {
    const dir = path.join(root, slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(page, null, 2));
  }
  return { store, root };
}

test('every project already published still loads', () => {
  const { store, root } = storeWithLiveProjects();
  try {
    for (const slug of Object.keys(LIVE_SHAPES)) {
      const site = store.get(slug);
      assert.ok(site, `${slug} must still load`);
      assert.ok(Array.isArray(site.source), `${slug} must expose its files as a list`);
      assert.ok(site.entry, `${slug} must resolve an entry page`);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a project from before multi-file keeps its three panes', () => {
  const { store, root } = storeWithLiveProjects();
  try {
    const site = store.get('dominion-command');
    assert.deepStrictEqual(site.files, ['index.html', 'styles.css']);
    assert.strictEqual(site.entry, 'index.html');

    const page = store.file('dominion-command', 'index.html');
    assert.match(page.body, /<h1>Dominion<\/h1>/);
    assert.strictEqual(store.file('dominion-command', 'styles.css').body, 'h1{color:#0f0}');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a project with several pages still serves each one', () => {
  const { store, root } = storeWithLiveProjects();
  try {
    for (const name of LIVE_SHAPES['five-pages'].meta.files) {
      const served = store.file('five-pages', name);
      assert.ok(served, `${name} must still be served`);
      assert.strictEqual(served.type, 'html');
    }
    assert.match(store.file('five-pages').body, /href="easymath\.html"/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('republishing an old project does not damage it', () => {
  const { store, root } = storeWithLiveProjects();
  try {
    const before = store.get('dominion-command');
    const saved = store.save({
      name: before.name,
      slug: 'dominion-command',
      files: before.source
    });

    assert.ok(saved.ok, saved.error);
    assert.strictEqual(saved.site.version, 7, 'the version carries on from where it was');
    assert.match(store.file('dominion-command', 'index.html').body, /<h1>Dominion<\/h1>/);
    assert.strictEqual(store.file('dominion-command', 'styles.css').body, 'h1{color:#0f0}');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the editor can still reopen every published shape', () => {
  for (const [slug, page] of Object.entries(LIVE_SHAPES)) {
    const files = Compose.toFiles(page.source);
    assert.ok(files.length, `${slug} must produce files for the editor`);
    files.forEach((file) => {
      assert.ok(Compose.isValidName(file.name), `${file.name} must stay a valid name`);
      assert.strictEqual(typeof file.content, 'string');
    });
    assert.ok(Compose.entryOf(files), `${slug} must have a page to open`);
  }
});
