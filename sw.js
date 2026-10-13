// Cache hors ligne : l'application fonctionne sur le chantier même sans réseau après une 1re visite.
const CACHE = 'ndq-v1.0.0';
const ASSETS = ['./', 'index.html', 'css/app.css', 'js/app.js', 'js/frt.js', 'js/alignment.js', 'js/compute.js', 'js/xlsx.js', 'js/chart.js', 'js/store.js',
  'vendor/jszip.min.js', 'vendor/sql-wasm.js', 'vendor/sql-wasm.wasm', 'manifest.webmanifest', 'icon.svg'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
// réseau d'abord (pour recevoir les mises à jour), cache en repli
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(fetch(e.request).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r; })
    .catch(() => caches.match(e.request, { ignoreSearch: true })));
});
