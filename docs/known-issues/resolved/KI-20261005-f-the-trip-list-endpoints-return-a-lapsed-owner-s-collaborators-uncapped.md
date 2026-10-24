### KI-2026-10-05-f — `GET /api/trips` and `GET /v1/trips` return a lapsed owner's collaborators uncapped — RESOLVED

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
- **Resolved, 2026-10-24 (KI sweep):** the `travelling` half was already closed:
  `withEffectiveMembersByTrip`, which both lists now share, overlays `travellingByTrip`. The cap
  was still missing, and is now `capGrantedOnLapseByTrip` in `members.ts`, applied before
  `mergeMembers`: every owner of a trip on the page that has someone granted is asked about in
  one `entitlementsForMany` read (three statements however many owners), and a list of solo
  trips asks nothing, as `capGrantedOnLapse` asks nothing. Proven by a new test in
  `collaborationGate.int.test.ts` (*caps them in the trip lists too, per owner*): a lapsed and a
  paid owner each share a trip with one editor. Before the change it failed with
  `expected 'editor' to be 'viewer'` on the list, while the trip's own read said `viewer`; after
  it, the list and `GET /api/trips` both say `viewer` for the lapsed trip and `editor` for the paid
  one. Forcing every trip capped turns it red with `expected 'viewer' to be 'editor'`. In
  `app/api/trips/route.int.test.ts`, three tests had seeded an unentitled owner and asserted their
  invited editors as `editor` in the list, which is the disagreement this entry describes. Their
  owners are now premium, so every assertion stands unchanged. The statement-count test moves from
  7 to 10, still the same for five trips and six.
