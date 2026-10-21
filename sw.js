// Bump the version whenever an app-shell file changes; deploy the files together.
const PREFIX = `hifz-qalun:${self.registration.scope}:`;
const CACHE = `${PREFIX}2.1.4`;
const FILES = [
  './',
  './index.html',
  './app.js',
  './model.js',
  './storage.js',
  './voice.js',
  './schedule.js',
  './surahs.js',
  './surahs-qalun.json',
  './style.css',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './manifest.webmanifest',
];
const urls = new Set(FILES.map((file) => new URL(file, self.registration.scope).href));
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)));
  // Wait for explicit approval or for all existing app windows to close.
});
self.addEventListener('message', (event) => {
  if (event.data === 'ACTIVATE') self.skipWaiting();
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key.startsWith(PREFIX) && key !== CACHE).map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  const canonical = `${url.origin}${url.pathname}`;
  if (event.request.mode !== 'navigate' && !urls.has(canonical)) return;
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(
        event.request.mode === 'navigate' ? new URL('./index.html', self.registration.scope).href : canonical,
      );
      return cached || fetch(event.request);
    }),
  );
});
