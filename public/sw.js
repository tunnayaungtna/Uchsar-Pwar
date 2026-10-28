const CACHE_NAME = 'uchsar-pwar-pwa-v5';

const CORE_LOCAL_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './firebase-applet-config.json',
  './assets/aistudio/my_walet_40feb1c8.png',
  './src/main.tsx',
  './src/App.tsx',
  './src/types.ts',
  './src/firebase.ts',
  './src/utils/sampleData.ts',
  './src/utils/webauthn.ts',
  './src/components/BiometricLockScreen.tsx',
  './src/components/EntryFormModal.tsx',
  './src/components/ErrorBoundary.tsx',
];

const CORE_CDN_ASSETS = [
  'https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4',
  'https://cdn.jsdelivr.net/npm/@babel/standalone@7.26.9/babel.min.js',
  'https://esm.sh/react@18.3.1',
  'https://esm.sh/react-dom@18.3.1?deps=react@18.3.1',
  'https://esm.sh/react-dom@18.3.1/client?deps=react@18.3.1',
  'https://esm.sh/lucide-react@0.477.0?deps=react@18.3.1',
  'https://esm.sh/recharts@2.15.1?deps=react@18.3.1,react-dom@18.3.1',
  'https://www.gstatic.com/firebasejs/11.4.0/firebase-app.js',
  'https://www.gstatic.com/firebasejs/11.4.0/firebase-auth.js',
  'https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js',
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // Pre-cache local assets individually so a missing optional path never aborts install
      await Promise.allSettled(
        CORE_LOCAL_ASSETS.map(async (assetUrl) => {
          try {
            const res = await fetch(assetUrl, { cache: 'reload' });
            if (res && res.ok) {
              await cache.put(assetUrl, res.clone());
            }
          } catch {
            // ignore offline/missing individual asset during install
          }
        })
      );
      // Pre-cache CDN assets for offline GitHub Pages / standalone execution
      await Promise.allSettled(
        CORE_CDN_ASSETS.map(async (cdnUrl) => {
          try {
            const res = await fetch(cdnUrl, { mode: 'cors' });
            if (res && (res.ok || res.type === 'opaque')) {
              await cache.put(cdnUrl, res.clone());
            }
          } catch {
            // ignore if offline during install
          }
        })
      );
    })
  );
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
      const cached = await caches.match(url, { ignoreSearch: true });
      if (cached && cached.ok) {
        return await cached.blob();
      }
      const res = await fetch(url, { cache: 'force-cache' });
      if (res && res.ok) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(url, res.clone()).catch(() => {});
        return await res.blob();
      }
    } catch {
      // try next candidate
    }
  }
  return null;
}

async function generateSquarePngResponse(targetSize, requestUrl) {
  const cache = await caches.open(CACHE_NAME);
  const cachedIcon = await cache.match(requestUrl);
  if (cachedIcon) return cachedIcon;

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
        const generatedRes = new Response(outBlob, {
          status: 200,
          headers: {
            'Content-Type': 'image/png',
            'Cache-Control': 'public, max-age=86400',
          },
        });
        cache.put(requestUrl, generatedRes.clone()).catch(() => {});
        return generatedRes;
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

function isLiveApiRequest(url) {
  return (
    url.hostname.includes('firestore.googleapis.com') ||
    url.hostname.includes('identitytoolkit.googleapis.com') ||
    url.hostname.includes('securetoken.googleapis.com') ||
    url.hostname.includes('api.coingecko.com') ||
    url.hostname.includes('apis.google.com')
  );
}

function isImmutableCdnAsset(url) {
  return (
    url.hostname.includes('esm.sh') ||
    url.hostname.includes('cdn.jsdelivr.net') ||
    url.hostname.includes('fonts.gstatic.com') ||
    url.hostname.includes('fonts.googleapis.com') ||
    (url.hostname.includes('www.gstatic.com') && url.pathname.includes('/firebasejs/'))
  );
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Do not intercept live Firestore / Auth / CoinGecko API requests
  if (isLiveApiRequest(url)) return;

  // Serve generated 1:1 square app icons (cached for offline use)
  if (url.pathname.endsWith('/icon-192.png') || url.pathname.endsWith('/icon-512.png')) {
    const size = url.pathname.endsWith('/icon-192.png') ? 192 : 512;
    event.respondWith(generateSquarePngResponse(size, event.request.url));
    return;
  }

  // Cache-First strategy for CDN libraries & fonts so offline mode works instantaneously
  if (isImmutableCdnAsset(url)) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(event.request).then((networkResponse) => {
          if (
            networkResponse &&
            (networkResponse.status === 200 || networkResponse.type === 'opaque')
          ) {
            const copy = networkResponse.clone();
            caches
              .open(CACHE_NAME)
              .then((cache) => cache.put(event.request, copy))
              .catch(() => {});
          }
          return networkResponse;
        });
      })
    );
    return;
  }

  // For same-origin app files & navigation: try fast network, fall back immediately to cache when offline
  event.respondWith(
    (async () => {
      try {
        const response = await fetch(event.request);
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
          const fallbackRes = await fetch(fallbackUrl);
          if (fallbackRes && fallbackRes.ok) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(event.request, fallbackRes.clone()).catch(() => {});
          }
          return fallbackRes;
        }

        if (response && (response.status === 200 || response.type === 'opaque')) {
          const copy = response.clone();
          caches
            .open(CACHE_NAME)
            .then((cache) => cache.put(event.request, copy))
            .catch(() => {});
        }
        return response;
      } catch {
        // Offline fallback: match exact request, then ignoreSearch, then app shell for navigations
        const exactMatch = await caches.match(event.request);
        if (exactMatch) return exactMatch;

        const searchIgnoredMatch = await caches.match(event.request, { ignoreSearch: true });
        if (searchIgnoredMatch) return searchIgnoredMatch;

        if (event.request.mode === 'navigate') {
          const shellMatch =
            (await caches.match('./index.html', { ignoreSearch: true })) ||
            (await caches.match('./', { ignoreSearch: true }));
          if (shellMatch) return shellMatch;
        }

        return new Response('Offline', { status: 503, statusText: 'Offline' });
      }
    })()
  );
});
