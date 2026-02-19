/* TrackerRAI PWA Service Worker (v9) */
const CACHE_NAME = 'trackerrai-v9';
const CORE = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png'
];

// External libs (best-effort cache for offline/PWA reliability)
const EXT = [
  'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js',
  'https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(CORE);
    // Best-effort: don't fail install if CDN is temporarily unavailable
    await Promise.allSettled(EXT.map(u => cache.add(u)));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => (k !== CACHE_NAME) ? caches.delete(k) : null));
    self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Network-first for navigations
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        const cache = await caches.open(CACHE_NAME);
        cache.put('/index.html', res.clone());
        return res;
      } catch {
        const cached = await caches.match('/index.html');
        return cached || new Response('Offline', {status: 503, headers: {'Content-Type':'text/plain'}});
      }
    })());
    return;
  }

  // Cache-first for same-origin static assets
  if (url.origin === location.origin) {
    event.respondWith((async () => {
      const cached = await caches.match(req);
      if (cached) return cached;
      const res = await fetch(req);
      const cache = await caches.open(CACHE_NAME);
      cache.put(req, res.clone());
      return res;
    })());
    return;
  }

  // Stale-while-revalidate for CDN libs (keeps QR + scanner working in PWA)
  if (EXT.includes(req.url)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(req);
      const fetchPromise = fetch(req).then(res => { cache.put(req, res.clone()); return res; }).catch(() => null);
      return cached || (await fetchPromise) || new Response('', {status: 504});
    })());
    return;
  }

  // Default: passthrough
  return;
});
