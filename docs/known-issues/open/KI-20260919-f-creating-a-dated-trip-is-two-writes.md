### KI-2026-09-19-f — creating a trip with dates is two writes, so a failure between them leaves a soft-deleted trip

- **Severity:** correctness (a narrow window; the residue is a soft-deleted trip the caller never sees, or — if the compensation also fails — one empty, undated, caller-owned trip)
- **Area:** `apps/web/src/app/api/v1/trips/route.ts` (`POST`: `CreateTrip` → `SetTripDates`/`SetTripStartDate`), `apps/web/src/server/commands.ts` (`executeTripCommand`, one transaction per command), `packages/contracts/src/trip.ts` (`CreateTrip`, `TripCreatedV1`, `BatchableCommand`)
- **Symptom:** `POST /v1/trips` with `startDate` (and optionally `endDate`) commits `CreateTrip` in one transaction and the dates command in a second. If the second does not land, the first already has. The route soft-deletes the trip on both the refusal and the thrown path — the same compensation `trips/import` and `server/cloneTrip.ts` use — so the reachable outcome is a deleted trip, and a history in which a trip was created and deleted.
- **Found by:** designed in, 2026-09-19. An external agent asked for dates on create; Mitchell chose this ("option A") over a contract change, knowing the window.
- **What bounds the damage today:**
  - **Every refusal the caller can cause is decided before the first write.**
    The dates command is run through the real decider (`decideTripCommand`)
    against the trip exactly as `CreateTrip` would leave it, and the calendar
    check runs before that, so an end date with no start, an end before the
    start, or `2027-02-30` is a 400 that writes nothing
    (`surface.int.test.ts`, "writes nothing at all").
  - What is left is failure the caller did not send: a lost concurrency race
    (unreachable in practice — the trip id was minted by this request and no
    one else knows it) or infrastructure. The compensation is asserted in
    `surface.int.test.ts` by injecting that failure.
- **The proper fix (option B, a contract change):** optional `startDate` /
  `endDate` on `CreateTrip`, plus the ids of the days the range needs (the
  domain is pure and cannot mint them — the reason `SetTripDates` carries
  `newDayIds`), carried into `TripCreated`'s payload so genesis is one event
  batch in one transaction. Additive with `.default(null)` / `.default([])`, as
  `forkedFrom` was, so no event version bump. It would touch:
  - `packages/contracts/src/trip.ts` — `CreateTrip`, `TripCreatedV1`
  - `packages/domain/src/trip/decide.ts` — `decideCreateTrip` (validate dates the way `SetTripDates` does; emit `DayAdded` for the new ids, or carry them on `TripCreated`)
  - `packages/domain/src/trip/evolve.ts` — the `TripCreated` case
  - `packages/domain/src/trip/history.ts` — the creation entry's description
  - `apps/web/src/server/projections.ts` — the `TripCreated` case, if the summary row carries anything date-derived
  - `apps/web/src/app/api/v1/trips/route.ts` — collapse back to one `runCommand`
  - `docs/contracts/CHANGELOG.md`, a contracts round-trip test, a domain test for the new genesis, and the demo fixture per AGENTS.md ("if the change adds a contract field, the demo fixture exercises it") with `pnpm seed:verify`
  - Being under `packages/contracts/src`, it is a full `pnpm check`, not a scoped one.
- **Not the fix:** making `CreateTrip` batchable. KI-2026-09-19-b explains why its exclusion from `BatchableCommand` is load-bearing, and `assistant.ts` derives the assistant's command vocabulary from that union — widening it would let the assistant propose creating trips.
- **Cross-reference:** KI-2026-09-19-b (the same two-write shape in `POST /v1/trips/import`, whose own entry asks whether `POST /v1/trips` has it too — it now does); `apps/web/src/server/cloneTrip.ts` (the compensating `DeleteTrip` both copy, and its comment on why one transaction means changing the pipeline).
- **First noted:** 2026-09-19, adding dates to `POST /v1/trips`.
