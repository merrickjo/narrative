// Offline cache for the app. Rules:
//  1. Online, every app file comes from the network (bypassing the browser's HTTP cache), so the page and
//     its scripts are always the same version. Each response also refreshes the offline copy.
//  2. Offline (or the network fails), files come from the offline copy.
//  3. Install/refresh always downloads with cache:"reload", so the offline copy is never filled with stale files.
// Bump VERSION on every release.
const VERSION = "narrative-v2.2.1";
const SHELL = [
  "./", "index.html", "output.html", "remote.html", "manifest.webmanifest",
  "css/app.css", "css/stage.css", "css/remote.css",
  "js/app.js", "js/output.js", "js/stage.js", "js/db.js", "js/bible.js", "js/scripture.js", "js/song.js",
  "js/remote.js", "js/remote-link.js", "js/vendor/qrcode.mjs",
  "fonts/plex-400.woff2", "fonts/plex-500.woff2", "fonts/plex-600.woff2", "fonts/literata-600.woff2",
  "icons/icon.svg", "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png",
];
const fresh = u => new Request(u, { cache: "reload" });

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL.map(fresh))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
// "Save session": re-download the shell when online, then report what's in the cache.
self.addEventListener("message", e => {
  if (!e.data || e.data.t !== "precache" || !e.ports[0]) return;
  e.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    let refreshed = false;
    try { await cache.addAll(SHELL.map(fresh)); refreshed = true; } catch {}
    const missing = [];
    for (const u of SHELL) if (!(await cache.match(u, { ignoreSearch: true }))) missing.push(u);
    e.ports[0].postMessage({ total: SHELL.length, missing, refreshed });
  })());
});

self.addEventListener("fetch", e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;   // ESV API, relay etc. go straight to the network
  e.respondWith((async () => {
    try {
      const res = await fetch(req, { cache: "no-cache" });               // revalidate: never a stale HTTP-cache copy
      if (res.ok && res.type === "basic"){
        const copy = res.clone();
        caches.open(VERSION).then(c => c.put(url.pathname.endsWith("/") ? url.pathname : req, copy)).catch(() => {});
      }
      return res;
    } catch {
      const hit = await caches.match(req, { ignoreSearch: true });
      if (hit) return hit;
      if (req.mode === "navigate") return (await caches.match("index.html")) || Response.error();
      return Response.error();
    }
  })());
});
