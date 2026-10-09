// Caesura's service worker (M39 Part 4, D4). Hand-written, because the build is
// Turbopack and no PWA plugin supports it; served as a plain public file.
//
// **It caches static assets and nothing else.** `/_next/static/**` is
// content-hashed, so a URL there names the same bytes forever and cache-first
// can never serve something stale. The app icons are the only other entries.
// Every other request — every page, `/api/**`, the share and invite links
// (`/s/**`, `/invite/**`, whose URL is a bearer token), Sentry's `/monitoring`
// tunnel — is not intercepted at all and goes to the network exactly as it
// would with no worker installed. A page can carry trip data, so no page is
// cached either: offline trip data reverses ADR-012 and ADR-046 and needs its
// own ADR (M39 D4).
//
// `cacheStrategyFor` is the whole decision, and it is an allowlist: a path is
// cached only by being named here. `src/lib/serviceWorker.test.ts` runs THIS
// file in a sandbox and asserts the routes D4 names are never cached.
//
// Bump CACHE_VERSION when an icon changes: icons are not content-hashed, and
// activating a new version is what drops the old cache.
const CACHE_VERSION = 1;
const CACHE_NAME = `caesura-static-v${CACHE_VERSION}`;

// Hashed chunks accumulate across deploys under one cache version, so the cache
// is trimmed, oldest first, past this many entries. A trimmed chunk the page
// still uses is fetched again on its next request; nothing breaks.
const MAX_ENTRIES = 400;

const CACHED_FILES = new Set(["/icon.svg", "/apple-icon.png"]);

/**
 * How this worker treats a request for `url`: `"cache-first"` for a static
 * asset of this origin, `"network"` — left alone entirely — for anything else.
 */
function cacheStrategyFor(url) {
  if (url.origin !== self.location.origin) return "network";
  const path = url.pathname;
  if (path.startsWith("/_next/static/")) return "cache-first";
  if (path.startsWith("/icons/") || CACHED_FILES.has(path)) return "cache-first";
  return "network";
}

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key !== CACHE_NAME) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  if (cacheStrategyFor(new URL(request.url)) !== "cache-first") return;
  event.respondWith(cacheFirst(event, request));
});

/**
 * Answers `request` from this worker's cache, or fetches it and keeps a copy.
 * Only a successful same-origin response is stored, so a failure is retried on
 * the next request rather than served from cache.
 */
async function cacheFirst(event, request) {
  const cache = await caches.open(CACHE_NAME);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  // `basic` is a same-origin response the page could read; an error or a
  // redirect is not stored, so a failed fetch is retried next time.
  if (response.ok && response.type === "basic") {
    event.waitUntil(cache.put(request, response.clone()).then(() => trim(cache)));
  }
  return response;
}

/**
 * Drops the oldest entries past `MAX_ENTRIES`. Hashed chunks change name on
 * every deploy, so without this the cache only ever grows.
 */
async function trim(cache) {
  const keys = await cache.keys();
  for (const key of keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES))) {
    await cache.delete(key);
  }
}
