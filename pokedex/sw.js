// Offline-Unterstützung: App-Dateien vorab speichern, Bilder und Rufe beim ersten Abruf merken.
const VERSION = 'pokedex-v5';
const APP = ['./', 'index.html', 'style.css', 'app.js', 'data/pokedex-de.json', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-180.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(APP)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('pokedex-') && k !== VERSION && k !== 'pokedex-media').map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.hostname === 'raw.githubusercontent.com') {
    // Bilder/Rufe: aus dem Speicher, sonst laden und merken
    e.respondWith(caches.open('pokedex-media').then(async c => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok || res.type === 'opaque') c.put(e.request, res.clone());
      return res;
    }));
  } else if (url.origin === location.origin) {
    // App-Dateien: erst Netz (für Updates), sonst Speicher
    e.respondWith(fetch(e.request)
      .then(res => { const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); return res; })
      .catch(() => caches.match(e.request)));
  }
});
