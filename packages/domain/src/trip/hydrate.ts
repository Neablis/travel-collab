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
    // `?? null` for the same reason the schema carries a default: this is
    // called on a `trip_details.doc` straight out of Postgres (duplicateTrip,
    // the AI batch resolver), which for a row written before M11 link 5 has
    // no `forkedFrom` key at all. TripDetail's type says otherwise because
    // Zod's default fills it in on parse — and that read does not parse.
    forkedFrom: detail.forkedFrom ?? null,
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
          // Same unparsed-document reasoning as `forkedFrom` above, for the
          // two fields M18 added: a doc written before it has neither key, and
          // `state.ts` calls "planned" the zero value that is never null. A
          // clone or an AI batch built from such a trip would otherwise carry
          // `undefined` into TripState — where the type says it cannot be.
          kind: a.kind ?? "planned",
          tags: a.tags ?? [],
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
