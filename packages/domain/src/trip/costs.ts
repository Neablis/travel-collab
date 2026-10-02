import { stopTotal, type TripDetail } from "@tc/contracts";
import type { TripState } from "./state";

// Pure integer money math (minor units). No I/O, no clock. All costs are in the
// trip currency (single-currency, ADR-008), so amounts sum directly. An activity
// with no cost contributes 0.
//
// A stop's `cost` is per person (ADR-060), so what is summed is `stopTotal`,
// never the raw price. `memberCount` is a parameter rather than
// `state.members.length` because the two callers disagree on purpose: the
// projection passes the log's own members, so rebuild equals stored (invariant
// 2), and the server's read-time overlay passes the effective members, which
// the log does not hold (`recostDetail` below).
export function rollupCosts(
  state: Pick<TripState, "days" | "backlog" | "activities">,
  memberCount: number,
): {
  dayCostSubtotals: number[];
  unscheduledCostSubtotal: number;
  tripCostTotal: number;
} {
  const costOf = (id: string): number => {
    const activity = state.activities[id];
    return activity ? stopTotal(activity, memberCount) : 0;
  };
  const dayCostSubtotals = state.days.map((d) => d.activityIds.reduce((sum, id) => sum + costOf(id), 0));
  const unscheduledCostSubtotal = state.backlog.reduce((sum, id) => sum + costOf(id), 0);
  const tripCostTotal = dayCostSubtotals.reduce((a, b) => a + b, 0) + unscheduledCostSubtotal;
  return { dayCostSubtotals, unscheduledCostSubtotal, tripCostTotal };
}

/**
 * The same detail with every cost rollup recomputed for `memberCount` people:
 * each day's `costSubtotal`, `unscheduledCostSubtotal`, `tripCostTotal` and
 * `budgetRemaining`.
 *
 * For the read boundary (ADR-060 decision 4). Who is on a trip is Access &
 * Membership data, not planning data, so a stop nobody picked costs more the
 * moment someone joins — with no event. The stored projection keeps the log's
 * answer; the server applies this wherever it overlays the effective member
 * list, so the totals a reader sees match the members they see.
 */
export function recostDetail(detail: TripDetail, memberCount: number): TripDetail {
  const { dayCostSubtotals, unscheduledCostSubtotal, tripCostTotal } = rollupCosts(detail, memberCount);
  return {
    ...detail,
    days: detail.days.map((day, i) => ({ ...day, costSubtotal: dayCostSubtotals[i]! })),
    unscheduledCostSubtotal,
    tripCostTotal,
    budgetRemaining: detail.budget ? detail.budget.amountMinor - tripCostTotal : null,
  };
}
