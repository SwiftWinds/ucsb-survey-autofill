import { build, files } from "$service-worker";

const version = __KIT_VERSION__;

const worker = self as unknown as ServiceWorkerGlobalScope;
const CACHE_NAME = `cache${version}`;

// hard-coded list of app routes we want to preemptively cache
const routes = ["/", "/settings"];

// hard-coded list of other assets necessary for page load outside our domain
const customAssets = [
  "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap",
  "https://unpkg.com/ress/dist/ress.min.css",
  "https://fonts.gstatic.com/s/inter/v11/UcC73FwrK3iLTeHuS_fvQtMwCp50KnMa1ZL7W0Q5nw.woff2",
];

// `build` is an array of all the files generated by the bundler,
// `files` is an array of everything in the `static` directory
// `version` is the current version of the app

const addDomain = (assets: string[]) =>
  assets.map((f) => self.location.origin + f);

// we filter the files because we don't want to cache logos for iOS
// (they're big and largely unused)
// also, we add the domain to our assets, so we can differentiate routes of our
// app from those of other apps that we cache
const ourAssets = addDomain([
  ...files.filter((f) => !/\/icons\/(apple.*?|original.png)/.test(f)),
  ...build,
  ...routes,
]);

const toCache = [...ourAssets, ...customAssets];
const staticAssets = new Set(toCache);

worker.addEventListener("install", (event) => {
  console.log("installing service worker");
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => {
        console.log("caching static assets", toCache);
        return cache.addAll(toCache);
      })
      .then(() => {
        worker.skipWaiting();
      })
  );
});

worker.addEventListener("activate", (event) => {
  console.log("activating service worker");
  event.waitUntil(
    caches.keys().then(async (keys) => {
      worker.clients.claim();

      // delete old caches
      await Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => {
            console.log("deleting old cache", key);
            caches.delete(key);
          })
      );
    })
  );
});

/**
 * Immediately return with the cached version of the requested file
 * Fall back to the network if the file is not in the cache
 * Revalidate the cached version each request
 */
function staleWhileRevalidate(event: FetchEvent) {
  event.respondWith(
    caches.open(CACHE_NAME).then((cache) => {
      console.log("fetchAndCache()", event.request.url);
      console.log("cache opened", cache);
      return cache.match(event.request).then((cachedResponse) => {
        console.log("cachedResponse", cachedResponse);

        const fetchedResponse = fetch(event.request).then((networkResponse) => {
          cache.put(event.request, networkResponse.clone());

          return networkResponse;
        });

        return cachedResponse || fetchedResponse;
      });
    })
  );
}

worker.addEventListener("fetch", (event: FetchEvent) => {
  if (event.request.method !== "GET" || event.request.headers.has("range")) {
    return;
  }

  const url = new URL(event.request.url);

  // don't try to handle e.g. data: URIs
  const isHttp = url.protocol.startsWith("http");
  const isDevServerRequest =
    url.hostname === self.location.hostname && url.port !== self.location.port;
  const isStaticAsset = staticAssets.has(url.href);
  const skipBecauseUncached =
    event.request.cache === "only-if-cached" && !isStaticAsset;

  console.log("fetching", url.href);
  console.log("isHttp", isHttp);
  console.log("isDevServerRequest", isDevServerRequest);
  console.log("isStaticAsset", isStaticAsset);
  console.log("skipBecauseUncached", skipBecauseUncached);

  if (isHttp && !isDevServerRequest && !skipBecauseUncached) {
    staleWhileRevalidate(event);
  }
});
