# M4 design — Money & lenses

**Date:** 2026-07-10 · **Status:** Approved by Mitchell (decisions 1–7 below)
**Companions:** ADR-008 (money representation & single-currency scope), ADR-009
(cost as an activity snapshot field; flights are activities), foundation design
§4/§6, ADR-005 (compensating events), ADR-006 (conflict evaluation context),
`docs/milestones/M4-money-and-lenses.md`, `AGENTS.md`

## 1. Goal

Give every activity an optional **cost**, roll costs up to per-day subtotals and
a trip total, add a settable **trip currency** and **budget** with an
**over-budget** soft conflict, and add three read-only **output lenses** over the
same projection: **itinerary**, **daily overview**, **full-trip overview**. This
is the second milestone (after M3) to build breadth on the M2 substrate — every
new behavior (cost edits, currency/budget changes) flows through the same one
command pipeline and is undo/revert-correct for free via ADR-005.

Nothing here weakens an invariant: the domain core stays pure (money is integer
arithmetic — §4), rollups are **derived, not stored** (the M3 `days[].date`
precedent), conflicts stay data (§4), and the lenses are dumb readers over the
existing `TripDetail`. M4 adds **no new I/O** and **no DB migration** — costs,
currency, and budget ride the existing `events`/`trip_details` jsonb.

## 2. Decision log (all explicitly made by Mitchell, 2026-07-10)

| # | Decision | Alternatives rejected |
|---|---|---|
| 1 | **Money is integer minor units + an ISO-4217 currency.** `Money = { amountMinor:int≥0, currency }`. Never a float | decimals/floats (rounding drift on a stored projection); a bare number (loses the currency, un-forward-compatible) |
| 2 | **Single currency per trip; conversion deferred.** A settable trip currency (`SetTripCurrency`, default `USD`); every cost is entered in it. `Money` still carries a `currency` so multi-currency is a later additive step | multi-currency + an injected FX oracle now (rate-sourcing + which-rate-when questions before there's demand); no trip currency at all (weakens the single "trip total") |
| 3 | **Cost is a snapshot field on activities** — `cost: Money \| null` riding the existing `ActivityAdded/Updated` full-field events (the M3 anchor precedent) — undo/revert-correct for free, **zero new activity events** | a first-class `CostItem` entity with its own Add/Update/Remove events + diff/equality branches (more surface than the field, no independent lifecycle in M4) |
| 4 | **Flights + day/trip-level costs are ordinary activities**, not first-class entities. A flight is an activity carrying a cost; a trip-level cost (insurance) is a backlog activity; the rollup sums per day + backlog → trip total | a first-class `Flight` entity / flight `kind` (flight-specific structure — airports, flight numbers — is YAGNI until a lens needs it) |
| 5 | **Rollups are derived-not-stored** and exposed on `TripDetail` (per-day subtotal, unscheduled subtotal, trip total, budget remaining) — a pure `rollupCosts(state)`, the exact `deriveDayDates` precedent | store totals as their own state/events (redundant, needs its own writes, drifts from the log) |
| 6 | **Budget + an over-budget `warn` conflict.** `budget: Money \| null` (`SetTripBudget`); a pure `budgetRule` raises one `warn` when trip total exceeds budget. Dismissible via the existing M2 machinery | no budget in M4 (leaves the money milestone feeling half-done; the conflict engine gets no new exercise) |
| 7 | **Three read-only lenses over the same `TripDetail`; on-screen only.** Itinerary / daily overview / full-trip overview — the M3 lens pattern (MSW-mocked first, then wired). No print CSS, no PDF/export pipeline in M4 | export/PDF/share-link (its own pipeline + decisions); print CSS (deferred with export) |

## 3. Money: representation & single-currency scope (ADR-008)

`Money` is the one money value object, used by every cost, the budget, and the
rollups:

```ts
export const Money = z.object({
  amountMinor: z.number().int().nonnegative(), // smallest currency unit (e.g. cents)
  currency: z.string().regex(/^[A-Z]{3}$/),    // ISO-4217, uppercase
});
export type Money = z.infer<typeof Money>;
```

- **Integer minor units, never floats.** All arithmetic (rollups, budget deltas)
  is integer addition/subtraction — deterministic on a stored projection, no
  rounding drift. `amountMinor` is the count of the currency's smallest unit
  (cents for USD/EUR; whole yen for JPY).
- **One currency per trip.** `TripState.currency` (a plain `string`) defaults to
  `"USD"` — the default is applied in `evolve` at `TripCreated`, not stored in
  the event — and is changed by `SetTripCurrency`. Every cost the UI emits is in
  the trip currency; the rollup treats all `amountMinor` as that currency and
  sums them directly.
- **`Money` still carries `currency`** even though M4 is single-currency: it
  keeps every stored cost self-describing, so enabling multi-currency later is
  additive (add an injected FX oracle — the ADR-006 shape — and a per-cost
  currency picker) with no reshaping of stored data.
- **Money input (UI) assumes a 2-decimal exponent in M4** (USD/EUR/GBP…): the
  editor converts a typed `"42.50"` ↔ `4250` minor units. A currency-exponent
  map (JPY = 0, BHD = 3) is a **noted follow-up**, not M4 scope — the stored
  shape already supports it.

## 4. Costs on activities (ADR-009)

An activity gains one optional cost. It rides the **existing** activity commands
and events exactly as M3 anchors did — no new event type:

- **Command side.** `AddActivity` gains `cost: Money.optional()` (omitted = no
  cost); `UpdateActivity` gains `cost: Money.nullable().optional()` (omitted =
  unchanged, `null` = cleared) — the same omitted/null contract as `location`
  and `notes`.
- **Event side.** `ActivityAddedV1` and `ActivityUpdatedV1` payloads each gain
  `cost: Money.nullable().default(null)`. The `.default(null)` makes
  previously-stored events (which lack the field) parse as `null`, so
  `TripEvent.parse` still accepts every prior event (non-breaking,
  upcasting-lite — the M3 `.default([])` guarantee).
- **Snapshot semantics unchanged.** `ActivityUpdatedV1` remains "a snapshot of
  the full field set after the update," so `cost` is diffable/undoable with no
  new diff logic — **provided `equality.ts` compares `cost`** (which also makes a
  same-cost update a rejected `no-op`). This is the one fill-in the diff/equality
  code needs; it is not a redesign.

**Flights and day/trip-level costs are activities** (decision 4). A flight is an
activity titled "Flight to Rome" carrying a cost; a whole-trip cost (travel
insurance, a rental car) is a backlog activity carrying a cost. No first-class
`Flight`/`CostItem` entity and no activity `kind` in M4. Consequence: a cost that
is not naturally one activity (a hotel spanning five nights) is modeled as the
planner chooses — one trip-level activity, or one per night — a **known
simplification** the rollup mechanism does not need to resolve.

## 5. Rollups: derived, exposed on `TripDetail`

A pure `rollupCosts(state)` in `packages/domain` (mirrors `dates.ts`) is the
single place cost totals are computed:

```ts
export function rollupCosts(state: TripState): {
  dayCostSubtotals: number[];     // aligned to state.days, minor units
  unscheduledCostSubtotal: number; // sum of backlog activity costs
  tripCostTotal: number;           // sum(dayCostSubtotals) + unscheduledCostSubtotal
};
```

- Each subtotal is the sum of `activity.cost?.amountMinor ?? 0` over the
  activities in that bucket. An activity with no cost contributes `0`. All values
  are in the trip currency.
- The projection populates `TripDetail` from this — no read model is added, and
  the UI never recomputes (the M3 "derived date on the detail, not in the client"
  rule):

| `TripDetail` field | value |
|---|---|
| `currency` | `state.currency` |
| `budget` | `state.budget` (`Money \| null`) |
| `days[].costSubtotal` | `dayCostSubtotals[i]` (minor int) |
| `unscheduledCostSubtotal` | as above |
| `tripCostTotal` | as above |
| `budgetRemaining` | `budget ? budget.amountMinor − tripCostTotal : null` (may be negative when over) |

Removing a day returns its activities to the backlog (existing `evolve`
semantics), so their costs move from a day subtotal into the unscheduled
subtotal automatically — the trip total is unchanged, which is correct.

## 6. Currency & budget as trip attributes

Two new trip-attribute commands/events, each modeled exactly on
`SetTripStartDate` / `TripStartDateSet` (diffable, undo/revert-correct via the
existing ADR-005 machinery):

- **`SetTripCurrency` → `TripCurrencySetV1`** — payload `{ tripId, currency }`.
  `state.currency` starts at `"USD"` (set in `evolve` at `TripCreated`) and is
  overwritten here. Changing the currency does **not** convert existing costs (a
  known single-currency simplification — the amounts keep their `amountMinor`;
  the UI presents them under the new code). The demo sets the currency before
  entering costs.
- **`SetTripBudget` → `TripBudgetSetV1`** — payload `{ tripId, budget: Money | null }`
  (`null` clears). `state.budget` starts at `null`. The budget uses the trip
  currency.

These flow through the **generic** pipeline (validate `TripCommand` → `decide` →
append → project); only `decide.ts`/`evolve.ts` switch on the new types. No
server route, port, or adapter is added.

## 7. The over-budget conflict (pure, no `ctx`)

A new pure rule in `conflicts.ts`, registered alongside
`timeOverlapRule`/`geographyRule`/`anchorRule`:

```ts
const budgetRule: Rule = (state, _ctx) => {
  if (state.budget === null) return [];
  const { tripCostTotal } = rollupCosts(state);
  if (tripCostTotal <= state.budget.amountMinor) return [];
  return [{
    id: `over-budget:${state.tripId}`,       // content-derived, stable → M2-dismissable
    kind: "over-budget",
    severity: "warn",                        // never blocks a write
    subjects: [state.tripId],
    description: `Trip total (${fmt(tripCostTotal, state.currency)}) exceeds the ` +
      `budget (${fmt(state.budget.amountMinor, state.currency)}) by ` +
      `${fmt(tripCostTotal - state.budget.amountMinor, state.currency)}.`,
    resolutions: ["Raise the budget", "Remove or reduce a cost"],
  }];
};
```

- **No injected context** (unlike anchors' `publicHoliday`): both the budget and
  the total are in `TripState`, so the rule is a pure function of state — the
  `detectConflicts(state, ctx)` signature is unchanged and `ctx` is simply
  ignored by this rule.
- **`id` does not encode the amounts** — a dismissal persists while the trip
  stays over budget and does not resurface each time an amount changes (matching
  the M3 anchor-id choice: dismissal means "I acknowledge this kind of conflict
  on this subject," not a specific number). Bringing the trip back within budget
  removes the conflict entirely; going over again re-raises it with the same id.
- **`fmt` is a small pure helper** in the domain that renders minor units as a
  2-decimal string + the currency code (e.g. `"1234.00 USD"`) — deterministic,
  so the stored `description` is reproducible under the golden rebuild. It shares
  the 2-decimal M4 simplification of §3.

## 8. Undo / revert interaction (no new machinery)

All three new state surfaces are already covered by ADR-005's diff:

- **Activity costs** ride `AddActivity`/`UpdateActivity`; `ActivityUpdatedV1` is
  already a full-field snapshot `diffTripStates` emits. Cost becomes
  undo/revert-correct once `equality.ts` includes it in the compare (§4).
- **Currency and budget** are normal, diffable trip-attribute events — the exact
  `TripStartDateSet` shape. `diffTripStates` emits a `TripCurrencySet` /
  `TripBudgetSet` when the field differs between states; undo/revert re-runs the
  rollup and the `budgetRule` automatically. `equality.ts` must compare
  `currency` and `budget` (a same-value set becomes a rejected `no-op`).

## 9. The three lenses (UI, same projection)

All three read the **same** `TripDetail` — no new read models (the foundation's
"alternate lenses over the same projections," §6). Built against contract-derived
MSW mocks first, then wired — the M1/M2/M3 pattern. What makes them distinct from
M3's map/timeline/calendar is that they foreground the **money rollups**.

- **Itinerary** — the shareable linear read: each dated day in order, its
  activities (time · place · cost), a **day subtotal**, then an unscheduled
  section, and a trip total + budget line. The "what are we doing / what does it
  cost" document.
- **Daily overview** — compact one-row-per-day: date, activity count, **day cost
  subtotal**, and any conflicts on that day. "Shape & spend per day at a glance."
- **Full-trip overview** — one-screen executive summary: date range, day count,
  **trip total**, **budget & remaining/over**, and a scheduled-vs-unscheduled
  split. Surfaces the `over-budget` conflict prominently.

Cost editing lives on the existing activity editor (a money input bound to the
trip currency); currency and budget are edited from a trip-settings affordance.
The `over-budget` conflict renders in the **existing** conflict banner/list and
is dismissable via the existing M2 `DismissConflict`.

**On-screen only** in M4 — no print CSS, no export (decision 7).

## 10. M3 debt paydown (folded into M4)

Two small UI items parked at the M3 gate, done as one explicit cleanup task
because M4 touches the same lens chrome and start-date surface:

- **UndoRedoControls in-flight guard** — disable/guard the undo & redo controls
  while a command is in flight, so a rapid double-click cannot fire two
  overlapping compensating commands.
- **Consolidate the two start-date controls** — M3 shipped a start-date control
  in two places; collapse to one canonical control.

Both are UI-only and carry no contract or domain change.

## 11. Contracts surface (additive; one changelog entry)

- **`money.ts`** (new): the `Money` schema/type.
- **`activity.ts`**: `AddActivity` gains `cost: Money.optional()`;
  `UpdateActivity` gains `cost: Money.nullable().optional()`; `ActivityAddedV1` /
  `ActivityUpdatedV1` payloads gain `cost: Money.nullable().default(null)`.
- **`trip.ts`**: new `SetTripCurrency` + `TripCurrencySetV1`, `SetTripBudget` +
  `TripBudgetSetV1`, joined into `TripCommand` / `TripEvent`.
- **`detail.ts`**: `ActivityView` gains `cost: Money.nullable()`; `TripDetail`
  gains `currency`, `budget` (`Money.nullable()`), `days[].costSubtotal`,
  `unscheduledCostSubtotal`, `tripCostTotal`, `budgetRemaining` (`number \|
  null`).
- **`conflict.ts`**: unchanged — `over-budget` is just a new `kind` value.

## 12. Server & API

- **No new I/O**, no new route, no new port/adapter (unlike M3's geocoder). The
  new commands flow through the existing command pipeline unchanged.
- **`decide.ts`/`evolve.ts`** gain branches for `SetTripCurrency`/`SetTripBudget`
  and read `cost` on the activity branches.
- **Projection** computes the rollup fields via `rollupCosts` and exposes
  `currency`/`budget`. `detectConflicts(state, ctx)` is called exactly as today
  (the `budgetRule` ignores `ctx`); no change to append or optimistic
  concurrency.

## 13. Testing

- **Property (fast-check):** `rollupCosts` — empty/costless trip totals `0`; the
  sum of day subtotals + unscheduled equals the trip total (partition
  invariant); adding then removing a cost is the identity on all totals.
  `diffTripStates` round-trip **with cost/currency/budget present** (undo/revert
  reproduces state exactly).
- **Golden rebuild (extended):** a log with cost edits, a `TripCurrencySet`, and
  a `TripBudgetSet` drops-and-rebuilds to identical state — the `over-budget`
  conflict included.
- **Contract:** new schemas validate; old stored `ActivityAdded/Updated` events
  still parse (the `.default(null)` guarantee); MSW mocks regenerate.
- **Integration:** the projection computes rollups; a cost edit recomputes
  subtotals and the trip total; setting a budget below the total raises the
  `over-budget` warn; clearing it removes the conflict.
- **E2E (Playwright), one new script:** the §gate demo flow. M0/M1/M2/M3 scripts
  stay green untouched.

## 14. Out of scope

Multi-currency and FX conversion (single-currency in M4; `Money` carries the
code for later); a currency-exponent map for non-2-decimal currencies (JPY/BHD);
a first-class `Flight` or `CostItem` entity, itemized/multiple costs per
activity, and an activity `kind`; per-cost currency pickers; cost categories/tags
and category rollups; print CSS, PDF, and share-link export (all deferred with
"output scope: on-screen only"); external calendar sync (M10); realtime (M7); trip
rename/delete; styling beyond functional defaults.
