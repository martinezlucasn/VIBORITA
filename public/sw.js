const CACHE_NAME = 'viborita-cache-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json'
];

// Domains to cache aggressively
const REMOTE_DOMAINS = [
  'assets.mixkit.co',
  'api.dicebear.com'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Aggressive caching for remote media and local assets
  const isRemoteMedia = REMOTE_DOMAINS.some(domain => url.hostname.includes(domain));
  const isLocalAsset = STATIC_ASSETS.includes(url.pathname) || 
                       url.pathname.endsWith('.js') || 
                       url.pathname.endsWith('.css') ||
                       url.pathname.endsWith('.png') ||
                       url.pathname.endsWith('.jpg') ||
                       url.pathname.endsWith('.svg') ||
                       url.pathname.endsWith('.mp3');

  if (isLocalAsset || isRemoteMedia) {
    event.respondWith(
      caches.match(event.request).then((response) => {
        return response || fetch(event.request).then((networkResponse) => {
          if (!networkResponse || networkResponse.status !== 200) {
            return networkResponse;
          }
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
          return networkResponse;
        });
      })
    );
  } else {
    // For other requests (like API calls), use Network First but fallback to cache if offline
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
  }
});
