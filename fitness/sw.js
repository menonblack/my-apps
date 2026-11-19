// Offline support. Bump VERSION on every deploy so phones fetch the new files.
const VERSION = 'v8';
const CACHE = 'liftlog-' + VERSION;
const ASSETS = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest',
  'js/app.js', 'js/store.js', 'js/util.js', 'js/log.js', 'js/calendar.js', 'js/platform.js',
  'js/body.js', 'js/coach.js', 'js/coach-agent.js', 'js/settings.js', 'js/claude.js', 'js/stats.js', 'js/plan.js', 'js/voice.js',
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

// Network first for the app's own files (revalidated, so a new deploy shows up the
// moment you open the app), with the cached copy as fallback when offline or when
// the network is too slow (3 s). Your data lives in IndexedDB and is never touched.
const NET_TIMEOUT_MS = 3000;

function networkFirst(req, cacheKey) {
  return caches.open(CACHE).then((cache) => new Promise((resolve) => {
    let done = false;
    const fallback = () => cache.match(cacheKey || req, { ignoreSearch: true }).then((hit) => hit || Response.error());
    const timer = setTimeout(() => { fallback().then((r) => { if (!done && r.type !== 'error') { done = true; resolve(r); } }); }, NET_TIMEOUT_MS);
    fetch(req, { cache: 'no-cache' })
      .then((r) => {
        if (r.ok) cache.put(cacheKey || req, r.clone());
        if (!done) { done = true; clearTimeout(timer); resolve(r); }
      })
      .catch(() => { clearTimeout(timer); if (!done) { done = true; fallback().then(resolve); } });
  }));
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  if (req.mode === 'navigate') { e.respondWith(networkFirst(req, 'index.html')); return; }
  e.respondWith(networkFirst(req));
});
