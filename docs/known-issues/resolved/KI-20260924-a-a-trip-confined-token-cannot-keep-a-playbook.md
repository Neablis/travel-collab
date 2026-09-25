### KI-2026-09-24-a — a trip-confined API token cannot keep a day or a Playbook, even from the trip it names — RESOLVED

- **Resolved 2026-09-25 (overnight KI sweep).** `route()` gained a second trip
  source: `TripSource = "path" | { body: (body) => string | null }`. With
  `{ body }`, the wrapper reads the trip id out of the already-parsed body and
  runs the same two gates as `"path"` (confinement, then the role), handing the
  handler `ctx.trip`; `null` makes the request tripless, so a confined token is
  refused with `trip-out-of-scope` as before. `POST /v1/library` and
  `POST /v1/playbooks` declare it with `role: "viewer"`. The by-hand gate in
  `library.ts` (`sourceTrip`) is gone, and `sourceTrip` now just reads
  `ctx.trip`. `openapi.json` names the role for both, qualified "on the trip the
  body names, if it names one". `using-the-api.md` (*Trip-scoped tokens*, and
  the rule that used to call the library the worked example of a hand check)
  and ADR-050's Consequences are corrected. **Proof:** `playbooks.int.test.ts`,
  *"a trip-confined token writing the library"* replaces the test that pinned
  the refusal. Before the fix, *"keeps days of the trip it names"* failed with
  `POST /v1/playbooks: expected 403 to be 201`. With the fix, the three cases
  pass: own trip is 201 through both creates, another trip is 403
  `trip-out-of-scope` through both, and an inline body is 403
  `trip-out-of-scope` (201 from an account-wide token). Red-first: with gate
  one skipped for body routes, *"is refused a trip it does not name"* fails with
  `expected 201 to be 403`. With the tripless refusal skipped for body routes,
  *"is refused a body that names no trip"* fails with `expected 201 to be 403`.
  **Checks:** the int files `playbooks`, `playbookFiles`, `collections`,
  `discover`, `route`, `idempotency` (81/81). Unit `openapi`, `conformance`,
  `discovery` (11/11). Web typecheck, eslint on the touched files.
- **Decision (2026-09-25 overnight sweep):** option (a), a declarative trip
  source on `route()`, not option (b). Option (b) would have documented that
  confined tokens cannot write the library. I also rejected a string
  `trip: "body"` with a fixed field name, because the Playbook's trip is nested
  (`source.tripId`) and optional. And I rejected keeping the by-hand
  `sourceTrip` gate behind a wrapper that only skips the tripless refusal,
  because that would leave two copies of the gate. One side effect: on the
  idempotent `POST /v1/playbooks`, a trip refusal now happens before the
  `Idempotency-Key` is reserved, as on every path-trip route. So a 403 or 404
  for the source trip is no longer stored and replayed.

- **Severity:** capability gap on the public API. Nothing is exposed; a confined
  token is refused more than it should be, never less.
- **Area:** `apps/web/src/server/public-api/route.ts` (the tripless refusal for
  confined tokens), `apps/web/src/server/public-api/library.ts` (`sourceTrip`,
  the by-hand trip gate), `POST /v1/library`, `POST /v1/playbooks`.
- **Symptom:** a token minted with `tripIds: [T]` gets 403 `trip-out-of-scope`
  from `POST /v1/library` and `POST /v1/playbooks` with `tripId: T`. Neither
  collection declares `trip`, so `route()` refuses every confined token before
  the handler runs, and the by-hand confinement check in `sourceTrip` — which
  would let `T` through — is unreachable for a token.
- **Why not fixed here:** it predates ADR-050 (`POST /v1/library` behaved this
  way since M22), and fixing it is a decision about what a confined token is
  for, not a bug fix: either `route()` learns a "trip in body" mode, or confined
  tokens are documented as unable to write the library. `using-the-api.md`
  still calls `POST /v1/library` "the worked example" of a body-trip check,
  which is misleading until one of those lands. `playbooks.int.test.ts` pins
  the current behaviour.
- **Cross-reference:** ADR-050 Consequences; M22.
- **First noted:** 2026-09-24, Playbooks API Phase 1.
