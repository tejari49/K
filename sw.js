/* TRACKERRAI SW - cache-bust v7 */
const CACHE = 'trackerrai-v8';
const CORE = [
  '/',
  '/index.html',
  '/manifest_trackerrai.webmanifest',
  '/icon-192.png',
  '/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);

  // Avoid caching cross-origin (Firebase/CDNs) to prevent stale libs / QR issues.
  if (url.origin !== self.location.origin) return;

  // Network-first for HTML
  if (req.mode === 'navigate' || (req.headers.get('accept')||'').includes('text/html')) {
    e.respondWith(
      fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put('/index.html', copy)).catch(()=>{});
        return res;
      }).catch(() => caches.match('/index.html'))
    );
    return;
  }

  // Cache-first for same-origin assets
  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(req, copy)).catch(()=>{});
      return res;
    }))
  );
});
