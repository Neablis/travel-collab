### KI-2026-09-24-n — the unit and integration network guard blocks `fetch` only; `http`/`https`, XHR, `sendBeacon` and WebSocket can still reach a third party

- **Severity:** process. There's no known leak today. This is a gap in the backstop behind the "no automated test talks to a real third party" policy (Mitchell, 2026-09-24).
- **Area:** `apps/web/src/test-support/networkGuard.ts`, installed by `networkGuard.setup.ts`, which both lanes run (`vitest.config.ts` names it; `apps/web/vitest.setup.ts` imports it).
- **Symptom / what happens:** the guard rejects any `fetch` to a non-localhost host that MSW doesn't answer. Node `http.request`/`https.request`, `XMLHttpRequest`, `navigator.sendBeacon` and `WebSocket` aren't intercepted. A future dependency that uses one of them would reach the real service silently.
- **Why it matters more than it looks:** the integration lane loads `apps/web/.env.local`, which on a developer machine carries real `LOCATIONIQ_API_KEY`, `AI_GATEWAY_API_KEY` and `STRIPE_SECRET_KEY` values. The guard is the only thing between an unstubbed call and the vendor.
- **Why not fixed here:** checked 2026-09-24. Nothing that tests import uses those transports; every third-party client in `src/server` goes through `fetch`. Sentry's node transport is the exception, and it is closed by the DSN instead: `networkGuard.setup.ts` forces `NEXT_PUBLIC_SENTRY_DSN` to `""` in both lanes, overriding a value `.env.local` may set, and `networkGuard.int.test.ts` asserts it. Covering them is cheap only if something starts to need it.
- **The e2e lane is covered differently:** Chromium launches with `--host-resolver-rules` that fail every non-app host, and route interception answers the map host (`apps/web/playwright.config.ts`, `e2e/fixtures/mapTiles.ts`).
- **Cross-reference:** `docs/guidelines/testing.md`, `docs/guidelines/third-party-services-on-a-preview.md`.
- **First noted:** 2026-09-24, the no-third-party-in-tests change.
