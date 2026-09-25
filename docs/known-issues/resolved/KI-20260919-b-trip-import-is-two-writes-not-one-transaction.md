### KI-2026-09-19-b — a trip import is two writes, so a failed cleanup can leave an empty trip — RESOLVED

- **Resolved 2026-09-25 (overnight KI sweep).** The pipeline operation the fix
  path named: `executeTripCreation(create, then, actorId)` in
  `apps/web/src/server/commands.ts` runs `CreateTrip` and the follow-up commands
  inside ONE `db.transaction`. It is built from the pipeline's existing parts:
  `loadAndAuthorize` + `decideTripCommand` + `appendAndProject` for the genesis,
  then `loadAndAuthorize` + the batch's decide loop (now shared as
  `decideInOrder`) + `appendAndProject` for the follow-up, against the stream the
  first half just wrote. So invariant 1 (append then project, one transaction)
  holds for each half. Any refusal after the genesis append is thrown as a
  private `RolledBack` and caught outside the transaction, because returning a
  failure from a `db.transaction` callback would commit the genesis. That makes
  a refusal and a throw the same outcome: no stream at all. There are two
  appends, so there are two batches and two history entries, the same history
  the two separate writes produced, and undo on a fresh import still undoes the
  import and not the creation. `public-api/commands.ts` gained `runCreation`.
  `POST /v1/trips/import` is one `runCreation` call, and the compensating
  `DeleteTrip` (both branches) is gone. `CreateTrip` is still not a
  `BatchableCommand`, and `packages/contracts/src` is untouched.
- **Reproduced before the fix** with a new `export.int.test.ts` case that
  switches on a pass-through mock of `applyTripEvents` so that projecting
  anything but `TripCreated` throws. That fails the import's batch AND the
  compensating `DeleteTrip`, which is this entry's residue. On the old route the
  uploader's list held the husk:
  `expected [ …(2) ] to deeply equal [ Array(1) ]` / `+ "df7c9437-…"` (the
  empty trip, live), and the stream check showed
  `+ "c382fffb-…"` as a new stream. After the fix it passes: a 500, and the
  actor's events and trip list are exactly what they were before the request.
- **Red-then-green on the new code.** (1) Returning the follow-up refusal
  instead of throwing it made `commands.int.test.ts` "rolls the creation back
  when the follow-up is refused" fail with
  `expected [ { globalSeq: 4, … } ] to deeply equal []`. (2) Committing the
  genesis and rethrowing the follow-up's error after the transaction (the old
  two-write shape) made both "leaves no trip at all…" tests
  (`export.int.test.ts`, `surface.int.test.ts`) fail on their stream assertion.
  Green again when each change was restored.
- **Checks:** `pnpm --filter web typecheck`, `pnpm --filter web lint`, and
  `node scripts/with-test-db.mjs vitest run src/server/public-api/
  src/server/commands.int.test.ts src/server/savedDays.int.test.ts
  src/server/cloneTrip.int.test.ts src/app/api/trips/route.int.test.ts
  src/app/api/trips/[tripId]/commands/ src/server/projections.int.test.ts`:
  17 files, 214 tests passed.
- **Decision (2026-09-25 overnight sweep):** use two appends (two batches) in
  the one transaction, not one combined batch. A single batch would make the
  creation and the import one history entry, and undo would then target the
  trip's genesis. The entry's other route, making `CreateTrip` batchable, was
  rejected for the reason the entry gives.
- **Left alone:** `apps/web/src/server/cloneTrip.ts` (`cloneTripState`) has the
  same `CreateTrip` → batch → compensating `DeleteTrip` shape and could move
  onto `executeTripCreation`. It is outside this entry's Area and is reported,
  not changed.

- **Severity:** correctness (a narrow window; the residue is one empty trip the uploader can delete, never a partial or corrupted one)
- **Area:** `apps/web/src/app/api/v1/trips/import/route.ts` (the `CreateTrip` → `runBatch` sequence), `apps/web/src/server/commands.ts` (`executeTripCommand` / `executeTripCommandBatch`, one transaction each), `packages/contracts/src/trip.ts` (`BatchableCommand`, which excludes `CreateTrip`)
- **Symptom:** `POST /v1/trips/import` commits `CreateTrip` in one transaction and the imported commands in a second. If the second does not land, the first already has. The endpoint compensates with a soft `DeleteTrip` on **both** the refusal and the thrown path, so the reachable outcome is a deleted trip the uploader never sees — but if that compensating delete ALSO fails, an empty, uploader-owned trip remains active.
- **Found by:** CodeRabbit, PR #191, with static analysis. Its report was right about the shape and identified one live defect inside it, now fixed: the thrown path skipped the cleanup entirely, so a dropped connection or pool timeout left exactly the husk the refusal branch existed to prevent.
- **What was fixed in #191, so nobody re-reports it:**
  - **Every command is built before the first write.** `bundleTripCommandGroups`
    is pure and was being called *after* `CreateTrip`; `addDays`'
    `toISOString()` throws on an out-of-range date, so a bad `startsInDays`
    threw with the trip already committed. Built first, that failure writes
    nothing.
  - **`startsInDays` is bounded** (±100 years) in the bundle schema, which turns
    the reachable version of that throw into a 400 the caller can act on.
  - **A thrown `runBatch` now compensates too**, not just a returned refusal.
  - Both are asserted in `export.int.test.ts`, including that the trip
    collection is unchanged either side of the refusal.
- **Why the remaining window is filed rather than closed:** closing it means one
  transaction that creates the trip AND applies the imported commands, and
  neither route to that is small.
  - **Make `CreateTrip` batchable.** It is deliberately not: a trip's genesis
    mints its own id and establishes its owner (`evolveTrip`), which is why
    `bundleTripCommandGroups`' own header says `CreateTrip` is not among the
    commands it returns. Changing that is a contracts change touching every
    batch path in the app.
  - **Add a pipeline operation** that does create-then-apply inside one
    `db.transaction`. That is a new seam on `apps/web/src/server/commands.ts`,
    which every write in the product goes through, added for one endpoint. The
    existing `alsoInSameTransaction` hook is explicitly *not* the place — its
    own comment forbids appending events or deciding a command inside it.
- **What bounds the damage today:** the residue is an EMPTY trip — no days, no
  stops, nothing imported — owned by the uploader, visible on their Home, and
  removable with the delete they already have. It requires the batch to fail
  *and* the compensating delete to fail in the same request. Nothing partial or
  half-imported can survive: the batch is one transaction and appends nothing on
  any rejection.
- **Fix path, if taken:** the pipeline operation, not the contracts change —
  `CreateTrip`'s exclusion from `BatchableCommand` is load-bearing. Whoever
  takes it should also ask whether `POST /v1/trips` followed by a client-driven
  batch has the same shape, since that is the pattern this endpoint copied.
- **Cross-reference:** `bundleTripCommandGroups` in
  `packages/fixtures/src/bundle/toCommands.ts` (why `CreateTrip` is not in the
  groups), ADR-028 (id remapping on a copy, the reason an import mints rather
  than derives).
- **First noted:** 2026-09-19, working CodeRabbit's review of PR #191.
