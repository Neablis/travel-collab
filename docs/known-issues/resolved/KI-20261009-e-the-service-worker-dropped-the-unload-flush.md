### KI-2026-10-09-e — the service worker dropped the unload flush, so edits still queued at a reload or tab close were lost — RESOLVED

- **Severity:** correctness, production. Silent data loss, in every production browser that had the
  M39 Part 4 worker installed.
- **Area:**
  - `apps/web/public/sw.js`: the `fetch` listener (M39 Part 4, D4).
  - The flush it got in the way of: `pagehide`'s keepalive `POST /api/trips/<id>/commands/batch`
    (KI-005, `resolved/KI-005-optimistic-commands-silently-lost-abrupt-navigation.md`; ADR-066).
- **Symptom:** several quick edits, then a reload or a closed tab before the send queue drained. The
  server kept the unit that was in flight and lost the rest — KI-005's symptom, back again.
- **Cause:** the worker had a `fetch` listener that cached `/_next/static/**` and the icons, and
  returned without `respondWith` for everything else. A listener that declines a request still puts
  the worker in that request's path. The browser dispatches the event to the worker first and only
  then falls back to the network. During unload that fall-back often happened after the page was
  gone, and the keepalive batch never reached the server. Chrome's static routing (`addRoutes`)
  could have exempted the API, but only in Chrome 123+; Safari and Firefox would still have routed
  through the listener.
- **Evidence** (ci-like build of `ef9f0e5`, `--retries=0 --workers=1`):
  - `e2e/m6-unload-flush.spec.ts:61` failed 4 of 20 runs with the worker, and 0 of 20 with
    `serviceWorkers: 'block'`.
  - A spec with no `page.route` and 400ms browser latency (CDP `Network.emulateNetworkConditions`)
    at the reload lost edits in 13 of 20 runs with the worker, and 0 of 20 with it blocked.
  - Server-side logging showed the batch never arrived in the failing runs.
  - The existing unload specs could barely see it: they route `/commands`, and Playwright serves a
    routed request before any worker sees it.
- **First noted:** 2026-10-09, M39 Part 4 in production.
- **Resolved:** 2026-10-09. `sw.js` has no `fetch` listener, so no request goes through the worker
  in any browser. It still registers, for installability. `install` skips the wait and `activate`
  claims the open pages, so the fix replaces the old worker in windows already open. `activate`
  also deletes every `caesura-static-*` cache, since nothing reads them now. The header comment
  says why there is no listener.
- **Proof:**
  - `e2e/m6-unload-flush.spec.ts`, "edits queued at a reload reach the server with the service
    worker in control". It has no route and adds 400ms of CDP latency. It asserts the worker
    controls the page, adds six days, reloads, then polls the server for all six.
  - Red on a build of the old `sw.js` (`--repeat-each=10 --retries=0 --workers=1`): 8 of 10
    failed on `ef9f0e5`, and 10 of 10 on main after PR #372, `Expected: 6 Received: 2` every time.
  - Green on a build with the fix, the whole spec at `--repeat-each=20 --retries=0 --workers=1`:
    80/80 passed (the new test 20/20, the three existing ones 60/60).
  - `src/lib/serviceWorker.test.ts` runs `sw.js` in a sandbox and asserts that the only listeners
    are `install` and `activate`. Re-adding `self.addEventListener("fetch", () => {})` fails it:
    `expected [ 'activate', 'fetch', 'install' ] to deeply equal [ 'activate', 'install' ]`.
  - `e2e/m39-installable.spec.ts` still finds no installability errors, and asserts that nothing
    a controlled page loads comes from the worker.
