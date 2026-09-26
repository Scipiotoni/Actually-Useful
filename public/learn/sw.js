/*
 * Lets Learn mode work without internet. Every file Learn loads (the app,
 * the courses, the scripts it borrows from the editor) is kept in a cache
 * as it is fetched. Online, the network always wins, so updates show up
 * straight away; offline, the cached copy is used. The API is never cached:
 * progress is kept in the browser anyway, and C++ needs the server.
 */
'use strict';

const CACHE = 'au-learn-v3';
const CORE = [
  './', 'index.html', 'app.js', 'learn.css', 'engine.js', 'course.js', 'markdown.js', 'lookup.js', 'explain.js',
  'web.js', 'build.js', 'arduino.js', 'video.js', 'player.js', 'courses.yml', '../editor.js', '../compose.js', '../backup.js', '../styles.css'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE)
    .then((cache) => Promise.all(CORE.map((url) => cache.add(url).catch(() => null))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('au-learn-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  event.respondWith(fetch(request).then((response) => {
    if (response.ok && response.type === 'basic') {
      const copy = response.clone();
      caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
    }
    return response;
  }).catch(() => caches.match(request, { ignoreSearch: true }).then((cached) => cached || Response.error())));
});
