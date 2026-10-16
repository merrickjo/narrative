// Offline-first app shell. Bump VERSION on every release so clients pick up new files.
const VERSION = "narrative-v2.0.0";
const SHELL = [
  "./", "index.html", "output.html", "manifest.webmanifest",
  "css/app.css", "css/stage.css",
  "js/app.js", "js/output.js", "js/stage.js", "js/db.js", "js/bible.js", "js/scripture.js",
  "fonts/plex-400.woff2", "fonts/plex-500.woff2", "fonts/plex-600.woff2", "fonts/literata-600.woff2",
  "icons/icon.svg", "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png",
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;   // ESV API etc. always go to the network
  // Network-first for pages (so updates show up when online), cache-first for everything else.
  if (e.request.mode === "navigate"){
    e.respondWith(fetch(e.request).then(r => { const copy = r.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); return r; })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match("index.html"))));
    return;
  }
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(r => r || fetch(e.request)));
});
