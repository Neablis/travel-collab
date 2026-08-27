import { TripEvent, type EventEnvelope, type TripDetail } from "@tc/contracts";
import { detectConflicts, DEFAULT_CONFLICT_CONTEXT, type ConflictContext } from "./conflicts";
import { rollupCosts } from "./costs";
import { deriveDayDates } from "./dates";
import { evolveTrip } from "./evolve";
import type { TripState } from "./state";

// The single state → document definition. The live pipeline and the rebuild
// both call this, so "rebuild equals stored" holds by construction.
export function tripDetailFromState(
  state: TripState,
  createdAt: string,
  ctx: ConflictContext = DEFAULT_CONFLICT_CONTEXT,
): TripDetail {
  const dayDates = deriveDayDates(state.startDate, state.days.length);
  const { dayCostSubtotals, unscheduledCostSubtotal, tripCostTotal } = rollupCosts(state);
  return {
    tripId: state.tripId,
    name: state.name,
    status: state.status,
    startDate: state.startDate,
    currency: state.currency,
    budget: state.budget,
    members: state.members,
    forkedFrom: state.forkedFrom,
    days: state.days.map((d, i) => ({
      dayId: d.dayId,
      activityIds: [...d.activityIds],
      date: dayDates[i]!,
      costSubtotal: dayCostSubtotals[i]!,
    })),
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
          kind: a.kind,
          tags: a.tags,
          cost: a.cost,
        },
      ]),
    ),
    conflicts: detectConflicts(state, ctx),
    dismissedConflictIds: [...state.dismissedConflictIds],
    createdAt,
    unscheduledCostSubtotal,
    tripCostTotal,
    budgetRemaining: state.budget ? state.budget.amountMinor - tripCostTotal : null,
  };
}

export function projectTripDetails(
  envelopes: EventEnvelope[],
  ctx: ConflictContext = DEFAULT_CONFLICT_CONTEXT,
): TripDetail[] {
  const streams = new Map<string, { state: TripState | null; createdAt: string }>();
  for (const env of envelopes) {
    const event = TripEvent.parse({ type: env.type, version: env.version, payload: env.payload });
    const entry = streams.get(env.streamId) ?? { state: null, createdAt: env.occurredAt };
    entry.state = evolveTrip(entry.state, event);
    streams.set(env.streamId, entry);
  }
  const details: TripDetail[] = [];
  for (const { state, createdAt } of streams.values()) {
    if (state !== null) details.push(tripDetailFromState(state, createdAt, ctx));
  }
  return details;
}
