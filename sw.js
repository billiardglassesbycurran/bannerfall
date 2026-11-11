// Offline cache for Bannerfall (lets it run as a home-screen app and load fast on a weak signal).
// Every game file is versioned (?v=VERSION), so cached copies never go stale; index.html is always fetched fresh when online.
const VERSION = new URL(self.location).searchParams.get('v') || 'dev';
const CACHE = 'bannerfall-' + VERSION;
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(['./', 'manifest.webmanifest', 'assets/icons/icon-192.png']))); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('bannerfall-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url), page = req.mode === 'navigate' || url.pathname.endsWith('/') || url.pathname.endsWith('index.html');
  if (page) { // network first, so new versions show up right away
    e.respondWith(fetch(req).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put('./', copy)); return r; }).catch(() => caches.match('./')));
    return;
  }
  const cacheable = url.searchParams.has('v') || url.hostname === 'cdn.jsdelivr.net' || url.pathname.includes('/assets/');
  if (!cacheable) return;
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => { if (r.ok || r.type === 'opaque') { const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)); } return r; })));
});
