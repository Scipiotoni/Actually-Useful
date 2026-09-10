'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { DeployStore } = require('./store.js');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const DATA_DIR = process.env.AU_DATA_DIR || path.join(__dirname, '..', 'data', 'sites');
const MAX_BODY_BYTES = 8 * 1024 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
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

function serveStatic(res, urlPath) {
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const file = path.resolve(PUBLIC_DIR, rel);
  if (file !== path.join(PUBLIC_DIR, rel) && !file.startsWith(PUBLIC_DIR + path.sep)) {
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

function createApp(options = {}) {
  const store = new DeployStore(options.dataDir || DATA_DIR).init();

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = decodeURIComponent(url.pathname);
    const origin = `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host || 'localhost'}`;

    try {
      // --- Deployed pages -------------------------------------------------
      const pageMatch = pathname.match(/^\/p\/([^/]+)\/?$/);
      if (pageMatch) {
        const html = store.html(pageMatch[1]);
        if (html === null) {
          return sendText(res, 404, notFoundPage(pageMatch[1]), 'text/html; charset=utf-8');
        }
        res.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'x-content-type-options': 'nosniff',
          'cache-control': 'no-cache'
        });
        return res.end(html);
      }

      // --- API ------------------------------------------------------------
      if (pathname === '/api/deploys' && req.method === 'GET') {
        return sendJson(res, 200, {
          deploys: store.list().map((site) => ({ ...site, url: `${origin}/p/${site.slug}` }))
        });
      }

      if (pathname === '/api/deploys' && req.method === 'POST') {
        const body = await readBody(req);
        const result = store.save(body);
        if (!result.ok) return sendJson(res, result.status, { error: result.error });
        return sendJson(res, result.created ? 201 : 200, {
          ...result.site,
          url: `${origin}/p/${result.site.slug}`
        });
      }

      const oneMatch = pathname.match(/^\/api\/deploys\/([^/]+)$/);
      if (oneMatch) {
        const slug = oneMatch[1];
        if (req.method === 'GET') {
          const site = store.get(slug);
          if (!site) return sendJson(res, 404, { error: 'Not found' });
          return sendJson(res, 200, { ...site, url: `${origin}/p/${slug}` });
        }
        if (req.method === 'DELETE') {
          if (!store.remove(slug)) return sendJson(res, 404, { error: 'Not found' });
          return sendJson(res, 200, { deleted: slug });
        }
        return sendJson(res, 405, { error: 'Method not allowed' });
      }

      if (pathname.startsWith('/api/')) {
        return sendJson(res, 404, { error: 'Unknown endpoint' });
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

  server.store = store;
  return server;
}

function notFoundPage(slug) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Page not found</title>
<style>body{font:16px/1.6 system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#0f1115;color:#e6e8ee}
main{text-align:center;padding:24px}code{background:#1b1f27;padding:2px 6px;border-radius:4px}
a{color:#7aa2f7}</style></head><body><main>
<h1>404</h1><p>No page is deployed at <code>/p/${String(slug).replace(/[<&>]/g, '')}</code>.</p>
<p><a href="/">Back to the editor</a></p></main></body></html>`;
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST || '127.0.0.1';
  createApp().listen(port, host, () => {
    console.log(`Actually Useful → http://${host}:${port}`);
  });
}

module.exports = { createApp };
