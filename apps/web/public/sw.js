// Caesura's service worker (M39 Part 4, D4). Hand-written, because the build is
// Turbopack and no PWA plugin supports it; served as a plain public file. It
// exists so the app can be installed, and does nothing else.
//
// **It has no `fetch` listener, deliberately — do not add one.** A worker with
// a fetch listener sits in the path of EVERY request its pages make, including
// the ones the listener declines by returning without `respondWith`: the
// browser still dispatches the event to the worker and only then falls back to
// the network. Part 4 shipped a listener that cached `/_next/static/**` and
// declined the rest, and that fall-back is what lost edits: the `pagehide`
// keepalive flush (`POST /commands/batch`, KI-5, ADR-066) went through the
// worker, whose fall-back often ran after the page was gone, and the batch never
// reached the server — 13 of 20 reloads on a 400ms network lost queued edits,
// 0 of 20 with the worker blocked (KI-2026-10-09-e). Chrome's static routing
// (`addRoutes`) could exempt the API in Chrome 123+ only; Safari and Firefox
// would still route through the listener. Caching static assets is not worth
// that, and offline trip data needs its own ADR anyway (ADR-012, ADR-046,
// M39 D4). `src/lib/serviceWorker.test.ts` runs THIS file and fails if a fetch
// listener appears.
//
// Activation deletes every `caesura-static-*` cache: the worker that filled
// them is gone, and nothing reads them now.
//
// **A new version skips the wait.** Without `skipWaiting()` a changed worker
// activates only once no page uses the old one — and an installed standalone
// window is rarely closed, while Next's client navigation never unloads a tab,
// so a fix here would never reach the people it matters most to. This one is
// exactly that fix: it has to replace the listener-carrying worker in windows
// that are already open. `clients.claim()` on activate takes the open pages,
// the one that installed a first worker included.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith("caesura-static-")) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});
