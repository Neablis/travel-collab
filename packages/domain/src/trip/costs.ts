import { stopTotal } from "@tc/contracts";
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
// the log does not hold (`recostDetail` in `detail.ts`) — and so does the
// decider, when the server tells it that count (`DecideContext.memberCount`).
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
