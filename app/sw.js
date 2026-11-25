const CACHE_NAME = 'moneyflow-v3';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon.svg',
  './styles/main.css',
  './src/app.js',
  './src/budgetEngine.js',
  './src/charts.js',
  './src/datePicker.js',
  './src/db.js',
  './src/parser.js',
  './src/seedData.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Network-first when online (so updates take effect immediately), cache fallback when offline.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  const isFont = url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com';
  if (url.origin !== self.location.origin && !isFont) return;

  event.respondWith(
    fetch(event.request)
      .then((resp) => {
        if (resp && resp.status === 200) {
          const copy = resp.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return resp;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match('./index.html')))
  );
});
