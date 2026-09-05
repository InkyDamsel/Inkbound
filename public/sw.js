const SHELL_CACHE_PREFIX = 'inkbound-shell-';

// Inkbound's web beta must always open the currently deployed build. Older
// service-worker versions cached /app and /index.html, which could leave returning
// readers running an obsolete bundle until they manually cleared site data.
// This worker intentionally retires that cache layer. User library/auth data lives
// in localStorage/IndexedDB and is not touched here.
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith(SHELL_CACHE_PREFIX))
          .map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim())
      .then(() => self.registration.unregister()),
  );
});

// While this retirement worker is still controlling an existing tab, always use
// the network. Never serve a stale application shell or stale Vite assets.
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(fetch(request));
});
