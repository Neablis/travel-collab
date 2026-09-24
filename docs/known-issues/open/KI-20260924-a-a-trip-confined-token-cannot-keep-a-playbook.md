### KI-2026-09-24-a — a trip-confined API token cannot keep a day or a Playbook, even from the trip it names

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
