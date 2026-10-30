/* Calii MH Recibo — service worker (plan §8)
   Network-first for the app shell: online always gets the freshest deploy, offline falls back to cache.
   BUMP CACHE_NAME on every deploy that changes index.html. */
const CACHE_NAME = 'calii-mhrecibo-v1-qa1';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './imagedb.json',
  './icon-192.png',
  'https://cdnjs.cloudflare.com/ajax/libs/PapaParse/5.4.1/papaparse.min.js'
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(SHELL).catch(() => {})));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) { if (k !== CACHE_NAME) await caches.delete(k); }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.hostname.includes('supabase.co')) return; // never intercept live data
  const cacheable = url.origin === self.location.origin || url.hostname.includes('cloudflare') || url.hostname.includes('jsdelivr');
  if (!cacheable) return; // product photos (S3) go straight to the network
  e.respondWith((async () => {
    try {
      const net = await fetch(e.request);
      if (net && net.ok) {
        const copy = net.clone();
        caches.open(CACHE_NAME).then((c) => c.put(e.request, copy));
      }
      return net;
    } catch (_) {
      return (await caches.match(e.request)) || (await caches.match('./index.html'));
    }
  })());
});
