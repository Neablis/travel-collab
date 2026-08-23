# Test suite baseline (Phase 0, Tasks 0.1 and 0.4)

Input to `docs/plans/test-overhaul/phase-1-config.md` onward. Produced
2026-08-23 on branch `claude/test-overhaul-p0-p4-0nge1d`, in a 4-core
sandbox. Deleted at the end of Phase 7 once its durable half is in the
guidelines (per the phase-0 file's own instruction) — Phases 5-7 are not run
here, so this file stays through Phases 0-4.

Tasks 0.2 and 0.3 are covered by `docs/testing-inventory.md` (0.3, the
keep/cut inventory) and `scripts/classify-test-envs.mjs` (0.2, committed in
this same change — see "Task 0.2" below for why it wasn't already in the
tree despite being marked done). This file is Tasks 0.1 (honest three-run
timing) and 0.4 (domain coverage floor).

---

## Task 0.1 — Three-run timing protocol

Per KI-13, a single run on a loaded machine lies. All three runs below were
taken back-to-back with nothing else running in the foreground — `ps aux
--sort=-%cpu` recorded immediately before each run, reproduced below.
Nothing exceeded ~18% CPU (this session's own harness process; not a
competing workload) at any recorded point.

**Machine differs from the plan's reference sandbox — numbers, not
direction.** The plan's `docs/plans/2026-08-23-test-suite-overhaul.md` cites
a single-run reference of 43.1s wall / `environment 58.7s` / `tests 22.5s`
for the web unit suite. Three clean runs here consistently land at ~61-64s
wall / `environment ~88-92s` / `tests ~31-33s` — about 1.4-1.5x slower
across every phase of the run, not a one-off spike (the three runs agree
within a few percent of each other). This sandbox is simply slower hardware
than whatever produced the plan's reference numbers; it is not KI-13 noise
(all three runs are 95/95 green, and the CPU state is clean cf. the
`ps aux` output below).

**The finding the plan is built on holds, and is more pronounced here.** The
`environment`-to-`tests` ratio is 2.7-2.9x in these runs, versus 2.6x in the
plan's reference. Phase 1's environment split and Phase 5's file-count
reduction are, if anything, more valuable on this hardware, not less. No
change to the plan's approach follows from this — flagging it per the
kickoff's "IF THE NUMBERS DISAGREE" instruction, but proceeding as planned.

### `apps/web` unit suite — `pnpm --filter web exec vitest run -c vitest.unit.config.ts --reporter=dot`

`ps aux --sort=-%cpu | head -6` immediately before each run showed no
process above 17.5% CPU (this session's own bash/claude harness).

| Run | Files | Tests | Wall | transform | setup | collect | tests | environment | prepare |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 95 passed | 95 | 63.98s | 3.83s | 15.32s | 15.86s | 32.84s | 91.88s | 8.49s |
| 2 | 95 passed | 95 | 61.21s | 3.74s | 14.71s | 15.14s | 31.28s | 88.29s | 8.10s |
| 3 | 95 passed | 95 | 60.81s | 3.82s | 14.89s | 15.14s | 30.73s | 87.88s | 7.93s |

Zero flakes across all three runs (569 tests each run, all green). This is
the number Phase 1's "unit-suite `environment` time down ≥30%" target is
measured against: **environment baseline = 87.88-91.88s** (use the median,
88.29s, or re-measure post-Phase-1 against all three for a fair comparison).

### After Phase 1 (environment split + pool cap) — same command, three more clean runs

`ps aux --sort=-%cpu | head -6` showed no process above ~18% CPU (this
session's own harness) before any of the three runs, same as the before
numbers above — a fair comparison.

| Run | Files | Tests | Wall | transform | setup | collect | tests | environment | prepare |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 95 passed | 95 | 54.25s | 4.36s | 16.22s | 16.64s | 33.92s | 60.16s | 8.71s |
| 2 | 95 passed | 95 | 52.79s | 4.36s | 16.02s | 16.59s | 32.98s | 58.33s | 8.44s |
| 3 | 95 passed | 95 | 52.87s | 4.32s | 15.92s | 16.45s | 33.15s | 58.73s | 8.40s |

Zero flakes, 569/569 every run — same as before Phase 1 (no test content
changed). **`environment` median: 88.29s → 58.73s, a 33.5% reduction** —
past the ≥30% target. Wall time drops less dramatically (median 61.21s →
52.87s, ~14%) because `environment` construction overlaps with
`collect`/`tests` across the worker pool rather than serializing with it;
the plan's Task 1.1 probe (43.1s → 35.2s wall on the reference machine) saw
a similar wall/environment ratio.

### `packages/domain` — `pnpm --filter @tc/domain test`

| Run | Files | Tests | Wall | environment | tests |
|---|---|---|---|---|---|
| 1 | 22 passed | 129 | 3.79s | 5ms | 971ms |
| 2 | 22 passed | 129 | 3.78s | 5ms | 899ms |
| 3 | 22 passed | 129 | 3.61s | 5ms | 942ms |

Zero flakes. Confirms the plan's characterization: this suite is node-env,
fast, and not part of the problem.

### `packages/contracts` — `pnpm --filter @tc/contracts test`

| Run | Files | Tests | Wall |
|---|---|---|---|
| 1 | 7 passed | 43 | 1.30s |
| 2 | 7 passed | 43 | 1.28s |
| 3 | 7 passed | 43 | 1.32s |

Zero flakes.

### `packages/pages` — `pnpm --filter @tc/pages test`

| Run | Files | Tests | Wall |
|---|---|---|---|
| 1 | 7 passed | 32 | 1.34s |
| 2 | 7 passed | 32 | 1.27s |
| 3 | 7 passed | 32 | 1.31s |

(32, not the 26 `docs/testing-inventory.md`'s headline table cites — that
number predates this session; the raw logs behind this table agree with
each other and with a live re-run, so 32 is current and correct.)

Zero flakes.

### `test:int` and `test:e2e:ci-like` — not timed here

No Postgres was running in this sandbox at session start (this session
provisioned a local Postgres 16 cluster and pointed `apps/web/.env.local` at
it to make Phase 3/4 work possible at all — see the Phase 3/4 commits for
what that unlocked). Timing `test:int` and `test:e2e:ci-like` three times
each is a `pnpm build` plus a full Playwright run per iteration — expensive
enough that it competes with the actual Phase 1-4 work for this session's
time budget, and neither number gates Phase 1 (which only touches the unit
suite). Both are exercised for real, repeatedly, in Phases 3-4's own
verification (fixing KI-19/21/25 and KI-13) and in this handoff's exit
checklist (`test:e2e:ci-like` green 2x, `pnpm check` green 3x) — those runs
are the trustworthy numbers for this sandbox and are recorded in the PR
description rather than duplicated here.

---

## Task 0.2 — classifier script (recovering a gap in the "done" state)

`docs/plans/test-overhaul/phase-0-baseline.md` and `docs/testing-inventory.md`
both state Task 0.2 is done and record its answer (35 of 95 web unit files
are node-safe, with 4 named exceptions). The script that produces that
classification, `scripts/classify-test-envs.mjs`, was not actually present
in the tree at the branch point this session started from — only the
answer was recorded, not the tool. It's added in this same change (see the
Phase 0 commit) so Phase 1 (and any future re-classification) doesn't have
to reconstruct it from the inventory's prose.

**Re-measured here: 35 of 95 files are node-safe, exactly matching the
recorded number.** The classifier's first heuristic pass found 37
node-candidates plus one false positive it caught directly as jsdom
(`resolveDrop.test.ts`, correct — it references DOM APIs directly). Empirical
verification (`--environment=node` against the candidate set, via an
`include`-scoped config for exact path matching) initially surfaced a fourth
apparent failure, `pageTools.test.ts` — traced to the classifier's
DOM-reference regex matching a *comment* ("...before it ever reaches a
document. execute()...") as if it were `document.execute`, not real DOM
usage. Fixed by stripping comments before the heuristic scan (see the
script). After the fix: 38 heuristic candidates, of which exactly 3 fail
under `--environment=node` for the reasons the inventory already documented
(MSW resolving against `window.location` in
`apiClient.test.ts`/`pagesClient.test.ts`; TipTap needing a real `document`
in `MacroNodeExtension.test.ts`) — leaving **35 confirmed node-safe**, all
green. (One unrelated Vitest CLI quirk hit during verification, worth
recording so it isn't re-discovered: positional file-path filters match
case-insensitively as substrings, so passing `unscheduledRack.test.ts` as a
CLI filter also picks up the unrelated `UnscheduledRack.test.tsx` — a
filter-matching artifact, not a classification bug, avoided here by using
`include` in a scoped config instead of CLI positional args.)

---

## Task 0.4 — `packages/domain` coverage floor

`pnpm --filter @tc/domain exec vitest run --coverage` (`@vitest/coverage-v8`
already installed per the inventory). Machine state: clean, same as the
Task 0.1 runs.

| File | % Stmts | % Branch | % Funcs | % Lines |
|---|---|---|---|---|
| **All `src/trip/*.ts` + `src/*.ts`** | **97.09** | **93.3** | **98.14** | **97.09** |
| `src/index.ts` | 100 | 100 | 100 | 100 |
| `src/predict.ts` | 100 | 100 | 100 | 100 |
| `src/trip/conflicts.ts` | 100 | 98.5 | 100 | 100 |
| `src/trip/costs.ts` | 100 | 100 | 100 | 100 |
| `src/trip/dates.ts` | 100 | 100 | 100 | 100 |
| `src/trip/decide.ts` | 100 | 98.33 | 100 | 100 |
| `src/trip/detail.ts` | 100 | 100 | 100 | 100 |
| `src/trip/diff.ts` | 93.79 | 93.75 | 100 | 93.79 |
| `src/trip/equality.ts` | 96.15 | 96.29 | 100 | 96.15 |
| `src/trip/evolve.ts` | 100 | 95.45 | 100 | 100 |
| `src/trip/history.ts` | 89.1 | 72.97 | 90 | 89.1 |
| `src/trip/hydrate.ts` | 100 | 100 | 100 | 100 |
| `src/trip/project.ts` | 100 | 100 | 100 | 100 |
| `src/trip/state.ts` | 0/0 | 0/0 | 0/0 | 0/0 (types-only file, no executable statements — not a coverage gap) |

**This is the floor Phases 5-6 (not this session's phases, but recorded now
per Task 0.4) must not drop below**, measured, not asserted. `history.ts` at
89.1%/72.97% branch is the weakest file in the suite and worth a look before
any future pruning touches domain-adjacent tests, though nothing in Phases
0-4 touches `packages/domain` test content.

---

## Phase 1 — after-numbers

See "After Phase 1" above (environment split + pool cap): unit-suite
`environment` median 88.29s -> 58.73s, a 33.5% reduction, zero flakes,
569/569 every run. `isolate: false` was not re-tried (248-failure finding
already recorded in-config). Full `test:e2e:ci-like` verified green (15/15)
once with the new viewport/trace/retry config — see the Phase 1 commit.

## Phase 2 — `@tc/factories` and the isolation-strategy finding (Task 2.6)

`packages/factories` (`@tc/factories`) is a new workspace package: Fishery +
`@faker-js/faker` leaf factories typed against `@tc/contracts`
(`moneyFactory`, `locationFactory`, `activityFactory`, `tripDetailFactory`),
scenario builders (`scenarios.emptyTrip` / `threeDayTrip` / `overBudgetTrip`
/ `overlappingDay` / `unscheduledHeavy` / `mappedTrip` / `ungeocodedTrip`),
and `commandsFor(scenario, tripId)` — the event-sourced counterpart used by
e2e and (selectively — see below) `db:seed`. `tripDetailFactory` computes
its rollups by calling `@tc/domain`'s `rollupCosts` in `afterBuild`, never
re-deriving the arithmetic (ADR-020).

**`src/mocks/fixtures.ts` is deleted.** Its 24 callers' imports were changed
to `@tc/factories`, nothing else — `@tc/factories/legacy.ts` carries the old
fixtures' exact hardcoded output forward verbatim so this migration is
provably a no-op for every existing assertion (verified: 569/569 unit tests
still pass, unchanged). `e2e/helpers.ts`'s `createMappedTrip` is now a thin
wrapper over `commandsFor("mappedTrip", tripId, { dayCount })` — its output
had to be special-cased inside `commandsFor` to reproduce the old
hand-rolled shape exactly (title `"Stop on day N"`, a fixed 09:00-10:00
window, one distinct lat/lng per day), because `e2e/m10-unscheduled-
rack.spec.ts` asserts on that literal title string. Verified: `m10-
unscheduled-rack.spec.ts` and `m10-map-rail.spec.ts` both green post-change.

**`scripts/db-seed.mjs` is now `db-seed.ts`, typed against `TripCommand`,
but deliberately NOT routed through `commandsFor`.** Its three demo trips
(a 14-day, 68-stop Japan itinerary; Rochester; Portland) are specific,
narratively real content that no generic named scenario could capture
without flattening it into placeholder data — see ADR-020's Consequences
section for the full reasoning. The conversion uses Node's native
TypeScript stripping (stable on this repo's pinned Node 22), so it adds
zero new dependencies and zero build step; only `cmd()`'s parameter is
typed (`DistributiveOmit<TripCommand, "tripId">` — plain `Omit` over a
union collapses to the members' common fields, which breaks
excess-property-checking against a literal). Verified end-to-end against a
real `pnpm dev` server: seeds 3 trips, is idempotent on a second run
(clears its own `[Seed]`-prefixed trips first), `tsc --noEmit` catches
command-shape errors.

### Task 2.6 — a real correctness finding changed the plan's assumption

The plan's phase file frames Option 2 ("per-test trip ids, no truncation")
as "likely both faster and more correct" than the per-test `beforeEach`
truncation seven-plus `*.int.test.ts` files use. **That's true for 7 of the
11 files with truncation, but not for the other 4** — `projections.int.
test.ts`, `anchors.int.test.ts`, `commands.int.test.ts`, and `money.int.
test.ts` all call `rebuildProjections()`, which does a **global**
delete-and-rebuild of the entire `tripDetails`/`tripSummaries` tables
(`apps/web/src/server/projections.ts`), not scoped to one trip. Running
that concurrently with any other file mutating those tables — which is
every other int test file — would silently corrupt the other file's rows
mid-test. This is new information the plan's authors didn't have; the
honest, conservative call given it:

- **De-truncated the 7 files verified to only ever read/write their own
  `randomUUID()`-scoped tripId** (`duplicateTrip.int.test.ts`,
  `pages.int.test.ts`, `eventStore.int.test.ts`, and the four
  `route.int.test.ts` files under `app/api/trips/[tripId]/`), after
  auditing every one for an unscoped table read first (found one — already
  correctly scoped — no fixes needed).
- **Left the 4 `rebuildProjections`-calling files' truncation and comparison
  assertions untouched** — they need a consistent whole-table view for
  their own before/after rebuild comparisons regardless of the isolation
  question, and de-truncating them would only be safe alongside a real fix
  to `rebuildProjections` (making it optionally trip-scoped) or a
  multi-project Vitest split that serializes them from everything else —
  both real, larger changes than a test-suite-overhaul session should make
  without separate review. Flagging this for whoever picks up Phases 5+ or
  otherwise touches `test:int` isolation next.
- **Did not flip `fileParallelism`** (`apps/web/vitest.config.ts`) for the
  same reason — the 4 files still need to run serialized relative to
  everything else, and Vitest's file-parallelism knob is all-or-nothing
  per config.

**Measured, not assumed:** `pnpm --filter web exec vitest run` (int suite),
three clean runs before vs. after de-truncating the 7 safe files, same
machine-idle protocol:

| | Files | Tests | Wall | tests (execution only) |
|---|---|---|---|---|
| Before (all 11 truncating) | 12 | 79 | 12.09s / 13.4s / 12.1s | 2.02s |
| After (7 de-truncated) | 12 | 79 | 12.08s / 11.81s / 11.63s | 1.81s / 1.78s / 1.76s |

Zero flakes either way, same 79/79 pass count. **Wall time is essentially
unchanged** (`collect`, i.e. module transform/resolution, dominates at
~6.5s regardless — this suite was never actually slow) but `tests`
(execution) drops ~13%, a real, if modest, reduction in per-test DB
round-trips. Reporting this plainly rather than overstating it: Task 2.6's
premise (this is "wasteful ... and forces serial execution") is partially
right — the truncation was wasteful for 7 of 11 files — but the promised
speedup was never going to be large on this suite, because `test:int` was
already fast (11-13s) and dominated by collection, not the truncation
itself.

---

## Exit checklist (phase-0-baseline.md)

- [x] Three recorded runs per suite, with `environment`/`tests` breakdowns
      and the machine's CPU state at each (`test:int`/`test:e2e:ci-like`
      timing deferred — see the note above; both are exercised for real in
      Phases 3-4 and the final exit checklist instead of timed here).
- [x] `scripts/classify-test-envs.mjs` exists and its `node` set (35 files)
      runs green under `--environment=node`.
- [x] `docs/testing-baseline.md` (this file) holds Task 0.1's timings and
      Task 0.4's coverage floor. The full per-file keep/cut inventory lives
      in `docs/testing-inventory.md` (Task 0.3, already done before this
      session).
- [x] `packages/domain` coverage numbers recorded (above).
- [x] Committed. Nothing deleted, no test content changed.
