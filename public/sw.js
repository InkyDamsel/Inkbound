const SHELL_CACHE = 'inkbound-shell-v2';
const APP_SHELL = [
  '/',
  '/app',
  '/index.html',
  '/manifest.webmanifest',
  '/assets/branding/pwa/icon-192.png',
  '/assets/branding/pwa/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
      .catch(() => undefined),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith('inkbound-shell-') && key !== SHELL_CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok && url.pathname === '/app') {
            const copy = response.clone();
            void caches.open(SHELL_CACHE).then((cache) => cache.put('/app', copy));
          }
          return response;
        })
        .catch(async () => {
          if (url.pathname === '/app') return (await caches.match('/app')) || (await caches.match('/index.html')) || Response.error();
          return (await caches.match(request)) || (await caches.match('/')) || Response.error();
        }),
    );
    return;
  }

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        });
      }),
    );
  }
});
