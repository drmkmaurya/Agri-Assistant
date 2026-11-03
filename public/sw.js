self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))).then(() => clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  // Always fetch fresh from network
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});
