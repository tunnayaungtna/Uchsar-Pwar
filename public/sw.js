const CACHE_NAME = 'uchsar-pwar-pwa-v2';

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
          event.request.url.includes('/assets/aistudio/Gemini_Generated_Image_i9br20i9br20i9br_bb316cd4.jpg') &&
          !event.request.url.includes('/public/assets/aistudio/')
        ) {
          const fallbackUrl = event.request.url.replace(
            '/assets/aistudio/Gemini_Generated_Image_i9br20i9br20i9br_bb316cd4.jpg',
            '/public/assets/aistudio/Gemini_Generated_Image_i9br20i9br20i9br_bb316cd4.jpg'
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
