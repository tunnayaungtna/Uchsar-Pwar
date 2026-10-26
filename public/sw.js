const CACHE_NAME = 'uchsar-pwar-pwa-v3';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (
          response &&
          response.status === 404 &&
          event.request.url.includes('/assets/aistudio/my_walet_40feb1c8.png') &&
          !event.request.url.includes('/public/assets/aistudio/')
        ) {
          const fallbackUrl = event.request.url.replace(
            '/assets/aistudio/my_walet_40feb1c8.png',
            '/public/assets/aistudio/my_walet_40feb1c8.png'
          );
          return fetch(fallbackUrl);
        }
        if (response && response.status === 200 && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)).catch(() => {});
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
