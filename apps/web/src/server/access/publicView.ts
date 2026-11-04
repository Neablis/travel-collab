import type { PageDoc, SharedTripView, TripDetail } from "@tc/contracts";
import { redactBookingFor } from "./bookingRedaction";

/**
 * What `/n/<token>` reads (M58, ADR-088 §3): a public notebook's page and the
 * trip data its widgets resolve against, for a reader with no session.
 *
 * **An explicit field list, never a spread with deletions** (ADR-027's
 * 2026-10-08 amendment, as `toSharedView`): a field added to `TripDetail`
 * later is opted in here or it does not reach a stranger. It is `TripDetail`
 * less `members`, `conflicts`, `dismissedConflictIds`, `status`, the
 * creation time and the rollup hints, and it takes the page's title and
 * document, never its id.
 *
 * Three floors hold whatever a widget's `hideWhenPublic` says (ADR-088 §5):
 * - A booking goes through `redactBookingFor(null)` (ADR-086): provider only.
 * - There is no chat field at all, and the public reader has no `canChat`.
 * - A stop's `addedBy`, `bookedBy` and `participants` are emptied: they are
 *   actor ids, and actor ids identify real people.
 *
 * Live, not pinned (ADR-088 §2), so there is no `seq` here, unlike `toSharedView`.
 */
export type PublicNotebookView = Pick<
  SharedTripView,
  "tripId" | "name" | "startDate" | "currency" | "budget" | "days" | "backlog" | "activities" | "unscheduledCostSubtotal" | "tripCostTotal" | "travellerCount"
> & { page: { title: string; content: PageDoc } };

export function toPublicNotebookView(
  trip: Pick<
    TripDetail,
    "tripId" | "name" | "startDate" | "currency" | "budget" | "days" | "backlog" | "activities" | "unscheduledCostSubtotal" | "tripCostTotal"
  >,
  page: { title: string; content: PageDoc },
  travellerCount: number,
): PublicNotebookView {
  const redact = redactBookingFor(null);
  return {
    tripId: trip.tripId,
    name: trip.name,
    startDate: trip.startDate,
    currency: trip.currency,
    budget: trip.budget,
    days: trip.days,
    backlog: trip.backlog,
    activities: Object.fromEntries(
      Object.entries(trip.activities).map(([id, activity]) => [
        id,
        { ...activity, booking: redact(activity.booking), addedBy: null, bookedBy: null, participants: [] },
      ]),
    ),
    unscheduledCostSubtotal: trip.unscheduledCostSubtotal,
    tripCostTotal: trip.tripCostTotal,
    travellerCount,
    page: { title: page.title, content: page.content },
  };
}
