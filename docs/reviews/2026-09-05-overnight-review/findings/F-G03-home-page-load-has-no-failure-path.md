# F-G03 — The home page's `load()` handles only 401; a 500 or a rejecting fetch leaves the page silently empty forever

- **Stream:** G Broken functionality · **Severity:** LOW · **Confidence:** CONFIRMED by reading (third site of the class the 2026-08-28 review named; `TripProvider.load` was fixed, this was not)
- **Area:** `apps/web/src/app/(app)/page.tsx:108-121` (`fetch("/api/trips")`; only `401` handled; `await res.json()` on a non-JSON 500 body throws; a fetch rejection escapes `void load()`), `:105-106` (`hasNoTrips` requires `trips !== null`), `:386-417` (render branches). Compare `TripProvider.tsx:101`, which gained `try {` after the 2026-08-28 review.
- **What is wrong:** `trips` stays `null`, so neither the first-run card nor the grid nor any error renders — just the title row and "New trip", no message, no retry, plus an unhandled rejection in the console.
- **Reproduction:** Playwright `page.route("**/api/trips", r => r.fulfill({ status: 500, body: "boom" }))` then `goto("/")` → no alert, no cards, no first-run card.
- **Suggested fix:** `try/catch` around the fetch; non-ok → an error state with a retry affordance; keep 401 → `/welcome`. Better: route this through `apiClient` (F-E03 — this is one of its three raw fetches), which already has the totality invariant.
- **Scope of the fix:** one file. Check subset: a component test with mocked fetch.
- **Cross-reference:** 2026-08-28 review §1.1 (still open at this site), KI-005, F-E03.
- **Do not:** redirect to `/welcome` on non-401.
