import type { TripDetail } from "@tc/contracts";
import { recostDetail } from "@tc/domain";

/**
 * A detail as a reader sees it: the effective member list, and the cost totals
 * that list implies.
 *
 * The two travel together because a stop's price is per person (ADR-060). A
 * stop nobody picked is priced for everyone on the trip, and who is on the trip
 * is Access & Membership data the planning log does not hold. So the stored
 * projection totals for the log's own members (invariant 2), and every place
 * that swaps in the effective members recosts for them in the same step. If a
 * site overlaid the members alone, a command response and the GET after it
 * would show the same trip with two different totals.
 *
 * Pure, and its own module for the reason `sharedView.ts` is: `demoTrip.ts`
 * must never import `db/client`, and `trip-access.ts` does.
 */
export function overlayMembers(detail: TripDetail, members: TripDetail["members"]): TripDetail {
  return { ...recostDetail(detail, members.length), members };
}
