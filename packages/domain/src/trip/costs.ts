import type { TripState } from "./state";

// Pure integer money math (minor units). No I/O, no clock. All costs are in the
// trip currency (single-currency, ADR-008), so amounts sum directly. An activity
// with no cost contributes 0.
export function rollupCosts(state: TripState): {
  dayCostSubtotals: number[];
  unscheduledCostSubtotal: number;
  tripCostTotal: number;
} {
  const costOf = (id: string): number => state.activities[id]?.cost?.amountMinor ?? 0;
  const dayCostSubtotals = state.days.map((d) => d.activityIds.reduce((sum, id) => sum + costOf(id), 0));
  const unscheduledCostSubtotal = state.backlog.reduce((sum, id) => sum + costOf(id), 0);
  const tripCostTotal = dayCostSubtotals.reduce((a, b) => a + b, 0) + unscheduledCostSubtotal;
  return { dayCostSubtotals, unscheduledCostSubtotal, tripCostTotal };
}
