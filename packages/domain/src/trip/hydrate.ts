import type { TripDetail } from "@tc/contracts";
import type { TripState } from "./state";

// Inverse of tripDetailFromState: drop the derived fields (conflicts, day
// dates, day/trip cost subtotals, createdAt, budgetRemaining) and the
// per-activity activityId (redundant with the record key), keeping only the
// state-bearing fields. TripDetail is a superset of TripState, so this is
// total and lossless — guarded by the round-trip property test in
// test/hydrate.property.test.ts.
export function hydrate(detail: TripDetail): TripState {
  return {
    tripId: detail.tripId,
    name: detail.name,
    members: [...detail.members],
    startDate: detail.startDate,
    days: detail.days.map((d) => ({ dayId: d.dayId, activityIds: [...d.activityIds] })),
    backlog: [...detail.backlog],
    activities: Object.fromEntries(
      Object.entries(detail.activities).map(([id, a]) => [
        id,
        {
          title: a.title,
          timeWindow: a.timeWindow,
          location: a.location,
          notes: a.notes,
          anchors: a.anchors,
          cost: a.cost,
        },
      ]),
    ),
    dismissedConflictIds: [...detail.dismissedConflictIds],
    currency: detail.currency,
    budget: detail.budget,
    status: detail.status,
  };
}
