# ADR-009: Cost is an activity snapshot field; flights are activities

**Status:** Accepted — 2026-07-10
**Deciders:** Mitchell (product/eng), Claude (architect)

## Context

The roadmap frames M4 as "cost items on activities / days / flights, with rollup
to the trip." Taken literally that suggests three cost carriers and possibly a
first-class flight entity. Before modeling that, weigh it against how cost
actually needs to behave:

- A cost must be **undo/revert-correct** — editing or clearing a cost has to flow
  through the ADR-005 compensating-events machinery like every other change.
- The M3 anchor work established a cheap pattern for "a new per-activity
  attribute": ride the existing `ActivityAdded`/`ActivityUpdated` full-field
  snapshot events, add the field to `state`/`evolve`/`equality`/`diff`/`decide`,
  and undo/revert is correct for free — **zero new event types**.
- "Days" and "flights" as separate cost carriers each imply new structure: days
  are currently thin (`{ dayId, activityIds }`) with no attribute event, and a
  flight entity implies flight-specific fields (airports, numbers, layovers) with
  no consumer in M4.

Options weighed:

- **A. Cost is a field on activities; flights/day/trip costs are activities.**
  One `cost: Money | null` field riding the existing activity events. A flight is
  an activity carrying a cost; a whole-trip cost (insurance) is a backlog
  activity carrying a cost. The rollup sums per day + backlog → trip total.
- **B. A first-class `CostItem` entity** with `{ amount, label, scope:
  activity|day|trip }` and its own `AddCostItem`/`UpdateCostItem`/`RemoveCostItem`
  events. Literal match to the roadmap's three carriers; supports multiple
  itemized costs per subject.
- **C. Activity field + a separate day/trip cost mechanism** (a trip-level cost
  list alongside the activity field). A middle ground.

## Decision

**Option A.** Cost is a single optional field on activities, riding the existing
activity commands/events:

- `AddActivity.cost?` and `UpdateActivity.cost?` (omitted = unchanged, `null` =
  cleared — the `location`/`notes` contract); `ActivityAddedV1`/
  `ActivityUpdatedV1` payloads gain `cost: Money.nullable().default(null)` (the
  `.default` keeps previously-stored events parseable).
- **Flights and day/trip-level costs are ordinary activities** — no first-class
  `Flight` or `CostItem` entity, and no activity `kind` in M4. A flight is an
  activity with a cost; a trip-level cost is a backlog activity with a cost.
- The rollup (`rollupCosts`, ADR-008) sums each day's activity costs into a day
  subtotal, backlog activity costs into the unscheduled subtotal, and both into
  the trip total.

This deliberately **reinterprets the roadmap's three carriers as one
mechanism** — a scope decision Mitchell made explicitly on 2026-07-10.

## Consequences

- **No new activity events; undo/revert is free.** Cost is diffable through the
  existing `ActivityUpdated` snapshot the moment `equality.ts` compares it (which
  also makes a same-cost update a rejected `no-op`). The only diff/equality change
  is a fill-in, not a redesign — exactly the M3 anchor outcome.
- **Smallest surface that satisfies the gate.** One field + one pure rollup +
  three lens readers, versus a new aggregate sub-entity (B) with its own events,
  diff branches, decide logic, and UI.
- **Trip- and day-level costs work, with a modeling wart.** A cost that is not
  naturally a single activity (a hotel across five nights) is entered as the
  planner chooses — one trip-level activity, or one per night. The rollup does
  not need to resolve this; it is a UX judgement, noted as a known
  simplification.
- **The backlog does double duty** as "unscheduled activities" and "trip-level
  costs." The unscheduled subtotal is surfaced distinctly in the lenses so a
  trip-level insurance line is legible, not hidden among unscheduled ideas.
- **Forward path stays open.** If a later milestone needs itemized costs, a
  flight entity, or cost categories, that is an additive change (a new
  sub-entity or an activity `kind`) — this decision does not foreclose it, it
  declines to pay for it before there is a consumer.
- **Escape hatch.** Should day- or trip-scoped costs ever need to exist
  independent of an activity, Option B's `CostItem` is the recorded upgrade path;
  the rollup would then sum activity costs *and* cost items.
