# ADR-065: Who is travelling is Access data, counted at read time

**Status:** **Accepted — 2026-10-05.** Mitchell approved the design (D1–D11 as recommended).
This ADR records the boundary.
**Deciders:** Mitchell (product); Claude — drafted
Related: **ADR-060** (a price is per person; this **amends its decision 2**), **ADR-003** (the
history substrate is scoped to planning), **ADR-026** (membership is Access CRUD), **ADR-064**
(the `suggestionsRev` precedent for D11). Spec:
`docs/specs/2026-10-05-travellers-and-people-panel-design.md`. Source: the candidate *"Choose who
on a trip is actually travelling"*.

## Context

ADR-060 decision 2 made a stop nobody picked cost `price × members`, with "every member counts,
viewers included". That made every member a traveller. When #314's owner invited a suggester to
advise, every per-person total on the trip doubled, from $9,130 to $18,260. The only way out was to
pick *Who is in* on every stop the advisor was not part of.

Membership is not in the planning log: the owner is `TripCreated.createdBy`, and everyone else is a
`trip_memberships` row (ADR-026). ADR-060 decision 4 already handles that by computing totals when
the trip is read. The question was where "is this person coming" should live, and what should
count it.

## Decision

1. **Travelling is a per-person Access attribute, not an event** (D1). It is stored in its own CRUD
   table, `trip_travellers(trip_id, user_id, travelling, updated_by, updated_at)`. A missing row
   means travelling. It is not on `trip_memberships`, because the owner has no row there. It is
   not on `trip_summaries`, because that is a projection, so a rebuild would have to equal it. Putting it in the
   planning log would mean the log knows who is invited. That is the half-evented boundary smell
   that invariant 1 and the module map forbid. The cost of this choice is that History does not
   say "Sam is no longer travelling".
2. **Totals count travellers, at read time, in the same overlay as the members** (D1).
   `overlayMembers` recosts the detail for `travellerIds(members)`, not `members.length`. Every
   other consumer that prices or counts heads does the same: the decider's context, shares, the
   web helpers, notebook widgets and the assistant's reads. The stored projection still totals
   for the log's own members, so rebuild equals stored (invariant 2) and no event payload
   changes.
3. **Everyone already on a trip is travelling** (D2). There is no backfill, so no live total moves
   on deploy. A new invite carries the choice, preset by role (D3). Accepting the invite writes it.
4. **The owner may set it for anyone, including themselves. Each member may set it for
   themselves, and nobody else may** (D4). It is one rule on the AccessPolicy seam,
   `maySetTravelling`. The owner may be not travelling (D5), and totals then floor at one person.
5. **An explicit *Who is in* pick stands** (D6). If someone picked on a stop is later marked not
   travelling, they still count on that stop. Removing the pick would rewrite planning state from
   an Access change. Travelling only decides who "nobody picked" means.
6. **Anyone on the trip may be Booked by** (D7), travelling or not. A parent or an office can pay.
   When nobody is picked, balances still split only across travellers.
7. **Access changes reach other readers on the events poll** (D11). The page carries an opaque
   `accessRev`, the way ADR-064 added `suggestionsRev`. It is a per-trip counter bumped in the
   same transaction as every Access write (spec W5). When it moves, clients re-read access and
   the detail. Without it, a toggle would change totals only for the person who made it.

ADR-060 decision 2 now reads "empty = all *travellers*".

## Consequences

- **A non-traveller costs nothing unless they are picked.** That fixes #314's case without a
  fix-up step. It also means that if you mark yourself not travelling, the trip gets cheaper for
  everyone else on screen.
- **History is silent about who is coming.** That is the price of keeping it out of the log. The
  People section is where to see it.
- **Zero travellers is priced for one person, but balances charge nobody** (spec W4). The two
  disagree in a state reachable only by marking everyone, owner included, not travelling.
  KI-2026-10-05-e.
- **The public API's totals mean something different** (1.6.0, `docs/contracts/CHANGELOG.md`):
  `cost × headcount` now counts travellers, and `GET /v1/trips/:id/members` returns `travelling`.
- **The first `accessRev` a client sees is a baseline** (spec W19). An Access write made before
  that first poll is never re-read by that page. KI-2026-10-05-g. **Resolved the same day** (spec
  W22): `TripAccess` carries `accessRev`, read before its members, and that is now the baseline.
  The first poll is the baseline only when the read carried none.
