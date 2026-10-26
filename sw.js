const CACHE_NAME = 'uchsar-pwar-pwa-v4';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
      )
      .then(() => self.clients.claim())
  );
});

async function fetchSourceLogoBlob(baseUrl) {
  const candidates = [
    new URL('./assets/aistudio/my_walet_40feb1c8.png', baseUrl).href,
    new URL('./public/assets/aistudio/my_walet_40feb1c8.png', baseUrl).href,
  ];
  for (const url of candidates) {
    try {
      const res = await fetch(url, { cache: 'force-cache' });
      if (res && res.ok) {
        return await res.blob();
      }
    } catch {
      // try next candidate
    }
  }
  return null;
}

async function generateSquarePngResponse(targetSize, requestUrl) {
  const sourceBlob = await fetchSourceLogoBlob(requestUrl);
  if (!sourceBlob) {
    return new Response('Icon not found', { status: 404 });
  }
  if (typeof OffscreenCanvas !== 'undefined' && typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(sourceBlob);
      const canvas = new OffscreenCanvas(targetSize, targetSize);
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#073b4c';
        ctx.fillRect(0, 0, targetSize, targetSize);
        const scale = Math.min(targetSize / bitmap.width, targetSize / bitmap.height);
        const drawW = Math.round(bitmap.width * scale);
        const drawH = Math.round(bitmap.height * scale);
        const offsetX = Math.round((targetSize - drawW) / 2);
        const offsetY = Math.round((targetSize - drawH) / 2);
        ctx.drawImage(bitmap, offsetX, offsetY, drawW, drawH);
        const outBlob = await canvas.convertToBlob({ type: 'image/png' });
        return new Response(outBlob, {
          status: 200,
          headers: {
            'Content-Type': 'image/png',
            'Cache-Control': 'public, max-age=86400',
          },
        });
      }
    } catch {
      // Fall back to raw blob
    }
  }
  return new Response(sourceBlob, {
    status: 200,
    headers: { 'Content-Type': 'image/png' },
  });
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  if (url.pathname.endsWith('/icon-192.png') || url.pathname.endsWith('/icon-512.png')) {
    const size = url.pathname.endsWith('/icon-192.png') ? 192 : 512;
    event.respondWith(generateSquarePngResponse(size, event.request.url));
    return;
  }

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
          caches
            .open(CACHE_NAME)
            .then((cache) => cache.put(event.request, copy))
            .catch(() => {});
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
