import {
  TripDetail,
  travellerIds,
  type Guest,
  type ListedTripSummary,
  type TripMember,
} from "@tc/contracts";
import { recostDetail } from "@tc/domain";
import { tripSpend } from "@/lib/cost";

/**
 * A detail as a reader sees it: the effective member list, and the cost totals
 * that list implies.
 *
 * The two travel together because a stop's price is per person (ADR-060). A
 * stop nobody picked is priced for every traveller on the trip (travellers
 * spec D1) — members and guests alike (guests spec P2) — and who is on the
 * trip, and which of them is travelling, is Access & Membership data the
 * planning log does not hold. So the stored projection totals for the log's
 * own members (invariant 2), and every place that swaps in the effective
 * members recosts for their travellers in the same step. If a site overlaid
 * the members alone, a command response and the GET after it would show the
 * same trip with two different totals.
 *
 * `guests` is the trip's `listGuests` answer (guests spec P1); omitted it
 * reads as no guests, which is what a caller with no trip row (the demo)
 * passes. Every server caller that reads a real trip fetches them.
 *
 * Pure, and its own module for the reason `sharedView.ts` is: `demoTrip.ts`
 * must never import `db/client`, and `trip-access.ts` does.
 */
export function overlayMembers(
  detail: TripDetail,
  members: TripDetail["members"],
  guests: readonly Guest[] = [],
): TripDetail {
  return { ...recostDetail(detail, travellerIds(members, guests).length), members };
}

/**
 * What a Home card's budget line is made from (`ListedTripSummary.spend`): the
 * stored detail put through `readTrip`'s own steps in `trip-access.ts` — this
 * overlay for the effective members and the guests, then the `TripDetail`
 * parse — and read by `tripSpend`, the function the trip page reads. So the
 * card and the trip page cannot show two totals for one trip.
 *
 * `members` is the effective list as `GET /api/trips` already holds it
 * (`withListedMembers`), merged over the summary row's projected members
 * rather than the doc's: both are folded from the same log in the same
 * transaction, and re-reading the grants to merge them over the doc instead
 * would cost the list two more statements for the same answer. Only the
 * fields a member carries are kept, so a card's persona is not parsed as part
 * of a detail.
 *
 * Null when there is no stored detail or the overlay does not parse — the
 * single read answers that `malformed-trip`, and a card answers it with no
 * line rather than taking the list down.
 */
export function listedSpend(
  detail: TripDetail | undefined,
  members: readonly TripMember[],
  guests: readonly Guest[] = [],
): ListedTripSummary["spend"] {
  if (detail === undefined) return null;
  const effective = members.map(({ userId, role, travelling }) => ({ userId, role, travelling }));
  const parsed = TripDetail.safeParse(overlayMembers(detail, effective, guests));
  if (!parsed.success) {
    console.error("trips list: overlaid detail failed TripDetail parse", {
      tripId: detail.tripId,
      issues: parsed.error.issues,
    });
    return null;
  }
  const spend = tripSpend(parsed.data);
  return { totalMinor: spend.total, budgetMinor: spend.budget, currency: parsed.data.currency };
}
