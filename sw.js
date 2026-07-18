// Network-first, cache-fallback: updates arrive when online, everything works offline.
const CACHE = 'gph-v2';
const LIB = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js';
const ASSETS = ['.', 'index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', LIB];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))));
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  // never cache API traffic (Supabase auth/data) — only our own assets and the supabase-js lib
  if (new URL(e.request.url).origin !== location.origin && e.request.url !== LIB) return;
  e.respondWith(
    // no-cache on navigations: revalidate with the server (ETag 304) instead of
    // trusting GitHub Pages' 10-min HTTP cache, so deploys show up on next open
    fetch(e.request, e.request.mode === 'navigate' ? { cache: 'no-cache' } : {}).then(r => {
      const copy = r.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return r;
    // ignoreSearch: exercise settings live in the query string, but it's the same page
    }).catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
