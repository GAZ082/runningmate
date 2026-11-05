/* Running Mate service worker
   - App files: network first (so updates arrive), cached copy when offline.
   - Map style/tiles/fonts: cache first, so areas you've already seen still show offline.
   Bump VERSION when you change the app files. */
const VERSION = 'rm-20261105-1340';
const APP_CACHE = `${VERSION}-app`;
const MAP_CACHE = 'rm-map';           // kept across versions
const MAP_MAX_ENTRIES = 3000;
const APP_FILES = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './icon-maskable-512.png', './apple-touch-icon.png'];
const MAP_HOSTS = ['tiles.openfreemap.org', 'api.maptiler.com', 's3.amazonaws.com']; // s3 = elevation tiles

self.addEventListener('install', e => {
  e.waitUntil(caches.open(APP_CACHE).then(c => c.addAll(APP_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for(const k of await caches.keys()) if(k !== APP_CACHE && k !== MAP_CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

async function trim(cache){
  const keys = await cache.keys();
  for(let i = 0; i < keys.length - MAP_MAX_ENTRIES; i++) await cache.delete(keys[i]);
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if(req.method !== 'GET') return;
  const url = new URL(req.url);

  // Same-origin app files: network first, fall back to cache.
  if(url.origin === self.location.origin){
    e.respondWith((async () => {
      const cache = await caches.open(APP_CACHE);
      try{
        const res = await fetch(req);
        if(res.ok) cache.put(req.mode === 'navigate' ? './index.html' : req, res.clone());
        return res;
      }catch{
        return (await cache.match(req, { ignoreSearch: true })) ||
               (req.mode === 'navigate' ? await cache.match('./index.html') : undefined) ||
               new Response('Offline', { status: 503 });
      }
    })());
    return;
  }

  // Map data. Tiles, fonts and sprites never change at a given URL: cache first.
  // Style / TileJSON files point at the current tile version: network first.
  if(MAP_HOSTS.includes(url.hostname)){
    const immutable = /\.(pbf|mvt|png|webp|jpg)$/i.test(url.pathname) || /\/(fonts|sprites?)\//.test(url.pathname);
    e.respondWith((async () => {
      const cache = await caches.open(MAP_CACHE);
      if(immutable){
        const hit = await cache.match(req);
        if(hit) return hit;
      }
      try{
        const res = await fetch(req);
        if(res.ok){ cache.put(req, res.clone()).then(() => trim(cache)); }
        return res;
      }catch{
        return (await cache.match(req)) || new Response('', { status: 504 });
      }
    })());
  }
});
