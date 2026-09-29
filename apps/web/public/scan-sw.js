// Indinite staff app service worker (organiser panel, admin and the gate scanner). One per site, scope "/".
// - The scanner (/scan) and its assets work offline.
// - Organiser and admin screens always come from the network (personal data, must be fresh); with no connection
//   they show the cached /offline page instead of the browser's error.
// - Nothing else on the site is touched.
const CACHE = "indinite-v3";
const SHELL = ["/scan", "/offline", "/app.webmanifest", "/scan.webmanifest", "/app-icon-192.png", "/app-icon-512.png", "/scanner-icon-192.png", "/scanner-icon-512.png", "/brand/indinite-mark.png"];
const STAFF_PAGES = ["/org", "/dashboard", "/admin"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

// The scanner sends the files it has loaded (some load before this worker controls the page on a first visit).
self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || data.type !== "cache-urls" || !Array.isArray(data.urls)) return;
  const urls = data.urls.filter((u) => typeof u === "string" && u.startsWith(`${self.location.origin}/_next/static/`)).slice(0, 300);
  const done = caches
    .open(CACHE)
    .then((c) => Promise.all(urls.map((u) => c.match(u).then((hit) => hit || fetch(u).then((res) => (res.ok ? c.put(u, res) : undefined)).catch(() => undefined)))))
    .finally(() => event.ports[0]?.postMessage({ type: "cached" }));
  event.waitUntil(done);
});

const isStaffPage = (path) => STAFF_PAGES.some((p) => path === p || path.startsWith(`${p}/`));

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

  // Organiser / admin screens: never cached; the offline page when there's no connection.
  if (req.mode === "navigate" && isStaffPage(url.pathname)) {
    event.respondWith(fetch(req).catch(() => caches.match("/offline")));
    return;
  }

  // Built assets (hashed file names) and the app shell files: cache first.
  if (url.pathname.startsWith("/_next/static/") || SHELL.includes(url.pathname)) {
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
