// sw.js
// WHAT: minimal offline cache for Frosthold Depths. WHY: "Add to Home
// Screen" alone does not make a site work offline — it just bookmarks the
// live URL. A registered service worker is what lets the game load with no
// network at all. The whole game is one HTML page + one bundled script, so
// a small cache-first precache list covers it completely.

const CACHE_NAME = 'frosthold-depths-v1';
const PRECACHE_URLS = [
  './',
  './index.html',
  './dist/bundle.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

// Cache-first: serve from cache when present (instant, works offline),
// otherwise fetch from network and store a copy for next time. If the
// network fails entirely (offline, and not yet cached), a page navigation
// falls back to the cached shell rather than showing a browser error.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((response) => {
          if (response.ok && response.type === 'basic') {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => (event.request.mode === 'navigate' ? caches.match('./index.html') : undefined));
    })
  );
});
