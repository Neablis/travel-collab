import { TripEvent, type EventEnvelope, type TripDetail } from "@tc/contracts";
import { detectConflicts } from "./conflicts";
import { deriveDayDates } from "./dates";
import { evolveTrip } from "./evolve";
import type { TripState } from "./state";

// The single state → document definition. The live pipeline and the rebuild
// both call this, so "rebuild equals stored" holds by construction.
export function tripDetailFromState(state: TripState, createdAt: string): TripDetail {
  const dayDates = deriveDayDates(state.startDate, state.days.length);
  return {
    tripId: state.tripId,
    name: state.name,
    startDate: state.startDate,
    members: state.members,
    days: state.days.map((d, i) => ({ dayId: d.dayId, activityIds: [...d.activityIds], date: dayDates[i]! })),
    backlog: [...state.backlog],
    activities: Object.fromEntries(
      Object.entries(state.activities).map(([id, a]) => [
        id,
        {
          activityId: id,
          title: a.title,
          timeWindow: a.timeWindow,
          location: a.location,
          notes: a.notes,
          anchors: a.anchors,
        },
      ]),
    ),
    conflicts: detectConflicts(state),
    dismissedConflictIds: [...state.dismissedConflictIds],
    createdAt,
  };
}

export function projectTripDetails(envelopes: EventEnvelope[]): TripDetail[] {
  const streams = new Map<string, { state: TripState | null; createdAt: string }>();
  for (const env of envelopes) {
    const event = TripEvent.parse({ type: env.type, version: env.version, payload: env.payload });
    const entry = streams.get(env.streamId) ?? { state: null, createdAt: env.occurredAt };
    entry.state = evolveTrip(entry.state, event);
    streams.set(env.streamId, entry);
  }
  const details: TripDetail[] = [];
  for (const { state, createdAt } of streams.values()) {
    if (state !== null) details.push(tripDetailFromState(state, createdAt));
  }
  return details;
}
