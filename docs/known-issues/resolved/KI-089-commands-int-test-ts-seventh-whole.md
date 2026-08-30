### KI-89 — `commands.int.test.ts` is a seventh whole-table truncator, and its `events` count assertion is what a concurrent run breaks first — RESOLVED, both truncations dropped and every assertion scoped to the ids the test mints
- **Severity:** reliability (the KI-69 defect class, in the one file KI-69 did not list — and the file that demonstrates why the exclusive-resource policy is load-bearing)
- **Area:** `apps/web/src/server/commands.int.test.ts:38-41` (the `beforeEach`) and `:52-53`, `:55` (the whole-table assertions)
- **What happens:** the `describe("executeTripCommand")` block opens with `db.delete(tripDetails)`, `db.delete(tripSummaries)`, `db.delete(events)` — no `where` on any of them — and then asserts `expect(await db.select().from(events)).toHaveLength(1)` and `expect(await db.select().from(tripSummaries)).toHaveLength(1)`. Those are assertions about the entire database, and they hold only because the truncation immediately above them emptied it. KI-69 named six files; this is a seventh with the same shape, missed because its truncation sits inside a `describe` rather than at the top level.
- **Observed failing for real, 2026-08-29**, during the `pnpm check` at the end of the KI-69 work: `expected [ …(3) ] to deeply equal … - 1 + 3` at `commands.int.test.ts:53`. It did **not** reproduce — the file passed alone (19/19) and the full lane passed 25 files / 242 tests on the next three runs — which is the "different random subset each run" signature `.claude/protocol/ADAPTER.md` warns reads as flakiness and burns hours.
- **The cause was found rather than assumed, and it was not the code under test.** `ps aux` showed **two other agent worktrees running `pnpm test:int` at that moment** (`agent-a3eeb2ba9d7c27133`, `agent-a69c157d0bc06d926`), and the second one's `apps/web/.env.local` carries the byte-identical `DATABASE_URL=postgres://postgres:postgres@localhost:5433/travel`. A concurrent run appended events between this file's `delete` and its `select`, so the count was 3 instead of 1. This is precisely the corruption `ADAPTER.md` declares `postgres` an exclusive resource to prevent, caught in the act.
- **Why it is filed rather than fixed:** the KI-69 branch was scoped to the six files that entry names, and a seventh file is a new finding, not that scope. The fix is the same shape as the six: assert over `eq(events.tripId, tripId)` instead of the whole table, and drop the truncation.
- **The residue after that fix is the real question.** Even with every suite id-scoped, `rebuildProjections()` — called by `projections.int.test.ts` and `anchors.int.test.ts` — truncates and re-projects every trip's projections from the whole event log. So the integration lane cannot become genuinely concurrency-safe by scoping test data alone; that needs a schema or database per run, which is KI-69's second, untaken fix path and the thing that would let `test:int` stop being an exclusive resource.
- **Numbering:** filed as 79 on 2026-08-29, when three sibling branches each filed a *different* KI-77 and two a different KI-78. Renumbered to 89 on merge, `main` having reached KI-88. Nothing outside this file references it.
- **Cross-reference:** KI-69 (resolved — the same defect in six other files), `.claude/protocol/ADAPTER.md`'s exclusive-resources table.
- **Fix (2026-08-30):** the entry's own prescription, the KI-69 shape. Both truncating
  `beforeEach` blocks are gone — the one this entry names at `:38-41` and a **second,
  identical one at `:257-262` opening the `executeTripCommandBatch` describe**, which the
  entry did not name and which had to go too or the file would still be a whole-table
  truncator. Four assertions were re-scoped to the ids the test mints:
  `events` → `eq(events.streamId, tripId)` (the log's trip column is `stream_id`, not
  `trip_id`); `tripSummaries` → `eq(tripSummaries.tripId, tripId)` at both `:56` and the
  owner-role read; and the GOLDEN rebuild comparison, which compared *every* row of
  `trip_summaries` and `trip_details` before and after `rebuildProjections()`, now uses
  `inArray(..., [first.tripId, second.tripId])` with `toHaveLength(2)` on each side, so a
  filtered comparison of two empty arrays cannot pass vacuously — the same guard KI-69
  added to `projections`/`anchors`. No assertion was weakened or removed.
- **Reproduced deliberately rather than waited for.** The entry records the real 2026-08-29
  failure as non-reproducible on demand, so the mechanism was forced instead. Two things
  were shown. (1) *Blast radius:* the shared `travel` database held **20 events / 4 trip
  summaries / 4 trip details**; running the unmodified file alone (19/19 green) left it at
  **1 / 1 / 1** — every pre-existing row deleted by a passing test. (2) *The race itself:*
  a temporary harness ran this file's `beforeEach` verbatim, then had a **second, independent
  `pg.Pool`** — standing in for the concurrent worktree `ps aux` caught on 2026-08-29 —
  append one unrelated event between the truncate and the select. The assertion this entry
  names failed on demand, the same shape as the recorded failure:
  `AssertionError: expected [ { globalSeq: 1876, …(9) }, …(1) ] to have a length of 1 but got 2` / `- 1 + 2`,
  at the copy of `commands.int.test.ts:53`. A second describe in the same harness ran the
  identical test with the fix's shape (id-scoped, no truncation) against the *same*
  concurrent writer and passed — before and after, side by side in one run. The harness was
  deleted; it is not part of the commit.
- **Proven:** the fixed file green **3/3 consecutive runs** (19 tests) and the full lane
  green **3/3 consecutive runs** — `pnpm --filter web test:int` → **30 files, 334 tests
  passed** each time, against a database whose rows now accumulate instead of being wiped.
  Sentinel check, the claim this entry actually makes: 176 pre-existing event rows before
  the run, **263 after** — the run only ever added. Before the fix the same run left 1.
  Check subset (`minimal-check-subset`; one changed source file, `apps/web/**` → `web`,
  no `packages/contracts/src` change so no escalation): `pnpm --filter web typecheck`,
  `pnpm --filter web lint`, `pnpm --filter web test:int`. All green. Not run: e2e and the
  other packages' suites — nothing outside `apps/web` changed, and no non-test file changed
  at all.
- **Regression test added, in the file itself.** The first test now creates a decoy trip it
  never asserts about, then asserts its own scoped counts are 1 *and* that the decoy's rows
  are still there at the end. Reintroducing a whole-table count fails the first half
  (2 ≠ 1); reintroducing the truncation fails the second (the decoy is gone). The two
  halves catch the two halves of the defect.
- **The residue is confirmed, unfixed, and slightly worse than filed.** `rebuildProjections()`
  is still database-wide, and with the truncation gone it now re-projects every trip in the
  shared log on each of the three calls this file makes. That was observed directly: while
  the reproduction harness's deliberately malformed stray events were in the database,
  `rebuildProjections()` threw `ZodError … path: ["payload","createdBy"] … Required` from
  `projectTripSummaries`, failing two tests that are otherwise unrelated to those rows. Any
  foreign or legacy event row in the database is therefore inside the blast radius of every
  suite that rebuilds — `commands`, `projections` and `anchors`. Scoping test *data* cannot
  reach this; it needs a schema or database per run, KI-69's second, untaken fix path, and it
  is the reason `postgres` stays an exclusive resource in `.claude/protocol/ADAPTER.md`.
- **First noted:** 2026-08-29 (the KI-69 sweep, by its own `pnpm check`). **Resolved:** 2026-08-30.
