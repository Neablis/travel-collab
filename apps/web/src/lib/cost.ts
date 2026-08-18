import type { TripDetail } from "@tc/contracts";

// Currency is trip-level, never per-event (decision, 2026-08-14), so every
// amount here shares detail.currency and callers format once with it. No
// per-amount currency branching.
//
// `total` and `remaining` are READ from the projection, not recomputed:
// TripDetail.tripCostTotal and .budgetRemaining are summed server-side
// (packages/contracts/src/detail.ts:41-42), and a second client-side sum could
// silently disagree with the figure the rest of the app trusts.
export type TripSpend = {
  total: number;
  unpriced: number;
  budget: number | null;
  remaining: number | null;
  over: boolean;
};

// ActivityView.cost (packages/contracts/src/detail.ts:14) is Money.nullable() —
// an unpriced activity is always `null` there. `undefined` only shows up here
// because `detail.activities` is a Record<string, ActivityView>: looking up an
// id via `?.` (daySpend, for an id that isn't in the map) types as `| undefined`
// too, so this guard covers both without assuming they mean the same thing.
function isUnpriced(cost: { amountMinor: number } | null | undefined): cost is null | undefined {
  return cost === undefined || cost === null;
}

export function tripSpend(detail: TripDetail): TripSpend {
  const unpriced = Object.values(detail.activities).filter((a) => isUnpriced(a.cost)).length;
  return {
    total: detail.tripCostTotal,
    unpriced,
    budget: detail.budget?.amountMinor ?? null,
    remaining: detail.budgetRemaining,
    over: detail.budgetRemaining !== null && detail.budgetRemaining < 0,
  };
}

export function daySpend(detail: TripDetail, dayId: string): { total: number; unpriced: number } {
  const day = detail.days.find((d) => d.dayId === dayId);
  if (day === undefined) return { total: 0, unpriced: 0 };

  let total = 0;
  let unpriced = 0;
  for (const activityId of day.activityIds) {
    const cost = detail.activities[activityId]?.cost;
    if (isUnpriced(cost)) unpriced += 1;
    else total += cost.amountMinor;
  }
  return { total, unpriced };
}
