// ZeroCAD's service worker, written by hand (docs/plans/pwa-pages.md). The
// build (scripts/pwa-shell.ts) fills in the two names below; nothing else
// about it changes between builds, so a new deploy is a new worker exactly
// when the build stamp — and so the cache's name — has changed.
//
// Cache first: the page is the whole app (the kernel rides inside it as
// base64), so once it is cached the app starts with no network at all.
//
// **Never on its own: no skipWaiting, no clients.claim, no reload.** A new
// worker installs beside the old one, fills its own cache and then waits; the
// open app keeps running on the old one's cache, untouched. The browser
// activates the new worker once no window of the app is left open, so the new
// version is what the next start gets — never a page swapped under a hand
// that is drawing. **The one exception is asked for**: the app shows "Update
// ready" (src/update.ts), and a tap on it — after the drawing is autosaved —
// posts "zerocad:update-now", which is the only thing that makes a waiting worker
// skip its wait. The owner found "close it from the app switcher, maybe
// twice" too much to ask; a tap is the same consent, given in place.
//
// Every relative URL here resolves against this script's own, which is in the
// app's folder (/zerocad/sw.js on Pages): "./" is the app.

const CACHE = "zerocad-ff4f735-2026-11-12";
const SHELL = ["./","manifest.webmanifest","icons/icon.svg","icons/icon-192.png","icons/icon-512.png","icons/icon-maskable-512.png","icons/apple-touch-icon.png","solids/worker.js","solids/smlib.wasm","solids/LICENSE"];

self.addEventListener("install", (event) => {
  // "reload": past the HTTP cache, which on Pages holds a file for ten
  // minutes — without it a new worker could fill its new cache with the
  // previous deploy's page.
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL.map((path) => new Request(path, { cache: "reload" })))),
  );
});

self.addEventListener("activate", (event) => {
  // Only caches of this app: the origin's caches are shared with every other
  // site the account publishes, and theirs are not ours to delete.
  // `neocad-` too: the app was NeoCAD until 0.1.0, and a phone that installed
  // it then holds a cache under that name which nothing else would delete.
  // Keep this in step with CACHE_PREFIX in scripts/pwa-shell.ts.
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => (key.startsWith("zerocad-") || key.startsWith("neocad-")) && key !== CACHE).map((key) => caches.delete(key))),
    ),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      // A navigation is the app whatever its address (index.html, a query
      // string a launcher added): the one page there is.
      const hit = (await cache.match(request, { ignoreSearch: true })) ??
        (request.mode === "navigate" ? await cache.match("./") : undefined);
      return hit ?? fetch(request);
    }),
  );
});

// Asked for, by a tap on the app's "Update ready" (see the top of the file).
// Any other message is not ours and changes nothing.
self.addEventListener("message", (event) => {
  if (event.data === "zerocad:update-now") self.skipWaiting();
});
