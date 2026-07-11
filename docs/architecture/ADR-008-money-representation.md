# ADR-008: Money as integer minor units, single currency per trip

**Status:** Accepted — 2026-07-10
**Deciders:** Mitchell (product/eng), Claude (architect)

## Context

M4 adds costs on activities, a trip budget, and cost rollups to per-day
subtotals and a trip total (foundation §6). Two representation questions must be
settled before any cost is stored, because **events are forever** (AGENTS.md):
the shape chosen here is written into `events.payload` jsonb permanently and into
the `trip_details` projection guarded by the golden rebuild test.

1. **How is a money amount represented?** Floating-point money accumulates
   rounding error under repeated addition — unacceptable for a stored projection
   that must rebuild bit-identically from the log (Invariant 2). A money value
   also needs to record *which* currency it is, or a total is meaningless.

2. **How many currencies does a trip have?** Real trips incur costs abroad.
   Supporting arbitrary per-cost currencies means converting them into one
   display currency for the rollup, which drags in an FX-rate source and the
   "which rate, as of when?" problem — a stored, replayable projection cannot
   call a live rate API (same purity constraint as ADR-006).

Options weighed for representation: **(A)** integer minor units + an ISO-4217
code; **(B)** a decimal string; **(C)** a floating-point number. Options weighed
for scope: **(S1)** one currency per trip, conversion deferred; **(S2)**
multi-currency now with an injected FX oracle; **(S3)** no trip currency — each
cost carries its own, totals grouped per currency.

## Decision

**Representation: A — integer minor units + ISO-4217.**

```ts
Money = { amountMinor: int ≥ 0; currency: /^[A-Z]{3}$/ }
```

`amountMinor` counts the currency's smallest unit (cents for USD/EUR, whole yen
for JPY). All arithmetic — rollups, budget deltas — is integer
addition/subtraction: exact, deterministic, and safe under the golden rebuild.
Every `Money` is self-describing via its `currency`.

**Scope: S1 — single currency per trip, conversion deferred.**

`TripState.currency` is a plain string defaulting to `"USD"` (the default is
applied in `evolve` at `TripCreated`, never stored in that event) and changed by
a new `SetTripCurrency` / `TripCurrencySet` event (modeled on
`SetTripStartDate`). Every cost the UI emits is in the trip currency, so the
rollup sums `amountMinor` directly with no conversion. `Money` **still carries a
`currency` code** even though the trip is single-currency, so the stored data is
already multi-currency-shaped.

**Rollups are derived, not stored** (a direct consequence, recorded here): a pure
`rollupCosts(state)` computes the subtotals/total, exposed on `TripDetail`; no
total is ever an event or a stored state field. This is the `deriveDayDates`
precedent from M3.

## Consequences

- **Exact, replayable money.** Integer math means the rebuilt projection equals
  the stored one to the unit; the golden rebuild test stays meaningful for costs
  and the budget.
- **Multi-currency is additive later, not a rewrite.** Because every stored cost
  already records its currency, enabling multi-currency is: add an injected
  FX-rate oracle (the ADR-006 `ConflictContext` shape — a deterministic,
  offline-at-rebuild source), a per-cost currency picker, and a per-currency or
  converted rollup. No stored data migrates. Recorded constraint: any future FX
  source, like the holiday oracle, must be deterministic at rebuild time.
- **A trip currency change does not convert existing amounts** in M4. The
  `amountMinor` values are unchanged and re-presented under the new code — a
  known single-currency simplification, acceptable because the demo/dogfood flow
  sets the currency before entering costs.
- **Display carries a 2-decimal assumption in M4.** The money input and the
  `over-budget` conflict's `description` render minor units as a 2-decimal
  string, correct for USD/EUR/GBP and most currencies. A currency-exponent map
  (JPY = 0, BHD = 3) is a noted follow-up; the **stored** shape already supports
  any exponent, so this is a UI/formatting gap, not a data one.
- **New trip-attribute events.** `TripCurrencySet` (and M4's `TripBudgetSet`)
  follow the established `TripStartDateSet` pattern — diffable, undo/revert-
  correct via ADR-005 with no new machinery.
