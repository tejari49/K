/* TimeRoster GitHub Pages PWA Service Worker
   - Offline app shell caching
   - Firebase Cloud Messaging (background push)
*/

const CACHE_NAME = 'timeroster-ghpwa-v3';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

const APP_URL = 'https://tejari49.github.io/Meal/';

// ---- Firebase Messaging (Compat) ----
// Uses compat builds because Service Workers don't support ESM imports here.
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyCLqi-PxHdeyt51u9i50tY0NhOAUbutW9g",
  authDomain: "calender-rai.firebaseapp.com",
  projectId: "calender-rai",
  storageBucket: "calender-rai.firebasestorage.app",
  messagingSenderId: "989981793002",
  appId: "1:989981793002:web:d23ba8bf2c30d6b8649593",
  measurementId: "G-CZLXPHK9GK"
});

const messaging = firebase.messaging();

// Background messages (neutral text)
messaging.onBackgroundMessage((payload) => {
  try {
    const title = 'Kalender aktualisiert';
    const body = 'Es gibt neue Updates.';
    const dataUrl = (payload && payload.data && payload.data.url) ? payload.data.url : APP_URL;

    self.registration.showNotification(title, {
      body,
      tag: 'timeroster-update',
      data: { url: dataUrl }
    });
  } catch (e) {
    // ignore
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification && event.notification.data && event.notification.data.url) ? event.notification.data.url : APP_URL;

  event.waitUntil((async () => {
    const allClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of allClients) {
      try {
        if (client.url && client.url.startsWith(APP_URL)) {
          await client.focus();
          return;
        }
      } catch (e) {}
    }
    await clients.openWindow(url);
  })());
});

// ---- App Shell Caching ----
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => (k !== CACHE_NAME ? caches.delete(k) : Promise.resolve())));
    await self.clients.claim();
  })());
});

async function cachePutSafe(cache, request, response) {
  try {
    if (!response) return;
    if (response.status === 0) {
      await cache.put(request, response.clone());
      return;
    }
    if (response.ok) {
      await cache.put(request, response.clone());
    }
  } catch (e) {}
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // navigation requests: network-first, fallback to cached index
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const net = await fetch(req);
        const cache = await caches.open(CACHE_NAME);
        await cachePutSafe(cache, './index.html', net);
        return net;
      } catch (e) {
        const cache = await caches.open(CACHE_NAME);
        return (await cache.match('./index.html')) || (await cache.match('./')) || Response.error();
      }
    })());
    return;
  }

  // same-origin: cache-first, then update
  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(req);
      if (cached) return cached;

      try {
        const net = await fetch(req);
        await cachePutSafe(cache, req, net);
        return net;
      } catch (e) {
        return cached || Response.error();
      }
    })());
    return;
  }

  // cross-origin: stale-while-revalidate (best-effort)
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(req);

    const fetchPromise = (async () => {
      try {
        const net = await fetch(req);
        await cachePutSafe(cache, req, net);
        return net;
      } catch (e) {
        return null;
      }
    })();

    return cached || (await fetchPromise) || Response.error();
  })());
});
