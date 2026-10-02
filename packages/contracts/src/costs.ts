import type { ActivityKind } from "./activity.ts";
import type { Money } from "./money.ts";

// **A stop's price is per person** (ADR-060). These three functions are the only
// place that reading is written down. The domain's `rollupCosts`, the server's
// read-time recost, `apps/web/src/lib/cost.ts` and every `@tc/pages` cost widget
// call them, which is why they live in contracts: a second copy of "price ×
// headcount" in any one of those is a total that can disagree with the board's
// (invariant 5).

/**
 * How many people a stop is priced for: the people picked in *Who is in*, or
 * every member of the trip when nobody is picked (ADR-060 decision 2).
 *
 * `memberCount` is the EFFECTIVE member count at read time, not the log's. It is
 * never trusted below 1, because a trip always has its owner and a zero would
 * make every price vanish.
 */
export function stopHeadcount(activity: { participants: readonly string[] }, memberCount: number): number {
  return activity.participants.length > 0 ? activity.participants.length : Math.max(memberCount, 1);
}

/** A stop's whole price in minor units: per-person `cost` × headcount, or 0 when it has no cost. */
export function stopTotal(
  activity: { cost?: Money | null; participants: readonly string[] },
  memberCount: number,
): number {
  if (!activity.cost) return 0;
  return activity.cost.amountMinor * stopHeadcount(activity, memberCount);
}

/**
 * Whether a stop's cost is committed or still an estimate. It is the stop's
 * kind and nothing else (ADR-060 decision 5): a `pending` stop is not decided,
 * so its price is a guess. There is no second field that could disagree.
 */
export function isCommittedCost(kind: ActivityKind): boolean {
  return kind !== "pending";
}
