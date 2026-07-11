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
- [ ] **Property tests (fast-check) green:** `rollupCosts` — costless trip totals
      `0`; day subtotals + unscheduled = trip total (partition); add-then-remove a
      cost is identity on all totals. `diffTripStates` round-trip still holds with
      cost/currency/budget present (undo/revert reproduces state exactly).
- [ ] **Golden rebuild:** dropping projections and rebuilding from a log with cost
      edits, a `TripCurrencySet`, and a `TripBudgetSet` reproduces identical
      state — the `over-budget` conflict included.
- [ ] **Purity/lint wall green:** `rollupCosts` and `budgetRule` do no I/O and
      read no wall clock; all money arithmetic is integer (no floats); UI imports
      only `@tc/contracts` + the typed client (never `@tc/domain`).
- [ ] **All M0/M1/M2/M3 e2e scripts still green; a new M4 happy-path e2e script
      added and green.**
- [ ] `docs/contracts/CHANGELOG.md` has an entry for `Money`, `activities[].cost`
      (+ event payload `.default(null)`), `SetTripCurrency`/`TripCurrencySet`,
      `SetTripBudget`/`TripBudgetSet`, and the `TripDetail` rollup fields.
- [ ] **M3 debt paid:** `UndoRedoControls` guarded in-flight; a single start-date
      control.
- [ ] Retro note appended to this file.

## Explicitly out of scope

Multi-currency and FX conversion (single-currency in M4; `Money` carries the code
for later); a currency-exponent map for non-2-decimal currencies (JPY/BHD); a
first-class `Flight` or `CostItem` entity, itemized/multiple costs per activity,
and an activity `kind`; per-cost currency pickers; cost categories/tags and
category rollups; print CSS, PDF, and share-link export (output is on-screen only
in M4); external calendar sync (M10); realtime (M7); trip rename/delete; styling
beyond functional defaults.
