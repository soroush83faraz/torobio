/*
 * همراه‌بازار - app-shell service worker (generated into dist/sw.js at build time by vite.config.ts).
 *
 * Purpose: reloading the page while the server is unreachable shows the app (and the plans saved in localStorage)
 * instead of the browser's own error page.
 *
 * Rules:
 *  - /api/* is NEVER handled here (no respondWith, no caching): the network answers or fails, and the app shows
 *    its own calm Persian messages.
 *  - Only the built shell is cached: '/' (index.html) and the hashed files under /assets plus the favicon. They are
 *    precached on install into a cache named after the build, so every deploy gets a fresh cache and the activate
 *    step deletes the old ones. The build id changes with every build, so the browser sees a new worker.
 *    (The two placeholders in this file, the build id and the precache list, are filled in by sw/render.ts. Each
 *    must appear once, as code, and never in a comment: a replace that hits a comment first leaves the code with
 *    the raw token and the cache name then never changes between builds.)
 *  - Navigations are network-first: a deploy is picked up on the next load while the server is up; the cached shell is
 *    used only when the network fails or the server answers with a 5xx.
 */
const BUILD_ID = '__BUILD_ID__';
const CACHE = 'shell-' + BUILD_ID;
const PRECACHE = __PRECACHE__;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => Promise.all(PRECACHE.map((url) => cache.add(new Request(url, { cache: 'reload' })))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('shell-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // never cached, never touched

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => (res.status >= 500 ? shell().then((s) => s || res) : res))
        .catch(() => shell().then((s) => s || Response.error())),
    );
    return;
  }

  // hashed build files: cache first (they never change under the same name)
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.open(CACHE).then((cache) =>
        cache.match(req).then(
          (hit) =>
            hit ||
            fetch(req).then((res) => {
              if (res.ok) cache.put(req, res.clone());
              return res;
            }),
        ),
      ),
    );
    return;
  }

  // everything else of the shell (favicon...): network first, cache as the fallback
  event.respondWith(fetch(req).catch(() => caches.open(CACHE).then((cache) => cache.match(req)).then((hit) => hit || Response.error())));
});

function shell() {
  return caches.open(CACHE).then((cache) => cache.match('/'));
}
