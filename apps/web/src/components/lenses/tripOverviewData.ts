import type { Money, TripDetail } from "@tc/contracts";

export type TripOverview = {
  dayCount: number;
  dateRange: { from: string; to: string } | null;
  tripCostTotal: number;
  scheduledTotal: number;
  unscheduledTotal: number;
  currency: string;
  budget: Money | null;
  budgetRemaining: number | null;
  overBudget: boolean;
};

export function tripOverview(detail: TripDetail): TripOverview {
  const dates = detail.days.map((d) => d.date).filter((d): d is string => d !== null);
  const dateRange = dates.length ? { from: dates[0]!, to: dates[dates.length - 1]! } : null;
  return {
    dayCount: detail.days.length,
    dateRange,
    tripCostTotal: detail.tripCostTotal,
    scheduledTotal: detail.tripCostTotal - detail.unscheduledCostSubtotal,
    unscheduledTotal: detail.unscheduledCostSubtotal,
    currency: detail.currency,
    budget: detail.budget,
    budgetRemaining: detail.budgetRemaining,
    overBudget: detail.budgetRemaining !== null && detail.budgetRemaining < 0,
  };
}
