/* offline copy of the handbook. caches only this site's own files. */
var CACHE = "handbook-2026-10-03b";
var FILES = [
  "./", "index.html", "css/style.css", "js/checker.js", "js/app.js", "favicon.svg",
  "fonts/chewy-400.woff2", "fonts/nunito-var.woff2", "fonts/courier-prime-400.woff2", "fonts/courier-prime-700.woff2"
];
self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(FILES); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  // network first, so updates show up; fall back to the saved copy when offline
  e.respondWith(fetch(req).then(function (res) {
    if (res && res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); }
    return res;
  }).catch(function () {
    return caches.match(req, { ignoreSearch: true }).then(function (hit) { return hit || caches.match("index.html"); });
  }));
});
