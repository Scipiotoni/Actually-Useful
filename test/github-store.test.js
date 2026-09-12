'use strict';

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

const { GitHubStore } = require('../server/github-store.js');
const { createApp } = require('../server/index.js');

/**
 * A stand-in for the GitHub API holding a virtual file tree, so the store can
 * be exercised without a token or a network.
 */
function fakeGitHub({ defaultBranch = 'main' } = {}) {
  const files = new Map();
  const commits = [];
  let seq = 0;

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://fake');
    const path = url.pathname;
    const send = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body === undefined ? {} : body));
    };

    if (req.headers.authorization !== 'Bearer test-token') {
      return send(401, { message: 'Bad credentials' });
    }

    const repo = path.match(/^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/);
    if (!repo) return send(404, { message: 'Not Found' });
    const rest = repo[3] || '';

    if (rest === '') return send(200, { default_branch: defaultBranch });

    const contents = rest.match(/^\/contents\/(.+)$/);
    if (contents && req.method === 'GET') {
      const file = decodeURIComponent(contents[1]);
      if (!files.has(file)) return send(404, { message: 'Not Found' });
      return send(200, {
        content: Buffer.from(files.get(file), 'utf8').toString('base64'),
        encoding: 'base64',
        sha: `blob-${file}`
      });
    }

    const readRef = rest.match(/^\/git\/ref\/heads\/(.+)$/);
    if (readRef && req.method === 'GET') {
      return send(200, { object: { sha: `commit-${commits.length}` } });
    }

    if (/^\/git\/commits\/.+$/.test(rest) && req.method === 'GET') {
      return send(200, { tree: { sha: `tree-${commits.length}` } });
    }

    if (rest === '/git/trees' && req.method === 'POST') {
      return readBody(req, (body) => {
        (body.tree || []).forEach((entry) => {
          if (entry.sha === null) files.delete(entry.path);
          else files.set(entry.path, entry.content);
        });
        seq += 1;
        send(201, { sha: `tree-${seq}` });
      });
    }

    if (rest === '/git/commits' && req.method === 'POST') {
      return readBody(req, (body) => {
        commits.push(body.message);
        send(201, { sha: `commit-${commits.length}` });
      });
    }

    if (/^\/git\/refs\/heads\/.+$/.test(rest) && req.method === 'PATCH') {
      return readBody(req, () => send(200, {}));
    }

    return send(404, { message: 'Not Found' });
  });

  return { server, files, commits };
}

function readBody(req, done) {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => done(raw ? JSON.parse(raw) : {}));
}

async function withFake(options, fn) {
  const fake = fakeGitHub(options);
  await new Promise((r) => fake.server.listen(0, '127.0.0.1', r));
  const api = `http://127.0.0.1:${fake.server.address().port}`;
  const make = (extra = {}) => new GitHubStore({
    token: 'test-token',
    repo: 'Scipiotoni/Actually-Useful',
    api,
    ...extra
  });
  try {
    await fn({ ...fake, api, make });
  } finally {
    fake.server.close();
  }
}

test('a fresh repository starts with no pages', async () => {
  await withFake({}, async ({ make }) => {
    assert.deepStrictEqual(await make().list(), []);
    assert.strictEqual(await make().get('nothing'), null);
  });
});

test('publishing writes three files in a single commit', async () => {
  await withFake({}, async ({ make, files, commits }) => {
    const store = make();
    const result = await store.save({
      name: 'Mi Primera Página',
      html: '<h1>hola</h1>',
      css: 'h1{color:red}',
      js: 'console.log(1)'
    });

    assert.ok(result.ok);
    assert.strictEqual(result.site.slug, 'mi-primera-pagina');
    assert.strictEqual(result.site.version, 1);
    assert.deepStrictEqual(commits, ['Publish mi-primera-pagina (v1)']);

    assert.deepStrictEqual(Array.from(files.keys()).sort(), [
      'published/index.json',
      'published/mi-primera-pagina/index.html',
      'published/mi-primera-pagina/page.json'
    ]);

    const page = files.get('published/mi-primera-pagina/index.html');
    assert.match(page, /<h1>hola<\/h1>/);
    assert.match(page, /color:red/);
    assert.match(page, /<title>Mi Primera Página<\/title>/);

    const manifest = JSON.parse(files.get('published/index.json'));
    assert.strictEqual(manifest.pages.length, 1);
    assert.strictEqual(manifest.pages[0].slug, 'mi-primera-pagina');
    // Source lives with the page, not in the manifest.
    assert.ok(!('source' in manifest.pages[0]));
  });
});

test('a new instance loads what a previous one published', async () => {
  await withFake({}, async ({ make }) => {
    await make().save({ name: 'Persistente', html: '<p>v1</p>', css: 'p{}', js: '' });

    // Simulates the server restarting with an empty cache.
    const restarted = make();
    const list = await restarted.list();
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0].slug, 'persistente');
    assert.strictEqual(list[0].source.html, '<p>v1</p>');
    assert.match(await restarted.html('persistente'), /<p>v1<\/p>/);
  });
});

test('republishing the same slug bumps the version and keeps the address', async () => {
  await withFake({}, async ({ make, commits, files }) => {
    const store = make();
    const first = await store.save({ name: 'Versionada', html: '<p>v1</p>' });
    const second = await store.save({ name: 'Versionada', slug: first.site.slug, html: '<p>v2</p>' });

    assert.strictEqual(second.site.slug, first.site.slug);
    assert.strictEqual(second.site.version, 2);
    assert.strictEqual(second.site.createdAt, first.site.createdAt);
    assert.strictEqual(second.created, false);
    assert.deepStrictEqual(commits, ['Publish versionada (v1)', 'Publish versionada (v2)']);
    assert.match(files.get('published/versionada/index.html'), /<p>v2<\/p>/);
    assert.strictEqual(JSON.parse(files.get('published/index.json')).pages.length, 1);
  });
});

test('a repeated name gets its own slug', async () => {
  await withFake({}, async ({ make }) => {
    const store = make();
    const a = await store.save({ name: 'Choque', html: '<p>a</p>' });
    const b = await store.save({ name: 'Choque', html: '<p>b</p>' });
    assert.strictEqual(a.site.slug, 'choque');
    assert.strictEqual(b.site.slug, 'choque-2');
  });
});

test('unpublishing removes the files and the manifest entry', async () => {
  await withFake({}, async ({ make, files, commits }) => {
    const store = make();
    await store.save({ name: 'Temporal', html: '<p>x</p>' });
    assert.strictEqual(await store.remove('temporal'), true);

    assert.deepStrictEqual(Array.from(files.keys()), ['published/index.json']);
    assert.deepStrictEqual(JSON.parse(files.get('published/index.json')).pages, []);
    assert.strictEqual(commits[1], 'Unpublish temporal');
    assert.strictEqual(await store.get('temporal'), null);
    assert.strictEqual(await store.html('temporal'), null);
    assert.strictEqual(await store.remove('temporal'), false);
  });
});

test('a branch name containing slashes works', async () => {
  await withFake({ defaultBranch: 'claude/upbeat-dijkstra-wbxydj' }, async ({ make, files }) => {
    const store = make();
    const saved = await store.save({ name: 'En rama', html: '<p>ok</p>' });
    assert.ok(saved.ok, saved.error);
    assert.strictEqual(store.branch, 'claude/upbeat-dijkstra-wbxydj');
    assert.ok(files.has('published/en-rama/index.html'));
  });
});

test('rejects bad slugs and oversized panes without touching the repo', async () => {
  await withFake({}, async ({ make, files }) => {
    const store = make();
    for (const slug of ['../escape', 'a/b', 'UPPER', '.hidden']) {
      const res = await store.save({ name: 'x', slug, html: '<p>no</p>' });
      assert.strictEqual(res.ok, false, `slug ${slug} must be rejected`);
      assert.strictEqual(res.status, 400);
    }
    const big = await store.save({ name: 'Big', html: 'x'.repeat(2 * 1024 * 1024 + 1) });
    assert.strictEqual(big.status, 413);

    assert.strictEqual(await store.get('../escape'), null);
    assert.strictEqual(await store.html('a/b'), null);
    assert.strictEqual(files.size, 0, 'nothing should have been written');
  });
});

test('a rejected token produces an explainable error', async () => {
  await withFake({}, async ({ api }) => {
    const store = new GitHubStore({ token: 'wrong-token', repo: 'a/b', api });
    await assert.rejects(() => store.list(), /401|Bad credentials/);

    const result = await store.save({ name: 'x', html: '<p>y</p>' }).catch((err) => err);
    assert.ok(result instanceof Error || result.ok === false);
  });
});

test('the permanent address points at GitHub Pages', async () => {
  await withFake({}, async ({ make }) => {
    assert.strictEqual(
      make().pagesUrl('mi-pagina'),
      'https://scipiotoni.github.io/Actually-Useful/published/mi-pagina/'
    );
  });
});

test('the app serves pages straight from GitHub storage', async () => {
  await withFake({}, async ({ api }) => {
    const app = createApp({
      githubToken: 'test-token',
      githubRepo: 'Scipiotoni/Actually-Useful',
      githubApi: api
    });
    await new Promise((r) => app.listen(0, '127.0.0.1', r));
    const at = `http://127.0.0.1:${app.address().port}`;

    try {
      const config = await (await fetch(`${at}/api/config`)).json();
      assert.strictEqual(config.storage, 'github');

      const created = await (await fetch(`${at}/api/deploys`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Desde la app', html: '<h1>vivo</h1>' })
      })).json();

      assert.strictEqual(created.slug, 'desde-la-app');
      assert.strictEqual(created.url, `${at}/p/desde-la-app`);
      assert.strictEqual(
        created.permanentUrl,
        'https://scipiotoni.github.io/Actually-Useful/published/desde-la-app/'
      );

      const page = await fetch(created.url);
      assert.strictEqual(page.status, 200);
      assert.match(await page.text(), /<h1>vivo<\/h1>/);

      const { deploys } = await (await fetch(`${at}/api/deploys`)).json();
      assert.strictEqual(deploys.length, 1);
      assert.strictEqual(deploys[0].source.html, '<h1>vivo</h1>');

      const del = await fetch(`${at}/api/deploys/desde-la-app`, { method: 'DELETE' });
      assert.strictEqual(del.status, 200);
      assert.strictEqual((await fetch(`${at}/p/desde-la-app`)).status, 404);
    } finally {
      app.close();
    }
  });
});
