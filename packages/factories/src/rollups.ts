import type { TripDetail } from "@tc/contracts";
import { rollupCosts } from "@tc/domain";

// Make a hand-built `TripDetail` tell the truth about its own money.
//
// WHY THIS EXISTS. `AGENTS.md` says never a hand-built rollup, and the reason
// is not tidiness: a fixture whose totals disagree with its stops is a test
// asserting against a world that cannot exist, and it fails in the one
// direction nobody checks — it passes.
//
// The rule had no way to be followed in a component test. `rollupCosts` lives
// in `@tc/domain`, and the module map (`AGENTS.md`) allows only
// `apps/web/src/server/**` to import it — so a test under
// `apps/web/src/components/**` had the rule and no instrument, and did what you
// would expect. `MacroView.test.tsx` carried `tripCostTotal: 12345` with zero
// activities, and after that was fixed, `unscheduledCostSubtotal: 500` with no
// unscheduled stop. Both were found by a reviewer, not by a test, and the
// second only surfaced because a widget started summing the stops rather than
// reading the field (PR #141, both review rounds).
//
// `@tc/factories` may import `@tc/domain`, so the boundary is satisfied by
// putting the helper here: the component test imports a factory, and the
// arithmetic stays the domain's one implementation.
//
// WHEN TO USE SOMETHING ELSE. If you need a costed trip and do not care about
// its exact shape, `costedTripDetailFixture()` already exists and is already
// consistent — reach for that first. This is for when the test needs a
// *particular* arrangement of stops and days, which is when hand-building
// starts and the lying starts with it.

/**
 * Return `detail` with every cost rollup recomputed from the stops it carries:
 * each day's `costSubtotal`, the `unscheduledCostSubtotal`, and `tripCostTotal`.
 *
 * `budgetRemaining` is recomputed too when a `budget` is set, because it is
 * derived from the total and a stale one is the same class of lie.
 */
export function withCostRollups(detail: TripDetail): TripDetail {
  // `rollupCosts` reads `activities`, `days[].activityIds` and `backlog`, all
  // of which a TripDetail carries with the same meaning. Delegating rather
  // than re-summing here is the whole point: a second implementation is how a
  // fixture and the app come to disagree about the same trip.
  // No cast: a `TripDetail` structurally *is* a `TripState` plus derived
  // fields, so this compiles only while that stays true — which is the
  // property worth having a compiler check rather than a comment.
  const { dayCostSubtotals, unscheduledCostSubtotal, tripCostTotal } = rollupCosts(detail);

  return {
    ...detail,
    days: detail.days.map((day, i) => ({ ...day, costSubtotal: dayCostSubtotals[i] ?? 0 })),
    unscheduledCostSubtotal,
    tripCostTotal,
    budgetRemaining:
      detail.budget === null ? detail.budgetRemaining : detail.budget.amountMinor - tripCostTotal,
  };
}
