// Offline support. Bump VERSION on every deploy so phones fetch the new files.
const VERSION = 'v5';
const CACHE = 'liftlog-' + VERSION;
const ASSETS = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest',
  'js/app.js', 'js/store.js', 'js/util.js', 'js/log.js', 'js/calendar.js', 'js/platform.js',
  'js/body.js', 'js/coach.js', 'js/coach-agent.js', 'js/settings.js', 'js/claude.js', 'js/stats.js', 'js/plan.js',
  'vendor/anthropic-sdk.js',
  'fonts/roboto-condensed-latin-600-normal.woff2', 'fonts/roboto-condensed-latin-700-normal.woff2',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('liftlog-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  if (req.mode === 'navigate') {
    // Network first so a fresh deploy shows up; cached shell when offline.
    e.respondWith(
      fetch(req)
        .then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put('index.html', copy)); return r; })
        .catch(() => caches.match('index.html', { ignoreSearch: true }))
    );
    return;
  }
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).then((r) => {
      if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return r;
    }))
  );
});
