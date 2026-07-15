const CACHE_NAME = "momentum-shell-v3";
const SHELL_FILES = [
  "./",            // the bare directory URL (what a browser tab opens)
  "./index.html",  // the start_url the installed app opens
  "./style.css",
  "./app.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Stale-while-revalidate for same-origin requests: serve the cached copy instantly
// (so it works fully offline and loads fast), while refreshing the cache in the
// background so the next launch has the latest. Cross-origin (the GitHub sync API)
// is never touched. Any navigation that can't be served falls back to the app shell,
// so opening the bare URL offline still works.
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;

  e.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(e.request);
      const network = fetch(e.request)
        .then((res) => {
          if (res && res.ok) cache.put(e.request, res.clone());
          return res;
        })
        .catch(() => null);

      if (cached) { network; return cached; }        // have it → serve now, refresh behind the scenes
      const fresh = await network;
      if (fresh) return fresh;                        // not cached but online → use network
      if (e.request.mode === "navigate") return cache.match("./index.html"); // offline page → app shell
      return new Response("", { status: 504 });
    })
  );
});
