'use strict';

const crypto = require('crypto');

const COOKIE = 'au_session';
// Which account is signed in, readable by the pages so each account keeps its
// own drafts in the browser. Only a hint: the signed session decides access.
const ACCOUNT_COOKIE = 'au_account';
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_FAILS = 5;
const LOCKOUT_MS = 30 * 1000;

/** Constant-time string compare that tolerates different lengths. */
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a), 'utf8');
  const bufB = Buffer.from(String(b), 'utf8');
  // Hash first so a length difference doesn't leak through timingSafeEqual.
  const hashA = crypto.createHash('sha256').update(bufA).digest();
  const hashB = crypto.createHash('sha256').update(bufB).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

function sign(password, payload) {
  return crypto.createHmac('sha256', password).update(payload).digest('base64url');
}

function issueToken(password, now = Date.now()) {
  const payload = String(now + TTL_MS);
  return payload + '.' + sign(password, payload);
}

function verifyToken(password, token, now = Date.now()) {
  if (typeof token !== 'string') return false;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return false;
  const payload = token.slice(0, dot);
  if (!safeEqual(token.slice(dot + 1), sign(password, payload))) return false;
  const expiresAt = Number(payload);
  return Number.isFinite(expiresAt) && expiresAt > now;
}

function parseCookies(header) {
  const out = {};
  String(header || '').split(';').forEach((part) => {
    const eq = part.indexOf('=');
    if (eq < 0) return;
    out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  });
  return out;
}

function cookieHeader(token, { secure, maxAge }) {
  return [
    `${COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
    secure ? 'Secure' : ''
  ].filter(Boolean).join('; ');
}

function accountHeader(id, { secure, maxAge }) {
  return [
    `${ACCOUNT_COOKIE}=${encodeURIComponent(id || '')}`,
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
    secure ? 'Secure' : ''
  ].filter(Boolean).join('; ');
}

/** Per-IP throttle so the password can't be brute-forced. */
class Throttle {
  constructor() {
    this.byIp = new Map();
  }

  lockedFor(ip, now = Date.now()) {
    const entry = this.byIp.get(ip);
    if (!entry || entry.until <= now) return 0;
    return Math.ceil((entry.until - now) / 1000);
  }

  fail(ip, now = Date.now()) {
    const entry = this.byIp.get(ip) || { fails: 0, until: 0 };
    entry.fails += 1;
    if (entry.fails >= MAX_FAILS) {
      // Back off harder the longer someone keeps guessing.
      entry.until = now + LOCKOUT_MS * Math.pow(2, entry.fails - MAX_FAILS);
    }
    this.byIp.set(ip, entry);
  }

  clear(ip) {
    this.byIp.delete(ip);
  }
}

function loginPage({ error, next }) {
  const safeNext = /^\/[^\s"'<>]*$/.test(next || '') ? next : '/';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sign in — Actually Useful</title><style>
:root{color-scheme:dark}
body{margin:0;min-height:100vh;display:grid;place-items:center;
  background:#0e1116;color:#e6e9ef;font:15px/1.6 ui-sans-serif,system-ui,sans-serif}
form{width:min(360px,calc(100vw - 32px));padding:28px;background:#151a22;
  border:1px solid #262e3a;border-radius:12px}
h1{margin:0 0 4px;font-size:18px}
p{margin:0 0 20px;color:#97a1b2;font-size:13px}
label{display:block;margin-bottom:6px;font-size:13px;color:#97a1b2}
input{width:100%;padding:10px 12px;background:#1b212b;border:1px solid #262e3a;
  border-radius:8px;color:#e6e9ef;font:inherit}
input:focus{outline:2px solid #6ea8fe;outline-offset:-1px}
button{width:100%;margin-top:14px;padding:10px;background:#3d7dfd;border:0;
  border-radius:8px;color:#fff;font:inherit;font-weight:600;cursor:pointer}
button:hover{background:#5590ff}
.error{margin:14px 0 0;padding:9px 12px;background:rgba(248,113,113,.12);
  border-left:3px solid #f87171;border-radius:6px;color:#f87171;font-size:13px}
</style></head><body>
<form method="POST" action="/login">
<h1>⚡ Actually Useful</h1>
<p>This editor is password protected. Published pages stay public.</p>
<input type="hidden" name="next" value="${safeNext.replace(/"/g, '&quot;')}">
<label for="password">Password</label>
<input id="password" name="password" type="password" autocomplete="current-password" autofocus required>
<button type="submit">Sign in</button>
${error ? `<p class="error">${error}</p>` : ''}
</form></body></html>`;
}

module.exports = {
  COOKIE,
  ACCOUNT_COOKIE,
  accountHeader,
  TTL_MS,
  Throttle,
  safeEqual,
  issueToken,
  verifyToken,
  parseCookies,
  cookieHeader,
  loginPage
};
