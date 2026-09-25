# ADR-053: Transport mode is a closed seven-value enum, carried by a transit stop

**Status:** **Accepted — 2026-09-25, Mitchell's decision, in chat.**
**Deciders:** Mitchell (product/eng); Claude — drafted
Related: **ADR-003** (the event log owns planning), invariant 5 (contracts change by
protocol). Milestone: `docs/milestones/M24-travel-legs.md` — link 1, and its section
*"Two decisions, made 2026-09-18"*, which this ADR does not restate.

## Context

M18 gave `ActivityKind` a `transit` value, so a stop can say *that* it is travel. Nothing
says *by what*. `MapLegend.tsx` records the consequence in the component that pays for it,
and its two mode keys sit behind an inert `<Preview id="map-legend-modes">` shell. M24's
exit gate asks for the vocabulary to be settled in an accepted ADR that names the values and
what it rejected, before a map style or a legend key is attached to any of them.

## Decision

`ActivityMode` in `packages/contracts/src/activity.ts`:

```
walk | bus | train | flight | ferry | car | bike
```

- **Closed, never freeform**, for the reason `ActivityTag` is: every value will carry
  behaviour — a line style on the map, a legend key — and a free string cannot carry one.
- **What folds together.** Taxi, rideshare and a rental are `car`. Metro, tram, light rail
  and a shinkansen are `train`. The distinctions dropped are ones no planned surface draws
  differently.
- **Carried by the stop, nullable, legal only when `kind === "transit"`.** Refused on the
  command unions (`TripCommand`, `BatchableCommand`) when a command states the
  contradiction, and by the decider when a patch would leave one behind on a stop that is
  no longer transit (`travelLegFieldsOffTransit`, one predicate for both). Never refused on
  an event payload or a read model: replay and a stored row must always parse.
- **`endLocation` ships beside it** under the same rule, and `location` keeps meaning the
  leg's origin (the milestone's decision 2).

## Rejected

- **A freeform string.** No behaviour can attach to it; every reader would need its own
  normalisation of "Train" / "rail" / "JR", and the legend could not be exhaustive.
- **Inheriting mode from `kind`** — for example a `transit-train` kind. `kind` answers
  *where is this in the workflow*; mode answers *by what*. Folding them multiplies the kind
  enum by the mode enum and breaks every surface that already reads `kind === "transit"`
  (`N to book`, the Calendar, KI-60's conflict rule). A separate field cannot disagree with
  `kind` because its presence is a function of it — the M24 file's decision 1 has the full
  argument against the `ActivityTag` precedent.
- **A nine-value list with `taxi` and `metro`.** Neither draws differently from `car` and
  `train` on any surface M24 builds, and a value with no distinct behaviour is exactly what
  a closed vocabulary exists to avoid. Adding one later is additive.
- **Modelling travel as an edge between two stops.** Cleaner in the abstract, rejected
  because the whole app is "a day is an ordered list of stops": an edge would need its own
  identity, events, undo, projection rows and a slot in a list that has none. The M24 file's
  decision 2 is the full reasoning.

## Consequences

- Adding a mode is a contract change under invariant 5 and a new legend/style decision, not
  a data edit.
- A transit stop with no `mode` stays legal: `null` means *not said*, and every stop written
  before M24 is one.
- The Japan fixture exercises `train`, `flight` and `ferry` only — it is the trip it is.
  `expectations.ts` pins the full histogram, zeros included, rather than demanding every
  value, so a fixture never invents a leg to fill a count.
