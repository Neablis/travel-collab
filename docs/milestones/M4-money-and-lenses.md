# M4 — Money & lenses

**Goal:** give every activity an optional **cost**, roll costs up (derived, not
stored) to per-day subtotals and a **trip total**, add a settable **trip
currency** and **budget** with an **over-budget** soft conflict, and add three
read-only **output lenses** over the same projection — **itinerary**, **daily
overview**, **full-trip overview**. The second milestone to build breadth on the
M2 substrate: every new behavior flows through the one command pipeline and is
undo/revert-correct via the existing compensating-events machinery (ADR-005).

Design record: `docs/specs/2026-07-10-M4-money-and-lenses-design.md` ·
Mechanism decisions: `docs/architecture/ADR-008` (money representation &
single-currency scope), `docs/architecture/ADR-009` (cost as an activity field;
flights are activities) · Plan: `docs/plans/2026-07-10-M4-money-and-lenses.md`

## Scope

- **Money value object.** `Money = { amountMinor:int≥0, currency:ISO-4217 }` —
  integer minor units, never floats (ADR-008). Used by costs, the budget, and the
  rollups.
- **Cost on activities (no new events).** Activities gain `cost: Money | null`
  riding the existing `AddActivity`/`UpdateActivity` commands and
  `ActivityAdded/Updated` events — the M3 anchor pattern, so cost is
  undo/revert-correct for free (ADR-009). Event payloads use
  `cost: Money.nullable().default(null)` so previously-stored events still parse.
- **Flights & day/trip costs are activities.** No first-class `Flight`/`CostItem`
  entity and no activity `kind`: a flight is an activity with a cost; a
  trip-level cost is a backlog activity with a cost (ADR-009).
- **Rollups derived, not stored.** A pure `rollupCosts(state)` (mirrors
  `deriveDayDates`) computes per-day subtotals, the unscheduled subtotal, and the
  trip total; the projection exposes them on `TripDetail`
  (`days[].costSubtotal`, `unscheduledCostSubtotal`, `tripCostTotal`,
  `budgetRemaining`). The lenses stay dumb readers.
- **Currency & budget as trip attributes.** New `SetTripCurrency` /
  `TripCurrencySet` and `SetTripBudget` / `TripBudgetSet` events (modeled on
  `SetTripStartDate`); `state.currency` defaults to `"USD"`, `state.budget`
  defaults to `null`. Diffable and undo/revert-correct with no new machinery.
- **Over-budget conflict.** A pure `budgetRule` raises one `warn`
  (`kind: "over-budget"`, `subjects: [tripId]`, content-derived id) when the trip
  total exceeds the budget. Needs no injected `ctx` (budget and total are both in
  state); dismissable via the existing M2 `DismissConflict`.
- **Three lenses** over the same `TripDetail`: itinerary, daily overview,
  full-trip overview — foregrounding the money rollups. Built against
  contract-derived MSW mocks first, then wired. **On-screen only** (no print CSS,
  no export).
- **M3 debt paydown** (folded in): guard `UndoRedoControls` while a command is in
  flight; consolidate the two start-date controls into one.

## Design decisions recorded at planning (2026-07-10)

| Decision | Rationale |
|---|---|
| Money = integer minor units + ISO-4217 code; never floats | Exact/deterministic under the golden rebuild; self-describing; multi-currency-shaped for later (ADR-008) |
| Single currency per trip; conversion deferred; `Money` still carries `currency` | Avoids the FX-rate/which-rate problem before there's demand; enabling multi-currency later is additive, zero data migration (ADR-008) |
| Cost is a snapshot field on activities riding existing events | Undo/revert-correct for free; zero new activity events — the M3 anchor precedent (ADR-009) |
| Flights & day/trip costs are activities; no first-class entity | Smallest surface that satisfies the gate; flight-specific structure is YAGNI until a lens needs it (ADR-009) |
| Rollups derived-not-stored, exposed on `TripDetail` | No redundant state/events; can't drift from the log — the `deriveDayDates` precedent |
| Budget + over-budget `warn`; pure rule, no `ctx` | Completes the money milestone and exercises the conflict engine; both inputs are in state so no ADR-006 extension |
| Three lenses are read-only over the same projection; on-screen only | Matches the foundation's "alternate lenses"; export/print is its own scope, deferred |
| M3 debt folded into M4 as one cleanup task | M4 touches the same lens chrome & start-date surface; cheap to do here |

## Exit gate — all must be true

- [ ] **Demo on the deployed Vercel URL:** set the trip currency → add costs to a
      few activities (including a "flight" activity and an unscheduled trip-level
      cost) → per-day subtotals and the trip total appear across all three lenses;
      set a **budget below the total** → an `over-budget` `warn` conflict appears
      in the existing banner; raise the budget (or remove a cost) → it clears;
      **dismiss** the over-budget warn → it stays dismissed; **undo** a cost edit
      → the totals revert.
      (Pending: requires a Vercel deploy — human step. Manually verified locally
      via the browser preview and the e2e script instead; see retro.)
- [x] **Property tests (fast-check) green:** `rollupCosts` — costless trip totals
      `0`; day subtotals + unscheduled = trip total (partition); add-then-remove a
      cost is identity on all totals. `diffTripStates` round-trip still holds with
      cost/currency/budget present (undo/revert reproduces state exactly).
- [x] **Golden rebuild:** dropping projections and rebuilding from a log with cost
      edits, a `TripCurrencySet`, and a `TripBudgetSet` reproduces identical
      state — the `over-budget` conflict included.
- [x] **Purity/lint wall green:** `rollupCosts` and `budgetRule` do no I/O and
      read no wall clock; all money arithmetic is integer (no floats); UI imports
      only `@tc/contracts` + the typed client (never `@tc/domain`).
- [x] **All M0/M1/M2/M3 e2e scripts still green; a new M4 happy-path e2e script
      added and green.**
- [x] `docs/contracts/CHANGELOG.md` has an entry for `Money`, `activities[].cost`
      (+ event payload `.default(null)`), `SetTripCurrency`/`TripCurrencySet`,
      `SetTripBudget`/`TripBudgetSet`, and the `TripDetail` rollup fields.
- [x] **M3 debt paid:** `UndoRedoControls` guarded in-flight; a single start-date
      control.
- [x] Retro note appended to this file.

## Explicitly out of scope

Multi-currency and FX conversion (single-currency in M4; `Money` carries the code
for later); a currency-exponent map for non-2-decimal currencies (JPY/BHD); a
first-class `Flight` or `CostItem` entity, itemized/multiple costs per activity,
and an activity `kind`; per-cost currency pickers; cost categories/tags and
category rollups; print CSS, PDF, and share-link export (output is on-screen only
in M4); external calendar sync (M10); realtime (M7); trip rename/delete; styling
beyond functional defaults.

## Retro (2026-07-11)

Implemented via subagent-driven development: Task 1 (contracts) landed first
and gated two parallel workstreams (Domain D1-D3, UI U1-U6), each run in its
own git worktree per AGENTS.md's workstream-isolation rule. Integration
(I1-I4) ran as one coordinating session against a real Postgres instance.

**What we learned:**

- **The plan's file-list scoping missed a category of gap.** No task's brief
  named `apps/web/src/components/lenses/calendarData.ts`,
  `calendarData.test.ts`, `mapData.test.ts`, `timelineData.test.ts`,
  `board.test.tsx`, or `TripBoardScreen.test.tsx` — files nobody's task
  touched but whose `TripDetail`/`ActivityView` literals still needed the new
  M4 fields once both tracks merged. The documented "red window" correctly
  anticipated this for the files each task *did* touch, but the merge step
  itself surfaced a second wave: `pnpm typecheck` still failed after Track D
  and Track U were both merged, and one file (`calendarData.ts`, production
  code, not a test) had a real type-predicate bug (missing the new
  `costSubtotal` field), not just missing literals. Fixed as an explicit
  integration commit rather than folding it silently into another task —
  worth calling out for future milestones: **budget an explicit
  "close the merged-tree red window" step in the plan**, distinct from each
  track's own red-window scoping, rather than assuming the union of tasks'
  file lists is complete.
- **U6's control consolidation had a live regression its own worktree-scoped
  typecheck didn't catch.** Removing `TripBoardScreen`'s inline
  `StartDateControl` in favor of the canonical `TripDateControl` dropped a
  `CreateTrip`-excluding type guard the old code had (via a runtime
  `if (command.type !== "CreateTrip")` check baked into `CalendarLens`'s
  removed mount). This was invisible until the merged tree's full
  `pnpm typecheck` ran, because `TripDateControl.onCommand` widens to the
  full `TripCommand` union while `dispatch` only accepts
  `Exclude<TripCommand, {type:"CreateTrip"}>` — a mismatch that only exists
  once both changes coexist. Fixed by restoring the same guard on the new
  mount site. `TripMoneySettings` (added in I2) needed the identical guard
  from the start, now applied consistently.
- **`MoneyInput` was uncontrolled (`defaultValue`), so it silently ignored
  external state changes** — undo, redo, or any refetch that changed the
  bound `Money` value never updated what was on screen, even though the
  underlying rollups and conflict text updated correctly. Only surfaced
  writing the e2e script's undo assertion; no unit test exercised a prop
  change after mount. Fixed by making it a genuinely controlled input with a
  `useEffect` that re-syncs only when the external value actually changes
  (not on every render), verified not to clobber in-progress typing, and
  added direct unit coverage for both behaviors as a follow-up.
- **Two dev-environment footguns cost real time and warrant a guideline
  update:** (1) `drizzle-kit migrate` and `vitest run` (`test:int`) do **not**
  auto-load `.env.local` — only the Next.js dev server does — so both
  silently fell back to `config.ts`'s default port (5433) instead of an
  explicitly configured isolated Postgres container, until `DATABASE_URL`/
  `POSTGRES_PORT` were exported into the shell directly. This one is a real
  risk on a machine with multiple milestone worktrees' Postgres containers
  running concurrently: the fallback port can point at a *different*
  worktree's shared dev database, whose `events`/`trip_summaries`/
  `trip_details` tables the integration suite's `beforeEach` truncates. (2)
  The `.claude/launch.json` `"web"` preview config pointed at an old
  milestone's worktree (`m0-walking-skeleton`), so `preview_start(name="web")`
  silently launched the wrong codebase entirely rather than erroring — added
  a distinctly-named `"m4-web"` entry instead of reusing the generic name.
  Recommend a docs/guidelines note: **always export `DATABASE_URL`/
  `POSTGRES_PORT` explicitly for `db:migrate`/`test:int` in a worktree, don't
  rely on `.env.local`,** and prefer worktree-specific `launch.json` entry
  names over a shared `"web"`.
- **Trip-name prefixes across e2e specs aren't centrally tracked.** The new
  M4 spec's `"Lisbon ${Date.now()}"` collided with M1's, causing an
  intermittent parallel-worker failure (same millisecond, ambiguous link).
  Renamed to `"Porto"`; a shared prefix registry (even just a comment listing
  taken names) would prevent this recurring.

**What changed from the plan:** nothing structural — contracts, domain
mechanics (D1-D3), UI components (U2-U6), and the money integration test
(I1) all matched the plan's given code closely, verified during task review.
The additions above were all either (a) integration-phase cleanup work the
plan's dependency graph correctly placed after both tracks converge, just
under-specified in scope, or (b) a genuine bug the plan's given `MoneyInput`
code carried (also flagged separately during review: it accepts negative
input past the `min="0"` HTML attribute, which the contract's server-side
`nonnegative()` check safely rejects but with an opaque error rather than
inline validation — deferred as UI polish, not fixed this milestone).

**Debt parked for M5:** the negative-money-input UX gap above; the trip
budget `MoneyInput` and an open `ActivityEditor`'s cost `MoneyInput` share an
identical accessible name (`cost (${currency})`) when both are visible,
which is a real accessibility/testability ambiguity (found manually while
verifying I2 in the browser) — worth a distinct `aria-label` per context; the
unscheduled section in `ItineraryLens` has no subtotal shown despite
`unscheduledCostSubtotal` being available (noted in the U3 review as a minor
inconsistency with the day sections' subtotals).
