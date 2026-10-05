### KI-2026-10-05-f — `GET /api/trips` and `GET /v1/trips` return a lapsed owner's collaborators uncapped

- **Severity:** correctness, low reach. An API answer carries a role that the trip's own reads do
  not. No screen shows it today, because the Home cards read no role. Nothing becomes writable
  that should not be, because every write goes through `effectiveMembers`.
- **Area:** `apps/web/src/app/api/trips/route.ts` (`GET`, the Home grid) and
  `apps/web/src/app/api/v1/trips/route.ts` (`GET /v1/trips`). Both merge
  `grantedMembersByTrip` straight in. `apps/web/src/server/access/members.ts`: `effectiveMembers`
  applies `capGrantedOnLapse`, and the batched path has no equivalent.
- **Symptom / What happens:** when a trip's owner loses `trip.collaborators` (a lapse), the trip's
  own reads (`GET /api/trips/:id`, `/access`, the board) cap every granted member to `viewer`.
  `GET /api/trips` and `GET /v1/trips` do not. They return each member's stored role, so the
  two answers disagree about the same trip, and an API consumer reading `/v1/trips` sees roles
  the trip no longer grants. `/v1/trips` also does not overlay `travelling`. The
  contract treats a missing value as travelling (spec W1), so it agrees today only because of
  that default.
- **Why not fixed here:** this predates the travellers work. The batched read was built for the
  avatar stack, which shows no role. The fix is a batched `capGrantedOnLapse`: one
  `accountCan(owner, "trip.collaborators")` per distinct owner on the page, applied before
  `mergeMembers`, plus `travellingByTrip` on `/v1/trips`. That is out of T9's scope, which is
  e2e and docs.
- **Cross-reference:** ADR-045 (Entitlements answers `can`), M20 link 6 (the lapse cap), spec W21.
- **First noted:** 2026-10-05, travellers spec T9. No existing entry mentioned `capGranted`.
