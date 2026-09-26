'use strict';

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DeployStore } = require('./store.js');
const auth = require('./auth.js');
const { GitHubStore } = require('./github-store.js');
const { contentType, ASSET_NAME_RE } = require('./assets.js');
const { createRunner } = require('./cpp.js');
const { createProgressStore, validate: validateProgress } = require('./learn-store.js');
const Compose = require('../public/compose.js');
const Engine = require('../public/learn/engine.js');

/** Why a write is refused in the open version. */
const OPEN_NOTE = 'This is the open version of the editor: publishing is turned off here. ' +
  'Your work stays in your browser — use Backup to download a copy.';

/** AU_OPEN=1 (or true/yes) turns on the open version. */
function openFromEnv() {
  return /^(1|true|yes|on)$/i.test(String(process.env.AU_OPEN || '').trim());
}

/**
 * At most `limit` requests per minute from one address — enough for a
 * learner, not enough to use the server as a free compile farm.
 */
function rateLimiter(limit, windowMs = 60000) {
  const hits = new Map();
  return (key) => {
    const now = Date.now();
    const recent = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (recent.length >= limit) {
      hits.set(key, recent);
      return false;
    }
    recent.push(now);
    hits.set(key, recent);
    if (hits.size > 5000) {
      for (const [k, list] of hits) if (!list.some((t) => now - t < windowMs)) hits.delete(k);
    }
    return true;
  };
}

function clientAddress(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.socket.remoteAddress || 'unknown';
}

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const DATA_DIR = process.env.AU_DATA_DIR || path.join(__dirname, '..', 'data', 'sites');
const MAX_BODY_BYTES = 8 * 1024 * 1024;

const CONTENT_TYPES = {
  html: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8'
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.yml': 'text/yaml; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8'
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store'
  });
  res.end(body);
}

function sendText(res, status, text, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'content-type': type,
    'content-length': Buffer.byteLength(text)
  });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('Payload too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(Object.assign(new Error('Invalid JSON body'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

/** Reads a login form body, accepting urlencoded (browser) or JSON (curl). */
function readForm(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 8 * 1024) {
        reject(Object.assign(new Error('Login payload too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if ((req.headers['content-type'] || '').includes('application/json')) {
        try { return resolve(JSON.parse(raw) || {}); } catch { return resolve({}); }
      }
      const params = new URLSearchParams(raw);
      resolve({ password: params.get('password') || '', next: params.get('next') || '' });
    });
    req.on('error', reject);
  });
}

function serveStatic(res, urlPath) {
  if (urlPath.includes('\0')) return sendText(res, 400, 'Bad request');

  let rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.resolve(PUBLIC_DIR, rel);
  // resolve() has already collapsed any "..", so containment is the only
  // check that means anything here — comparing against path.join of the same
  // input proves nothing, because it collapses ".." identically.
  if (file !== PUBLIC_DIR && !file.startsWith(PUBLIC_DIR + path.sep)) {
    return sendText(res, 403, 'Forbidden');
  }
  fs.readFile(file, (err, data) => {
    if (err) return sendText(res, 404, 'Not found');
    res.writeHead(200, {
      'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-cache'
    });
    res.end(data);
  });
}

/**
 * The second account (AU_ALT_PASSWORD): everything it makes is kept apart
 * from the main account's — pages in their own folder on disk and on GitHub,
 * served at their own address, with their own images and learning progress.
 */
const ALT = { id: 'alt', prefix: 'a', folder: 'alt', dataDir: '_alt', learnFile: 'learn/alt/progress.json' };

/** GitHub storage when a token is configured, local disk otherwise. */
function createStore(options) {
  // The open version never publishes, so it never touches the repository.
  if (options.open) return new DeployStore(options.dataDir || DATA_DIR).init();
  const token = options.githubToken !== undefined ? options.githubToken : process.env.AU_GITHUB_TOKEN;
  const repo = options.githubRepo !== undefined ? options.githubRepo : process.env.AU_GITHUB_REPO;
  if (token && repo) {
    return new GitHubStore({
      token,
      repo,
      branch: options.githubBranch || process.env.AU_GITHUB_BRANCH,
      api: options.githubApi || process.env.AU_GITHUB_API,
      fetchImpl: options.fetchImpl,
      ...(options.root ? { root: options.root } : {})
    }).init();
  }
  return new DeployStore(options.dataDir || DATA_DIR).init();
}

function createApp(options = {}) {
  // The open version: no password, no publishing, nothing kept on the server.
  // People keep their work in their own browser and in backup files.
  const open = options.open !== undefined ? Boolean(options.open) : openFromEnv();
  const store = createStore({ ...options, open });
  // Strangers' code runs on Compiler Explorer, not on this machine, unless
  // AU_CPP_BACKEND says otherwise.
  const runner = options.runner || createRunner({
    ...(open ? { backend: process.env.AU_CPP_BACKEND || 'godbolt' } : {}),
    ...(options.cpp || {})
  });
  const allowRun = open ? rateLimiter(options.openRunLimit || 30) : () => true;
  const progress = createProgressStore(store, {
    file: options.learnFile || path.join(options.dataDir || DATA_DIR, '.learn', 'progress.json'),
    branch: options.learnBranch
  });
  // No password configured means no login — the local-tool default.
  const password = options.password !== undefined ? options.password : process.env.AU_PASSWORD;
  const authOn = !open && Boolean(password);
  const throttle = new auth.Throttle();

  // Accounts: the main one, and a second, independent one when it has a
  // password of its own. Which one you are is decided by the password you
  // sign in with.
  const accounts = [{ id: 'main', prefix: 'p', password, store, progress }];
  const altPassword = options.altPassword !== undefined ? options.altPassword : process.env.AU_ALT_PASSWORD;
  if (altPassword && !authOn) {
    console.warn('AU_ALT_PASSWORD is ignored: a second account needs AU_PASSWORD set for the first one.');
  } else if (altPassword && altPassword === password) {
    console.warn('AU_ALT_PASSWORD is ignored: it must differ from AU_PASSWORD.');
  } else if (altPassword) {
    const altDir = path.join(options.dataDir || DATA_DIR, ALT.dataDir);
    const altStore = createStore({ ...options, open, root: ALT.folder, dataDir: altDir });
    accounts.push({
      id: ALT.id,
      prefix: ALT.prefix,
      password: altPassword,
      store: altStore,
      progress: createProgressStore(altStore, {
        file: path.join(altDir, '.learn', 'progress.json'),
        branch: options.learnBranch,
        githubFile: ALT.learnFile
      })
    });
  }
  const accountAt = (prefix) => accounts.find((a) => a.prefix === (prefix || 'p')) || null;

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = decodeURIComponent(url.pathname);
    const origin = `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host || 'localhost'}`;
    // The signed-in account (the only one when there is no password).
    let acct = accounts[0];

    try {
      // --- Uploaded images -------------------------------------------------
      // Public like the pages that embed them, so this sits above the gate.
      // Mirrors the layout on GitHub Pages, where a page at
      // /published/<slug>/ reaches images as ../assets/<name>.
      // A second account's images are under /a/assets/.
      const assetMatch = pathname.match(/^\/(?:([pa])\/)?assets\/([^/]+)$/);
      if (assetMatch && (req.method === 'GET' || req.method === 'HEAD')) {
        const owner = accountAt(assetMatch[1]);
        const name = assetMatch[2];
        const bytes = owner && ASSET_NAME_RE.test(name) ? await owner.store.readAsset(name) : null;
        if (!bytes) return sendText(res, 404, 'Not found');

        const type = contentType(name);
        res.writeHead(200, {
          'content-type': type,
          'content-length': bytes.length,
          'x-content-type-options': 'nosniff',
          // An SVG can carry script, so deny it an origin to run against.
          ...(type === 'image/svg+xml' ? { 'content-security-policy': 'sandbox' } : {}),
          'cache-control': 'public, max-age=300'
        });
        return res.end(req.method === 'HEAD' ? undefined : bytes);
      }

      // --- Deployed pages -------------------------------------------------
      // A deploy is a directory of files. The trailing slash matters: it is
      // what makes "styles.css" in a page resolve to a sibling file, here and
      // on GitHub Pages alike.
      // /p/<slug>/ is the main account's; /a/<slug>/ the second account's.
      const bareMatch = pathname.match(/^\/([pa])\/([^/]+)$/);
      if (bareMatch && accountAt(bareMatch[1]) && (req.method === 'GET' || req.method === 'HEAD')) {
        res.writeHead(302, { location: `/${bareMatch[1]}/${encodeURIComponent(bareMatch[2])}/${url.search}` });
        return res.end();
      }

      const pageMatch = pathname.match(/^\/([pa])\/([^/]+)\/(.*)$/);
      if (pageMatch && accountAt(pageMatch[1])) {
        const served = await accountAt(pageMatch[1]).store.file(pageMatch[2], pageMatch[3] || undefined);
        if (!served) {
          return sendText(res, 404, notFoundPage(pageMatch[1], pageMatch[2], pageMatch[3]), 'text/html; charset=utf-8');
        }
        const type = Compose.contentType(served.name);
        res.writeHead(200, {
          'content-type': type,
          'content-length': Buffer.byteLength(served.body),
          'x-content-type-options': 'nosniff',
          // An SVG can carry script, so deny it an origin to run against.
          ...(type === 'image/svg+xml' ? { 'content-security-policy': 'sandbox' } : {}),
          'cache-control': 'no-cache'
        });
        return res.end(req.method === 'HEAD' ? undefined : served.body);
      }

      // --- Login ----------------------------------------------------------
      // Everything below this point is gated; /p/<slug> above stays public so
      // pages can be shared with people who have no password.
      if (authOn) {
        const secure = (req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
        const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
          req.socket.remoteAddress || 'unknown';

        if (pathname === '/login') {
          if (req.method === 'GET') {
            return sendText(res, 200, auth.loginPage({ next: url.searchParams.get('next') }),
              'text/html; charset=utf-8');
          }
          if (req.method === 'POST') {
            const locked = throttle.lockedFor(ip);
            if (locked) {
              return sendText(res, 429,
                auth.loginPage({ error: `Too many attempts. Try again in ${locked}s.` }),
                'text/html; charset=utf-8');
            }
            const form = await readForm(req);
            // Compare with every account, so the time taken says nothing about which exists.
            const matches = accounts.filter((a) => auth.safeEqual(form.password || '', a.password));
            const account = matches[0];
            if (!account) {
              throttle.fail(ip);
              return sendText(res, 401, auth.loginPage({ error: 'Wrong password.', next: form.next }),
                'text/html; charset=utf-8');
            }
            throttle.clear(ip);
            const target = /^\/[^\s"'<>]*$/.test(form.next || '') ? form.next : '/';
            const maxAge = Math.floor(auth.TTL_MS / 1000);
            res.writeHead(303, {
              'set-cookie': [
                auth.cookieHeader(auth.issueToken(account.password), { secure, maxAge }),
                // Tells the pages which account's drafts to keep in the browser.
                auth.accountHeader(account.id === 'main' ? '' : account.id, { secure, maxAge: account.id === 'main' ? 0 : maxAge })
              ],
              location: target
            });
            return res.end();
          }
          return sendText(res, 405, 'Method not allowed');
        }

        const token = auth.parseCookies(req.headers.cookie)[auth.COOKIE];
        acct = accounts.find((a) => auth.verifyToken(a.password, token)) || null;

        if (pathname === '/logout') {
          res.writeHead(303, {
            'set-cookie': [
              auth.cookieHeader('', { secure, maxAge: 0 }),
              auth.accountHeader('', { secure, maxAge: 0 })
            ],
            location: '/login'
          });
          return res.end();
        }

        if (!acct) {
          if (pathname.startsWith('/api/')) {
            return sendJson(res, 401, { error: 'Not signed in' });
          }
          res.writeHead(302, { location: '/login?next=' + encodeURIComponent(url.pathname + url.search) });
          return res.end();
        }
      } else if (pathname === '/login' || pathname === '/logout') {
        res.writeHead(302, { location: '/' });
        return res.end();
      }

      // --- API ------------------------------------------------------------
      if (pathname === '/api/config' && req.method === 'GET') {
        return sendJson(res, 200, {
          auth: authOn,
          open,
          storage: open ? 'none' : typeof store.pagesUrl === 'function' ? 'github' : 'disk',
          account: acct.id,
          pages: `/${acct.prefix}/`
        });
      }

      if (open && /^\/api\/(deploys|assets)(\/|$)/.test(pathname)) {
        if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 403, { error: OPEN_NOTE });
        if (pathname === '/api/deploys') return sendJson(res, 200, { deploys: [] });
        if (pathname === '/api/assets') return sendJson(res, 200, { assets: [] });
        return sendJson(res, 404, { error: 'Not found' });
      }

      if (pathname === '/api/deploys' && req.method === 'GET') {
        const deploys = await acct.store.list();
        return sendJson(res, 200, {
          deploys: deploys.map((site) => decorate(site, origin, acct))
        });
      }

      if (pathname === '/api/deploys' && req.method === 'POST') {
        const body = await readBody(req);
        const result = await acct.store.save(body);
        if (!result.ok) return sendJson(res, result.status, { error: result.error });
        return sendJson(res, result.created ? 201 : 200, decorate(result.site, origin, acct));
      }

      if (pathname === '/api/assets' && req.method === 'GET') {
        const assets = await acct.store.listAssets();
        return sendJson(res, 200, {
          assets: assets.map((asset) => ({ ...asset, path: `../assets/${asset.name}` }))
        });
      }

      if (pathname === '/api/assets' && req.method === 'POST') {
        const body = await readBody(req);
        const result = await acct.store.saveAsset(body);
        if (!result.ok) return sendJson(res, result.status, { error: result.error });
        return sendJson(res, 201, { ...result.asset, path: `../assets/${result.asset.name}` });
      }

      const assetOne = pathname.match(/^\/api\/assets\/([^/]+)$/);
      if (assetOne && req.method === 'DELETE') {
        if (!(await acct.store.removeAsset(assetOne[1]))) return sendJson(res, 404, { error: 'Not found' });
        return sendJson(res, 200, { deleted: assetOne[1] });
      }

      const oneMatch = pathname.match(/^\/api\/deploys\/([^/]+)$/);
      if (oneMatch) {
        const slug = oneMatch[1];
        if (req.method === 'GET') {
          const site = await acct.store.get(slug);
          if (!site) return sendJson(res, 404, { error: 'Not found' });
          return sendJson(res, 200, decorate(site, origin, acct));
        }
        if (req.method === 'DELETE') {
          if (!(await acct.store.remove(slug))) return sendJson(res, 404, { error: 'Not found' });
          return sendJson(res, 200, { deleted: slug });
        }
        return sendJson(res, 405, { error: 'Method not allowed' });
      }

      // --- Learn mode ---------------------------------------------------
      if (pathname === '/api/cpp/status' && req.method === 'GET') {
        return sendJson(res, 200, await runner.status());
      }

      if (pathname === '/api/cpp/run' && req.method === 'POST') {
        if (!allowRun(clientAddress(req))) {
          return sendJson(res, 429, { error: 'Too many runs in a minute — wait a moment and try again.' });
        }
        const body = await readBody(req);
        return sendJson(res, 200, await runner.run(body));
      }

      if (open && pathname === '/api/learn/progress') {
        // Progress belongs to each visitor's browser, not to a shared server.
        if (req.method === 'GET') return sendJson(res, 200, { progress: Engine.emptyProgress(), storage: 'local' });
        return sendJson(res, 403, { error: OPEN_NOTE });
      }

      if (pathname === '/api/learn/progress' && req.method === 'GET') {
        return sendJson(res, 200, { progress: await acct.progress.read(), storage: acct.progress.kind });
      }

      if (pathname === '/api/learn/progress' && (req.method === 'PUT' || req.method === 'POST')) {
        const body = await readBody(req);
        const problem = validateProgress(body.progress);
        if (problem) return sendJson(res, 400, { error: problem });
        return sendJson(res, 200, { progress: await acct.progress.save(body.progress), storage: acct.progress.kind });
      }

      if (pathname.startsWith('/api/')) {
        return sendJson(res, 404, { error: 'Unknown endpoint' });
      }

      // Learn mode lives in a folder; its relative links need the slash.
      if (pathname === '/learn') {
        res.writeHead(301, { location: '/learn/' + url.search });
        return res.end();
      }

      // --- Editor app -----------------------------------------------------
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return sendText(res, 405, 'Method not allowed');
      }
      return serveStatic(res, pathname);
    } catch (err) {
      const status = err.status || 500;
      if (status === 500) console.error(err);
      return sendJson(res, status, { error: err.message || 'Internal error' });
    }
  });

  server.open = open;
  server.store = store;
  server.runner = runner;
  server.progress = progress;
  server.accounts = accounts;
  return server;
}

/**
 * Adds the addresses a page is reachable at: `url` is served by this app,
 * `permanentUrl` is the GitHub Pages copy that outlives a restart.
 */
function decorate(site, origin, account) {
  const out = { ...site, url: `${origin}/${account.prefix}/${site.slug}/` };
  if (typeof account.store.pagesUrl === 'function') out.permanentUrl = account.store.pagesUrl(site.slug);
  return out;
}

function notFoundPage(prefix, slug, file) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Page not found</title>
<style>body{font:16px/1.6 system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#0f1115;color:#e6e8ee}
main{text-align:center;padding:24px}code{background:#1b1f27;padding:2px 6px;border-radius:4px}
a{color:#7aa2f7}</style></head><body><main>
<h1>404</h1><p>Nothing is published at <code>/${prefix}/${String(slug).replace(/[<&>]/g, '')}/${String(file || '').replace(/[<&>]/g, '')}</code>.</p>
<p><a href="/">Back to the editor</a></p></main></body></html>`;
}

/** Loopback is safe to run open; a public bind without a password is not. */
function isLoopback(host) {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

/** This machine's addresses on the local network, for opening it on a phone. */
function lanAddresses() {
  const found = [];
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) found.push(iface.address);
    }
  }
  return found;
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST || '127.0.0.1';

  if (!isLoopback(host) && !process.env.AU_PASSWORD && !process.env.AU_ALLOW_PUBLIC_WRITES && !openFromEnv()) {
    console.error([
      '',
      `Refusing to start: HOST is ${host}, so this server would be reachable from`,
      'outside this machine, and AU_PASSWORD is not set. Anyone who found it could',
      'deploy, overwrite and delete your pages.',
      '',
      'Fix it by setting a password:',
      '',
      '  AU_PASSWORD="something long and private" npm start',
      '',
      'On Render, add AU_PASSWORD under Environment in the dashboard.',
      'Published pages at /p/<slug> stay public either way — only editing is locked.',
      '',
      'To run open on purpose anyway, set AU_ALLOW_PUBLIC_WRITES=1.',
      ''
    ].join('\n'));
    process.exit(1);
  }

  createApp().listen(port, host, () => {
    if (isLoopback(host)) {
      console.log(`Actually Useful → http://${host}:${port}`);
      console.log('Only this computer can reach that address. To open it on your phone,');
      console.log(`restart with:  AU_PASSWORD="a password" HOST=0.0.0.0 npm start`);
    } else {
      console.log('Actually Useful is running. Open one of these:');
      console.log(`  On this computer   http://127.0.0.1:${port}`);
      const lan = lanAddresses();
      if (lan.length) {
        lan.forEach((address, i) => {
          console.log(`  ${i === 0 ? 'On the same Wi-Fi  ' : '                   '}http://${address}:${port}`);
        });
      } else {
        console.log('  No local network address found — is this machine online?');
      }
    }
    if (openFromEnv()) {
      console.log('Open version (AU_OPEN): no password, publishing is off, work stays in each browser.');
    } else {
      console.log(process.env.AU_PASSWORD
        ? 'Password protection is ON (published pages stay public).'
        : 'No AU_PASSWORD set — anyone who can reach this port can edit and deploy.');
      if (process.env.AU_PASSWORD && process.env.AU_ALT_PASSWORD && process.env.AU_ALT_PASSWORD !== process.env.AU_PASSWORD) {
        console.log('Second account is ON: sign in with AU_ALT_PASSWORD. Its pages are at /a/<slug>, apart from everything else.');
      }
    }
  });
}

module.exports = { createApp };
