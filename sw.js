/* ==========================================================
   Zaytoon Restaurant — Service Worker (Step 5: offline / PWA)
   ----------------------------------------------------------
   IMPORTANT FOR DEVELOPERS
   • Browsers only allow service workers on  http://localhost
     or  https://  — NOT when index.html is opened by
     double-clicking it (file://). Opened that way, the site
     still works normally, it just has no offline cache.
     To test offline mode locally, run a small server in the
     project folder, for example:
         python -m http.server 8080
     then open  http://localhost:8080/
   • Android / iOS packaging (a later step) provides a proper
     environment for this file.

   UPDATING THE APP
   • Pages: network first (fresh when online).
   • JS / CSS / JSON: saved copy first, refreshed in the background,
     so changes reach users on their next visit automatically.
   • Images / fonts / icons: saved copy first.
   For a clean update of everything at once, increase CACHE_VERSION
   below. The new version downloads into a NEW cache; the old cache
   is only deleted after the new one is complete (no blank screen).
   ========================================================== */

'use strict';

const CACHE_VERSION = 'v7';   // v7: Android app helper file added
const CACHE_PREFIX = 'zaytoon-cache-';
const CACHE_NAME = CACHE_PREFIX + CACHE_VERSION;   // e.g. "zaytoon-cache-v5"

// App shell — these MUST cache, otherwise installation is retried later
const CORE_FILES = [
  './',
  './index.html',
  './boot.js',
  './native-app.js',
  './style.css',
  './script.js',
  './menu-data.js',
  './restaurant-data.js',
  './supabase-config.js',
  './supabase-data.js',
  './manifest.json'
];

// Uploaded menu images (Supabase Storage) are kept in their own cache,
// so a new app version does not throw them away.
const IMAGE_CACHE = 'zaytoon-images-v1';
const IMAGE_CACHE_MAX = 200;

// Public Storage address for menu images, read from supabase-config.js.
// Supabase DATABASE / AUTH requests are never cached here — the app keeps
// its own small public-data copy, and tokens must never be stored.
function getStorageImagePrefix() {
  try {
    importScripts('./supabase-config.js');
    const cfg = self.ZAYTOON_SUPABASE || {};
    if (!cfg.url) return null;
    return `${cfg.url.replace(/\/+$/, '')}/storage/v1/object/public/${cfg.storageBucket || 'menu-images'}/`;
  } catch (error) {
    return null;
  }
}
const STORAGE_IMAGE_PREFIX = getStorageImagePrefix();

// Extra local files — cached one by one; a missing file never breaks installation
const OPTIONAL_FILES = [
  './logo/WhatsApp Image 2026-10-26 at 12.51.45 PM.jpeg',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/icon-maskable-512.png',
  './assets/icons/apple-touch-icon.png',
  './assets/fonts/cormorant-garamond-latin-500-normal.woff2',
  './assets/fonts/cormorant-garamond-latin-600-normal.woff2',
  './assets/fonts/cormorant-garamond-latin-500-italic.woff2',
  './assets/fonts/manrope-latin-400-normal.woff2',
  './assets/fonts/manrope-latin-500-normal.woff2',
  './assets/fonts/manrope-latin-600-normal.woff2',
  './assets/fonts/manrope-latin-700-normal.woff2',
  './assets/fonts/noto-naskh-arabic-arabic-400-normal.woff2',
  './assets/fonts/noto-naskh-arabic-arabic-600-normal.woff2',
  './assets/fonts/noto-naskh-arabic-arabic-700-normal.woff2'
];

// Menu images: read from menu-data.js, so the image list lives in ONE place
function getMenuImagePaths() {
  try {
    importScripts('./menu-data.js');
    const items = (self.ZAYTOON_MENU && self.ZAYTOON_MENU.items) || [];
    return items.map((item) => './' + item.image);
  } catch (error) {
    console.warn('[Zaytoon SW] Could not read menu-data.js; menu images will be cached when first viewed.', error);
    return [];
  }
}
const MENU_IMAGES = getMenuImagePaths();

/** Turns a path like "./img/My Photo.jpeg" into a proper request (spaces → %20). */
function toRequest(path) {
  // cache: 'reload' skips the browser's normal HTTP cache, so we store fresh copies
  return new Request(encodeURI(path), { cache: 'reload' });
}


/* ---------- Install: download everything into the NEW cache ---------- */
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);

    // 1. Core app shell (all or nothing)
    await cache.addAll(CORE_FILES.map(toRequest));

    // 2. Optional files + menu images (each on its own; failures are only logged)
    const results = await Promise.allSettled(
      [...OPTIONAL_FILES, ...MENU_IMAGES].map(async (path) => {
        const response = await fetch(toRequest(path));
        if (!response.ok) throw new Error(`${response.status} ${path}`);
        await cache.put(encodeURI(path), response);
      })
    );
    results
      .filter((result) => result.status === 'rejected')
      .forEach((result) => console.warn('[Zaytoon SW] Skipped file:', result.reason && result.reason.message));

    // Use the new version straight away (the cache is complete at this point)
    await self.skipWaiting();
  })());
});


/* ---------- Activate: remove OLD Zaytoon caches only ---------- */
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names
        .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)   // IMAGE_CACHE is kept
        .map((name) => caches.delete(name))
    );
    await self.clients.claim();
  })());
});


/* ---------- Fetch: decide where each request is answered from ---------- */
self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Only handle simple GET requests for THIS website.
  // Facebook, TikTok, WhatsApp, tel: links and any other site are never touched.
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // Uploaded menu images from Supabase Storage: keep a copy for offline use
  if (STORAGE_IMAGE_PREFIX && request.url.startsWith(STORAGE_IMAGE_PREFIX)) {
    event.respondWith(cacheStorageImage(request));
    return;
  }
  if (url.origin !== self.location.origin) return;

  // Admin pages and files are NEVER cached: they always come straight from
  // the network, so no admin screens or admin data are kept on the device.
  // Supabase API / Auth requests (tokens!) are on another origin and are never
  // touched by this service worker — only public Storage images are cached.
  if (isAdminPath(url.pathname)) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstPage(request));
  } else if (/\.(js|css|json)$/.test(url.pathname)) {
    // App code & data: answer instantly from the cache, then quietly fetch the
    // newest version for next time — so updates arrive even if CACHE_VERSION
    // was not changed, and the app never gets stuck on old code.
    event.respondWith(staleWhileRevalidate(request, event));
  } else {
    event.respondWith(cacheFirst(request));   // images, fonts, icons
  }
});

/** admin.html, admin.css, admin.js, supabase-auth.js (and any future /admin… path). */
function isAdminPath(pathname) {
  const file = pathname.split('/').pop() || '';
  return file.startsWith('admin') || file === 'supabase-auth.js' || pathname.includes('/admin/');
}

/** Only the customer page is stored as the offline app shell. */
function isCustomerPage(url) {
  const file = url.pathname.split('/').pop();
  return file === '' || file === 'index.html';
}

const NETWORK_TIMEOUT_MS = 4000;   // slow connection? use the saved page after 4 s

/** Pages: try the network (fresh HTML), fall back to the saved index.html. */
async function networkFirstPage(request) {
  const cache = await caches.open(CACHE_NAME);
  const savedPage = () => cache.match('./index.html').then((page) => page || cache.match('./'));

  const network = fetch(request).then((response) => {
    if (response.ok && isCustomerPage(new URL(request.url))) cache.put('./index.html', response.clone());
    return response;
  });
  const timeout = new Promise((resolve) => setTimeout(resolve, NETWORK_TIMEOUT_MS, null));

  // Whichever comes first: the network answer, or the time limit
  const first = await Promise.race([network.catch(() => null), timeout]);
  if (first) return first;

  // Network failed or is too slow: show the saved app
  const saved = await savedPage();
  if (saved) return saved;

  // Nothing saved yet: keep waiting for the network, or show a simple offline page
  try {
    return await network;
  } catch (error) {
    return offlineFallbackPage();
  }
}

/** Saved copy now (if any), refreshed in the background for the next visit. */
async function staleWhileRevalidate(request, event) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request, { ignoreSearch: true });
  const refresh = fetch(request)
    .then(async (response) => {
      if (response.ok && response.type === 'basic') await cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);
  if (cached) {
    event.waitUntil(refresh);     // keep the worker alive until the refresh is saved
    return cached;
  }
  return (await refresh) || Response.error();
}

/** Static files (fonts, images, icons): use the saved copy; download and save it if missing. */
async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request, { ignoreSearch: true });
  if (cached) return cached;

  try {
    const response = await fetch(request);
    // Save only complete, same-site responses
    if (response.ok && response.type === 'basic') cache.put(request, response.clone());
    return response;
  } catch (error) {
    // Offline and not saved: fail normally so the page shows its own fallback
    // (missing menu images show the "Menu image unavailable" card).
    return Response.error();
  }
}

/** Supabase Storage images: saved copy first, otherwise download and save (max 200). */
async function cacheStorageImage(request) {
  const cache = await caches.open(IMAGE_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    // Images load without CORS, so the response may be "opaque" (status 0) — still a valid image
    if (response.ok || response.type === 'opaque') {
      await cache.put(request, response.clone());
      const keys = await cache.keys();
      if (keys.length > IMAGE_CACHE_MAX) await cache.delete(keys[0]);   // drop the oldest
    }
    return response;
  } catch (error) {
    return Response.error();   // the page then shows the local copy or "Image unavailable"
  }
}

/** Last-resort page, only used if even index.html is not in the cache. */
function offlineFallbackPage() {
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Zaytoon Restaurant — Offline</title>
    <style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#070806;color:#f4f2ea;
    font-family:system-ui,sans-serif;text-align:center;padding:24px}h1{font-weight:600}p{color:#a9ab9c}</style>
    </head><body><main><h1>Zaytoon Restaurant</h1>
    <p>You are offline and the app has not been saved on this device yet.<br>
    Please connect to the internet once and open the app again.</p></main></body></html>`;
  return new Response(html, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

/* FUTURE (not implemented yet): when menu images come from online storage
   (e.g. Supabase), add that storage address to an allow-list here and cache
   those images too. Until then, external addresses are deliberately ignored. */
