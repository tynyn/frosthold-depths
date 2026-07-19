// sw.js
// WHAT: minimal offline cache for Frosthold Depths. WHY: "Add to Home
// Screen" alone does not make a site work offline — it just bookmarks the
// live URL. A registered service worker is what lets the game load with no
// network at all. The whole game is one HTML page + one bundled script, so
// a small precache list covers it completely.
//
// CACHE_NAME MUST be bumped on every deploy that changes cached content.
// The fetch strategy below is network-first specifically so that forgetting
// to bump it doesn't strand players on stale content while online — only
// an offline visit ever falls back to whatever this version number cached.

const CACHE_NAME = 'frosthold-depths-v2';
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

// Network-first: always try the network so a normal online visit gets
// whatever is actually deployed, never a stale cached copy. Only when the
// network fails entirely (offline) does it fall back to cache — that's
// where "works with no connection" comes from, without ever holding an
// online player back from an update.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return event.request.mode === 'navigate' ? caches.match('./index.html') : undefined;
      }))
  );
});
