### KI-2026-09-24-p — cost totals add yen to dollars when a trip's stops are priced in more than one currency

- **Severity:** minor today (ADR-008 S1 says a trip has one currency), latent correctness bug the moment two currencies meet on one trip — and nothing stops them meeting.
- **Milestone:** M14, carried rather than gating. Filed by the M14 polish pass.
- **Area:** `packages/pages/src/select.ts` (`costOfStops`), `packages/domain/src/trip/costs.ts` (`rollupCosts`), and what reads them: the `cost` single and `cost.rows` in `packages/pages/src/macros/primitives/single.ts` / `rows.ts`, the itinerary card total in `block.ts` (its own inline sum), and the board's `costSubtotal` / `tripCostTotal` via `detail.ts`.
- **Symptom / What happens:** each of these sums `cost.amountMinor` and prints the result in the TRIP's currency, ignoring each stop's own `cost.currency`. A trip in USD with a ¥3,000 stop and a $20 stop totals "$3,020.00". The budget-overrun conflict (`conflicts.ts`) compares the same sum against the budget.
- **Why it is reachable:** every stored `Money` carries its own currency (ADR-008 kept that on purpose), the domain does not reject a stop priced in another currency, and `SetTripCurrency` changes the trip's currency without touching existing costs. Two surfaces already treat mixed currencies as real: `kinds.ts` collapses `money` per currency and joins them with " + ", and `spendByDay` charts only the trip's currency and names the rest under the chart. So the same notebook can show a correct per-currency figure beside a wrong summed one.
- **Why not fixed here:** the honest fix is a rule, not a patch — either the domain refuses a cost in a non-trip currency (and says what `SetTripCurrency` does to existing costs), or every total sums per currency as `kinds.ts` does, which changes `tripCostTotal`'s shape (`packages/contracts`, the board, the budget conflict). `costOfStops` is deliberately the same sum as `rollupCosts` (ADR-039, "one number, one implementation"), so they must change together. ADR-008's "multi-currency is additive later" is the decision this touches.
- **First noted:** 2026-09-24, M14 polish pass.
- **Re-verified 2026-09-25 (overnight sweep):** still true. Each named sum adds
  `amountMinor` with no currency check: `costOfStops` (`select.ts:326`),
  `rollupCosts` (`packages/domain/src/trip/costs.ts:11`), the itinerary card
  (`block.ts:66`, printed in `trip.currency` at `:72`); the budget conflict
  compares that total (`conflicts.ts:280`). `decide.ts` never checks a cost's
  currency (its only `currency` line is `TripCurrencySet`, `:206`), while
  `kinds.ts:119-125` still totals per currency. Also seen: `block.ts:88`
  formats each stop's own cost in `trip.currency` too, while `rows.ts:274`
  uses the stop's own currency — the same notebook disagrees per row.
