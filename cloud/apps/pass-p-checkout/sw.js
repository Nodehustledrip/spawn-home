/* Hosted app SW — pass-p-checkout */
const CACHE = "cloud-pass-p-checkout-v1";
const SCOPE = self.registration.scope;
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll([SCOPE, SCOPE + "index.html"]).catch(() => {})).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const u = new URL(req.url);
  if (u.origin !== self.location.origin || u.pathname.indexOf("/api/") !== -1) return;
  e.respondWith(fetch(req).then((res) => { const copy = res.clone(); if (res.ok) caches.open(CACHE).then((c) => c.put(req, copy)); return res; }).catch(() => caches.match(req).then((h) => h || caches.match(SCOPE))));
});
