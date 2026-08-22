import type { TripDetail } from "@tc/contracts";

// Currency is trip-level, never per-event (decision, 2026-08-14), so every
// amount here shares detail.currency and callers format once with it. No
// per-amount currency branching.
//
// `total` and `remaining` are READ from the projection, not recomputed, in
// BOTH functions below: TripDetail.tripCostTotal/.budgetRemaining and each
// day's own `days[].costSubtotal` are all summed server-side by
// rollupCosts() (packages/domain/src/trip/costs.ts; the fields themselves are
// packages/contracts/src/detail.ts:33,41-42), and a second client-side sum
// could silently disagree with the figure the rest of the app trusts even
// though it happens to agree today. Only `unpriced` has no server-side
// field to read (nothing counts "activities with no cost" for us) — that
// one, and only that one, is legitimately derived here by iterating
// activities.
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

  let unpriced = 0;
  for (const activityId of day.activityIds) {
    if (isUnpriced(detail.activities[activityId]?.cost)) unpriced += 1;
  }
  return { total: day.costSubtotal, unpriced };
}
