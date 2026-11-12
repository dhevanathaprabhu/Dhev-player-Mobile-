
const CACHE_NAME = "dhev-player-v1";

const APP_FILES = [
    "./",
    "./index.html",
    "./manifest.json"
];

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(APP_FILES);
        })
    );

    self.skipWaiting();
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames
                    .filter((name) => name !== CACHE_NAME)
                    .map((name) => caches.delete(name))
            );
        })
    );

    self.clients.claim();
});

self.addEventListener("fetch", (event) => {
    const request = event.request;

    if (request.method !== "GET") return;

    const url = new URL(request.url);

    // Do not cache API responses or music files.
    if (
        url.origin !== self.location.origin ||
        url.pathname.includes("/api/") ||
        url.pathname.includes("/storage/")
    ) {
        return;
    }

    event.respondWith(
        fetch(request).catch(async () => {
            const cached = await caches.match(request);
            return cached || Response.error();
        })
    );
});
