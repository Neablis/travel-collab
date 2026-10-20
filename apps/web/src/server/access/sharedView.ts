import type { SharedTripView } from "@tc/contracts";

/**
 * `TripDetail` → the public view, dropping `members`, `conflicts`,
 * `dismissedConflictIds` and `status`. Written as an explicit field list, not
 * a spread-and-delete: a new `TripDetail` field must be opted IN to the public
 * surface, never leak into it because someone added it upstream (ADR-027).
 *
 * Each stop's `addedBy`, `bookedBy` and `participants` are emptied for the
 * reason `members` is dropped: they are actor ids, and actor ids identify real
 * people. The page draws none of them, and its totals are priced before this.
 *
 * Its own module, and a pure one, because it has two callers with very
 * different needs: `shares.ts`, which reads a real share out of Postgres, and
 * `demoTrip.ts`, whose whole point is that it never opens a connection
 * (ADR-031). `shares.ts` imports `db/client`, which constructs a `pg.Pool` at
 * module load — importing this function from there would have put that pool in
 * the demo route's graph, which is precisely the coupling the demo exists to
 * remove.
 */
export function toSharedView(
  at: Pick<
    SharedTripView,
    | "tripId"
    | "name"
    | "startDate"
    | "currency"
    | "budget"
    | "days"
    | "backlog"
    | "activities"
    | "unscheduledCostSubtotal"
    | "tripCostTotal"
  >,
  share: { seq: number; createdAt: string },
  travellerCount: number,
  currentSeq: number,
): SharedTripView {
  return {
    tripId: at.tripId,
    name: at.name,
    startDate: at.startDate,
    currency: at.currency,
    budget: at.budget,
    days: at.days,
    backlog: at.backlog,
    activities: Object.fromEntries(
      Object.entries(at.activities).map(([id, activity]) => [
        id,
        { ...activity, addedBy: null, bookedBy: null, participants: [] },
      ]),
    ),
    unscheduledCostSubtotal: at.unscheduledCostSubtotal,
    tripCostTotal: at.tripCostTotal,
    travellerCount,
    seq: share.seq,
    sharedAt: share.createdAt,
    stale: currentSeq > share.seq,
  };
}
