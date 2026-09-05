const SHELL_CACHE = 'inkbound-shell-v4';
const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/assets/branding/pwa/icon-192.png',
  '/assets/branding/pwa/icon-512.png',
];
const NAVIGATION_NETWORK_TIMEOUT_MS = 1800;

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

async function fetchAndCacheNavigation(request, cacheKey) {
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

async function navigationWithFastNetworkFallback(request, cacheKey, fallbackKey) {
  const networkRequest = fetchAndCacheNavigation(request, cacheKey);
  const timeout = new Promise((resolve) => {
    setTimeout(() => resolve(null), NAVIGATION_NETWORK_TIMEOUT_MS);
  });

  const quickNetwork = await Promise.race([networkRequest, timeout]);
  if (quickNetwork) return quickNetwork;

  const cached = await caches.match(cacheKey) || (fallbackKey ? await caches.match(fallbackKey) : null);
  if (cached) {
    // The original network request keeps running and refreshes the cache when the
    // connection eventually responds, so the next visit gets the newest build.
    eventWaitUntilSafe(networkRequest);
    return cached;
  }

  return (await networkRequest) || Response.error();
}

function eventWaitUntilSafe(promise) {
  // A navigation can outlive the fetch handler on poor connections. The promise
  // still completes and updates Cache Storage; there is nothing else to await here.
  void promise;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    const cacheKey = url.pathname === '/app' ? '/app' : request;
    const fallbackKey = url.pathname === '/app' ? '/index.html' : '/';
    event.respondWith(navigationWithFastNetworkFallback(request, cacheKey, fallbackKey));
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
