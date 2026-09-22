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
  const blobs = new Map();
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
      const target = decodeURIComponent(contents[1]);

      if (!files.has(target)) {
        // Maybe it names a directory; list what sits directly under it.
        const children = [];
        files.forEach((value, key) => {
          if (!key.startsWith(`${target}/`)) return;
          const name = key.slice(target.length + 1);
          if (name.includes('/')) return;
          children.push({ name, path: key, type: 'file', size: Buffer.from(value).length });
        });
        if (children.length) return send(200, children);
        return send(404, { message: 'Not Found' });
      }

      return send(200, {
        content: Buffer.from(files.get(target)).toString('base64'),
        encoding: 'base64',
        sha: `blob-${target}`
      });
    }

    const readRef = rest.match(/^\/git\/ref\/heads\/(.+)$/);
    if (readRef && req.method === 'GET') {
      return send(200, { object: { sha: `commit-${commits.length}` } });
    }

    if (/^\/git\/commits\/.+$/.test(rest) && req.method === 'GET') {
      return send(200, { tree: { sha: `tree-${commits.length}` } });
    }

    if (rest === '/git/blobs' && req.method === 'POST') {
      return readBody(req, (body) => {
        seq += 1;
        const sha = `blob-${seq}`;
        blobs.set(sha, Buffer.from(body.content, body.encoding || 'utf8'));
        send(201, { sha });
      });
    }

    if (rest === '/git/trees' && req.method === 'POST') {
      return readBody(req, (body) => {
        (body.tree || []).forEach((entry) => {
          if (entry.sha === null) files.delete(entry.path);
          else if (entry.content !== undefined) files.set(entry.path, entry.content);
          else files.set(entry.path, blobs.get(entry.sha));
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

test('publishing writes the page, its source and the indexes in one commit', async () => {
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
      'published/index.html',
      'published/index.json',
      'published/mi-primera-pagina/app.js',
      'published/mi-primera-pagina/index.html',
      'published/mi-primera-pagina/page.json',
      'published/mi-primera-pagina/styles.css'
    ]);

    const page = files.get('published/mi-primera-pagina/index.html');
    assert.match(page, /<h1>hola<\/h1>/);
    assert.match(page, /<title>Mi Primera Página<\/title>/);
    // Styles and scripts are published as sibling files the page links.
    assert.match(page, /href="styles\.css"/);
    assert.strictEqual(files.get('published/mi-primera-pagina/styles.css'), 'h1{color:red}');
    assert.strictEqual(files.get('published/mi-primera-pagina/app.js'), 'console.log(1)');

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
    assert.deepStrictEqual(list[0].files, ['index.html', 'styles.css']);
    assert.strictEqual(list[0].source[0].content, '<p>v1</p>');
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

    assert.deepStrictEqual(Array.from(files.keys()).sort(), [
      'published/index.html',
      'published/index.json'
    ]);
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
      assert.strictEqual(created.url, `${at}/p/desde-la-app/`);
      assert.strictEqual(
        created.permanentUrl,
        'https://scipiotoni.github.io/Actually-Useful/published/desde-la-app/'
      );

      const page = await fetch(created.url);
      assert.strictEqual(page.status, 200);
      assert.match(await page.text(), /<h1>vivo<\/h1>/);

      const { deploys } = await (await fetch(`${at}/api/deploys`)).json();
      assert.strictEqual(deploys.length, 1);
      assert.strictEqual(deploys[0].source[0].content, '<h1>vivo</h1>');

      const del = await fetch(`${at}/api/deploys/desde-la-app`, { method: 'DELETE' });
      assert.strictEqual(del.status, 200);
      assert.strictEqual((await fetch(`${at}/p/desde-la-app/`)).status, 404);
    } finally {
      app.close();
    }
  });
});

test('a browsable directory is written beside the pages', async () => {
  await withFake({}, async ({ make, files }) => {
    const store = make();
    await store.save({ name: 'Primera', html: '<p>1</p>' });
    await store.save({ name: 'Segunda & <otra>', html: '<p>2</p>' });

    const directory = files.get('published/index.html');
    assert.ok(directory, 'published/index.html must exist');
    assert.match(directory, /^<!doctype html>/);
    assert.match(directory, /<title>Published pages<\/title>/);
    assert.match(directory, /2 pages/);
    assert.match(directory, /href="\.\/primera\/"/);
    assert.match(directory, /href="\.\/segunda-otra\/"/);
    // The page name is escaped, not injected as markup.
    assert.match(directory, /Segunda &amp; &lt;otra&gt;/);
    assert.ok(!directory.includes('<otra>'));

    // Newest first.
    assert.ok(directory.indexOf('./segunda-otra/') < directory.indexOf('./primera/'));
  });
});

test('the directory is rewritten when a page is unpublished', async () => {
  await withFake({}, async ({ make, files }) => {
    const store = make();
    await store.save({ name: 'Se queda', html: '<p>a</p>' });
    await store.save({ name: 'Se va', html: '<p>b</p>' });
    await store.remove('se-va');

    const directory = files.get('published/index.html');
    assert.match(directory, /1 page,/);
    assert.match(directory, /href="\.\/se-queda\/"/);
    assert.ok(!directory.includes('./se-va/'));
  });
});

test('the directory says so when nothing is published', async () => {
  await withFake({}, async ({ make, files }) => {
    const store = make();
    await store.save({ name: 'Solitaria', html: '<p>x</p>' });
    await store.remove('solitaria');
    assert.match(files.get('published/index.html'), /Nothing published yet/);
  });
});

// --------------------------------------------------------------------------
// Uploaded images
// --------------------------------------------------------------------------

const RED_PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('fake pixel data for the test')
]);
const PNG_UPLOAD = `data:image/png;base64,${RED_PNG.toString('base64')}`;

test('an uploaded image is committed as a binary blob', async () => {
  await withFake({}, async ({ make, files, commits }) => {
    const store = make();
    const result = await store.saveAsset({ name: 'Mi Logo.PNG', data: PNG_UPLOAD });

    assert.ok(result.ok, result.error);
    assert.strictEqual(result.asset.name, 'mi-logo.png');
    assert.strictEqual(result.asset.size, RED_PNG.length);
    assert.deepStrictEqual(commits, ['Add image mi-logo.png']);

    // Stored under published/assets so "../assets/x" resolves from a page.
    const stored = files.get('published/assets/mi-logo.png');
    assert.ok(stored, 'the image must be written to published/assets');
    assert.ok(Buffer.from(stored).equals(RED_PNG), 'bytes must survive the round trip');
  });
});

test('a page and its image sit at the paths the relative link needs', async () => {
  await withFake({}, async ({ make, files }) => {
    const store = make();
    await store.saveAsset({ name: 'foto.png', data: PNG_UPLOAD });
    await store.save({ name: 'Con Foto', html: '<img src="../assets/foto.png">' });

    // published/con-foto/index.html + ../assets/foto.png -> published/assets/foto.png
    assert.ok(files.has('published/con-foto/index.html'));
    assert.ok(files.has('published/assets/foto.png'));
    assert.match(files.get('published/con-foto/index.html'), /src="\.\.\/assets\/foto\.png"/);
  });
});

test('images are found again after a restart', async () => {
  await withFake({}, async ({ make }) => {
    await make().saveAsset({ name: 'persistente.png', data: PNG_UPLOAD });

    const restarted = make();
    const list = await restarted.listAssets();
    assert.deepStrictEqual(list.map((a) => a.name), ['persistente.png']);

    const bytes = await restarted.readAsset('persistente.png');
    assert.ok(bytes.equals(RED_PNG));
  });
});

test('repeated image names do not overwrite each other', async () => {
  await withFake({}, async ({ make }) => {
    const store = make();
    const a = await store.saveAsset({ name: 'foto.png', data: PNG_UPLOAD });
    const b = await store.saveAsset({ name: 'foto.png', data: PNG_UPLOAD });
    assert.strictEqual(a.asset.name, 'foto.png');
    assert.strictEqual(b.asset.name, 'foto-2.png');
  });
});

test('deleting an image removes it from the repository', async () => {
  await withFake({}, async ({ make, files, commits }) => {
    const store = make();
    await store.saveAsset({ name: 'temporal.png', data: PNG_UPLOAD });
    assert.strictEqual(await store.removeAsset('temporal.png'), true);

    assert.ok(!files.has('published/assets/temporal.png'));
    assert.strictEqual(commits[1], 'Remove image temporal.png');
    assert.strictEqual(await store.readAsset('temporal.png'), null);
    assert.strictEqual(await store.removeAsset('temporal.png'), false);
  });
});

test('a file that is not an image is refused before any commit', async () => {
  await withFake({}, async ({ make, files, commits }) => {
    const store = make();
    const disguised = `data:image/png;base64,${Buffer.from('MZ this is not a picture').toString('base64')}`;

    const result = await store.saveAsset({ name: 'trampa.png', data: disguised });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.status, 415);
    assert.strictEqual(files.size, 0);
    assert.deepStrictEqual(commits, []);

    assert.strictEqual(await store.readAsset('../../secret'), null);
  });
});


test('a multi-file project publishes every file and cleans up removals', async () => {
  await withFake({}, async ({ make, files }) => {
    const store = make();
    await store.save({
      name: 'Sitio',
      files: [
        { name: 'index.html', content: '<a href="about.html">about</a>' },
        { name: 'about.html', content: '<h1>About</h1>' },
        { name: 'styles.css', content: 'h1{color:red}' }
      ]
    });

    assert.ok(files.has('published/sitio/index.html'));
    assert.ok(files.has('published/sitio/about.html'));
    assert.strictEqual(files.get('published/sitio/styles.css'), 'h1{color:red}');
    // A sibling link needs no rewriting: the layout already matches.
    assert.match(files.get('published/sitio/index.html'), /href="about\.html"/);

    await store.save({
      name: 'Sitio',
      slug: 'sitio',
      files: [{ name: 'index.html', content: '<p>solo</p>' }]
    });
    assert.ok(!files.has('published/sitio/about.html'), 'the dropped page must go');
    assert.ok(!files.has('published/sitio/styles.css'), 'the dropped stylesheet must go');
    assert.ok(files.has('published/sitio/index.html'));
  });
});

test('unpublishing takes every file with it', async () => {
  await withFake({}, async ({ make, files }) => {
    const store = make();
    await store.save({
      name: 'Efimero',
      files: [
        { name: 'index.html', content: '<p>a</p>' },
        { name: 'extra.html', content: '<p>b</p>' },
        { name: 'styles.css', content: 'p{}' }
      ]
    });
    await store.remove('efimero');

    const left = Array.from(files.keys()).filter((path) => path.startsWith('published/efimero/'));
    assert.deepStrictEqual(left, [], 'nothing of the deploy should remain');
  });
});

test('a project whose entry is not index.html still gets one published', async () => {
  await withFake({}, async ({ make, files }) => {
    const store = make();
    const saved = await store.save({
      name: 'Neon Lobby',
      files: [
        { name: 'chat.html', content: '<h1>Lobby</h1>' },
        { name: 'manifest.json', content: '{"start_url":"./"}' },
        { name: 'sw.js', content: 'self.addEventListener("install", function () {});' }
      ]
    });
    assert.ok(saved.ok, saved.error);
    assert.strictEqual(saved.site.entry, 'chat.html');

    // GitHub Pages serves a directory by looking for this exact name.
    const standIn = files.get('published/neon-lobby/index.html');
    assert.ok(standIn, 'without this, the folder URL is a 404');
    assert.strictEqual(standIn, files.get('published/neon-lobby/chat.html'));

    // It is published, not part of the project.
    assert.deepStrictEqual(saved.site.files, ['chat.html', 'manifest.json', 'sw.js']);
    assert.deepStrictEqual(
      (await store.get('neon-lobby')).source.map((file) => file.name),
      ['chat.html', 'manifest.json', 'sw.js']
    );
  });
});

test('renaming the entry away from index.html keeps the folder served', async () => {
  await withFake({}, async ({ make, files }) => {
    const store = make();
    await store.save({ name: 'Rename', files: [{ name: 'index.html', content: '<h1>before</h1>' }] });
    assert.match(files.get('published/rename/index.html'), /before/);

    await store.save({
      name: 'Rename',
      slug: 'rename',
      files: [{ name: 'chat.html', content: '<h1>after</h1>' }]
    });

    // The cleanup must not take the stand-in with the old file.
    assert.ok(files.has('published/rename/index.html'), 'the folder URL must keep working');
    assert.match(files.get('published/rename/index.html'), /after/);
    assert.match(files.get('published/rename/chat.html'), /after/);
  });
});

test('unpublishing removes the stand-in as well', async () => {
  await withFake({}, async ({ make, files }) => {
    const store = make();
    await store.save({ name: 'Gone', files: [{ name: 'chat.html', content: '<h1>x</h1>' }] });
    assert.ok(files.has('published/gone/index.html'));

    await store.remove('gone');
    const left = Array.from(files.keys()).filter((p) => p.startsWith('published/gone/'));
    assert.deepStrictEqual(left, [], 'nothing of the deploy should remain');
  });
});
