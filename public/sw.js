const SHELL_CACHE = 'inkbound-shell-v3';
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

async function updateCachedNavigation(request, cacheKey) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(SHELL_CACHE);
      await cache.put(cacheKey, response.clone());
    }
    return response;
  } catch {
    return null;
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    if (url.pathname === '/app') {
      event.respondWith((async () => {
        const cached = await caches.match('/app') || await caches.match('/index.html');
        if (cached) {
          event.waitUntil(updateCachedNavigation(request, '/app'));
          return cached;
        }

        const network = await updateCachedNavigation(request, '/app');
        return network || Response.error();
      })());
      return;
    }

    event.respondWith((async () => {
      const cached = await caches.match(request) || await caches.match('/');
      if (cached) {
        event.waitUntil(updateCachedNavigation(request, request));
        return cached;
      }
      return (await updateCachedNavigation(request, request)) || Response.error();
    })());
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
