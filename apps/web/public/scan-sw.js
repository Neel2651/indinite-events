// Indinite scanner service worker: keep /scan and its assets usable offline.
// Only the scanner is cached; the rest of the site always goes to the network.
const CACHE = "indinite-scanner-v1";
const SHELL = ["/scan", "/scan.webmanifest", "/scanner-icon-192.png", "/scanner-icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Scanner page: network first, cached copy when offline.
  if (req.mode === "navigate" && url.pathname === "/scan") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put("/scan", copy));
          return res;
        })
        .catch(() => caches.match("/scan")),
    );
    return;
  }

  // Built assets (hashed file names): cache first.
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/_next/") || SHELL.includes(url.pathname)) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
  }
});
