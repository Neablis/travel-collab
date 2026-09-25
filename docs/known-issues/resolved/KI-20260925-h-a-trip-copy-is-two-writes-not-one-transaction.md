### KI-2026-09-25-h — a trip copy is two writes, so a failed cleanup can leave an empty "(copy)" trip — RESOLVED

- **Resolved 2026-09-25 (overnight KI sweep).** `cloneFrom` now folds the
  copy's genesis state purely (`decideTripCommand(null, CreateTrip)` then
  `evolveTrip`, the same decide and evolve the pipeline runs), diffs it against
  the remapped source to get the commands, and hands `CreateTrip` plus those
  commands to `executeTripCreation`. The creation and the copied plan are one
  transaction, so a refusal or a throw after the genesis leaves no stream at
  all. Both compensating `DeleteTrip` calls are gone, and so are the imports of
  `executeTripCommand` / `executeTripCommandBatch` in `cloneTrip.ts`. History
  is unchanged: two appends, "created" then the copied plan. `eventToCommand`'s
  throw now happens before any write. The three callers (`duplicateTrip`,
  `cloneSharedTrip`, the demo's `cloneDemoTrip`) are unchanged, and the two
  routes (`trips/[tripId]/duplicate`, `shares/[token]/clone`) see the same
  results as before: a result on refusal, a throw on a thrown failure.
- **Red then green.** The reproduction above was run on the old code and
  failed as quoted (`+ "dc509e39-…"`, the husk's stream). After the fix the same
  test passes: `duplicateTrip` rejects with the injected error and the cloner's
  streams are exactly what they were before the call.
- **Checks:** `pnpm --filter web typecheck` (clean), `pnpm --filter web exec
  eslint src/server/cloneTrip.ts src/server/cloneTrip.int.test.ts` (clean),
  and `node scripts/with-test-db.mjs vitest run
  src/server/cloneTrip.int.test.ts src/server/demoTrip.int.test.ts
  src/server/commands.int.test.ts` from `apps/web`. Those are the int files
  covering every caller of `cloneFrom`, plus `executeTripCreation`'s own.
- **Decision (2026-09-25 overnight sweep):** fold the empty genesis state in
  memory instead of adding a hook to `executeTripCreation` that computes the
  follow-up from the created state. A callback into the transaction would widen
  the pipeline seam for one caller, and the pure fold gives the same state,
  because `hydrate(tripDetailFromState(s))` round-trips (its property test).

- **Severity:** correctness (a narrow window; the residue is one empty trip the cloner can delete, never a partial or corrupted one)
- **Area:** `apps/web/src/server/cloneTrip.ts` (`cloneFrom`, the `CreateTrip` → `executeTripCommandBatch` → compensating `DeleteTrip` sequence behind `duplicateTrip`, `cloneSharedTrip` and the demo's "Make this trip mine")
- **Symptom:** every trip copy commits `CreateTrip` in one transaction and the copied plan in a second. If the second does not land, the first already has. `cloneFrom` compensates with a soft `DeleteTrip` on both the refusal and the thrown path, so the usual outcome is a created-then-deleted stream the cloner never sees. If that compensating delete ALSO fails, a bare, live `"<name> (copy)"` (or, from `/demo`, a bare copy of the demo's name) stays in the cloner's list with none of the plan in it, and the request still reports an error.
- **Reproduction:** `cloneTrip.int.test.ts`, "a clone that fails after its trip was created", with a switchable pass-through mock of `applyTripEvents` that throws when projecting any event other than `TripCreated`. That fails the batch and the compensating `DeleteTrip` together. On the current code the cloner's streams grow by one:
  `AssertionError: expected [ …(2) ] to deeply equal [ Array(1) ]` / `+ "dc509e39-…"`.
- **Why it was not fixed when it was written:** the file's own comment said the atomic version "means threading an outer transaction through executeTripCommand/executeTripCommandBatch, which is a change to the command pipeline itself". That operation now exists: `executeTripCreation(create, then, actorId)` in `apps/web/src/server/commands.ts`, added to close KI-2026-09-19-b (import) and KI-2026-09-19-f (dated create).
- **Fix path:** build the copy's commands before any write (fold the genesis purely with `decideTripCommand` + `evolveTrip`, which is what the pipeline runs on `CreateTrip`), then hand `CreateTrip` and the commands to `executeTripCreation` and delete the compensation.
- **Cross-reference:** KI-2026-09-19-b (same shape in `POST /v1/trips/import`, whose resolved entry reported this one under "Left alone"); ADR-028 (cloning, id remap, lineage).
- **First noted:** 2026-09-25, by the KI-2026-09-19-b fixer in the overnight KI sweep.
