import { isCommittedCost, stopHeadcount, stopTotal, type ActivityView, type TripDetail } from "@tc/contracts";
import { formatMoney } from "@/lib/formatMoney";

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
// one is legitimately derived here by iterating activities. So is `estimated`
// (ADR-060 decision 5): the part of the total that is a pending stop's guess.
// It sums `stopTotal`, the one per-person rule the server's total is built
// from, over `detail.members` — the effective list the server has already
// recosted that total for — so the two cannot be priced for different people.
export type TripSpend = {
  total: number;
  /** The part of `total` that is still an estimate: pending stops. `total − estimated` is committed. */
  estimated: number;
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
  const activities = Object.values(detail.activities);
  const unpriced = activities.filter((a) => isUnpriced(a.cost)).length;
  const estimated = activities
    .filter((a) => !isCommittedCost(a.kind))
    .reduce((sum, a) => sum + stopTotal(a, detail.members.length), 0);
  return {
    total: detail.tripCostTotal,
    estimated,
    unpriced,
    budget: detail.budget?.amountMinor ?? null,
    remaining: detail.budgetRemaining,
    over: detail.budgetRemaining !== null && detail.budgetRemaining < 0,
  };
}

// "{planned} planned of {budget}" (or the honest "No budget yet") — shared by
// every caller that has a real TripDetail in hand (NextTripHero for its own
// single trip, page.tsx for each visible grid trip, Task 4.1/M10 Phase 4).
// Takes the already-computed TripSpend rather than a TripDetail directly so
// callers that already called tripSpend() for other reasons don't recompute it.
export function plannedOfBudgetLine(spend: TripSpend, currency: string): string {
  return spend.budget === null
    ? "No budget yet"
    : `${formatMoney(spend.total, currency)} planned of ${formatMoney(spend.budget, currency)}`;
}

/**
 * "¥… committed · ¥… estimated" when part of the total is a pending stop's
 * guess, or null when none of it is — a total with nothing to split says what
 * it said before.
 */
export function committedLine(spend: TripSpend, currency: string): string | null {
  if (spend.estimated === 0) return null;
  return `${formatMoney(spend.total - spend.estimated, currency)} committed · ${formatMoney(spend.estimated, currency)} estimated`;
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

// ADR-060: a per-person price is wrong for a shared room, so the editor makes
// the total visible where the price is typed, rather than leaving it to be
// discovered on the budget line.
/**
 * "× 3 people = ¥9,000": a stop's per-person price times its headcount, for the
 * stop editor and a viewer's read-only sheet. Null for a stop with no cost —
 * there is nothing to multiply.
 */
export function stopTotalLine(
  stop: Pick<ActivityView, "cost" | "participants">,
  memberCount: number,
  currency: string,
): string | null {
  if (stop.cost === null) return null;
  const people = stopHeadcount(stop, memberCount);
  return `× ${people} ${people === 1 ? "person" : "people"} = ${formatMoney(stopTotal(stop, memberCount), currency)}`;
}
