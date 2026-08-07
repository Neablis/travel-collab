import type { TripEvent } from "@tc/contracts";
import type { TripState } from "./state";

function removeEverywhere(state: TripState, activityId: string): TripState {
  return {
    ...state,
    backlog: state.backlog.filter((id) => id !== activityId),
    days: state.days.map((d) => ({
      ...d,
      activityIds: d.activityIds.filter((id) => id !== activityId),
    })),
  };
}

function insertAt(list: string[], id: string, position: number): string[] {
  const next = [...list];
  next.splice(Math.max(0, Math.min(position, next.length)), 0, id);
  return next;
}

// Replay totality guard, same contract as the TripCreated check below: an
// activity event naming a day the state doesn't have cannot be interpreted.
// Absorbing it silently (the old behavior) left the activity in `activities`
// but in no list at all — invisible, unreachable, undeletable. A stream that
// cannot be interpreted must fail loudly, not fold to a plausible wrong state.
// `decideTripCommand` rejects these before they can be written, so reaching
// this means the log itself is corrupt.
function requireDay(state: TripState, dayId: string, eventType: string): void {
  if (!state.days.some((d) => d.dayId === dayId)) {
    throw new Error(`${eventType} references unknown day ${dayId} — corrupt stream`);
  }
}

export function evolveTrip(state: TripState | null, event: TripEvent): TripState {
  if (event.type === "TripCreated") {
    return {
      tripId: event.payload.tripId,
      name: event.payload.name,
      members: [{ userId: event.payload.createdBy, role: "owner" }],
      startDate: null,
      days: [],
      backlog: [],
      activities: {},
      dismissedConflictIds: [],
      currency: "USD",
      budget: null,
      status: "active",
    };
  }

  // Replay totality guard: a well-formed stream always starts with TripCreated.
  if (state === null) {
    throw new Error(`event ${event.type} arrived before TripCreated — corrupt stream`);
  }

  switch (event.type) {
    case "DayAdded":
      return {
        ...state,
        days: [...state.days, { dayId: event.payload.dayId, activityIds: [] }],
      };
    case "DayRemoved": {
      const day = state.days.find((d) => d.dayId === event.payload.dayId);
      return {
        ...state,
        days: state.days.filter((d) => d.dayId !== event.payload.dayId),
        backlog: [...state.backlog, ...(day?.activityIds ?? [])],
      };
    }
    case "TripStartDateSet":
      return { ...state, startDate: event.payload.startDate };
    case "TripCurrencySet":
      return { ...state, currency: event.payload.currency };
    case "TripBudgetSet":
      return { ...state, budget: event.payload.budget };
    case "ActivityAdded": {
      const { activityId, dayId, title, timeWindow, location, notes, anchors, cost } = event.payload;
      const next: TripState = {
        ...state,
        activities: {
          ...state.activities,
          [activityId]: { title, timeWindow, location, notes, anchors, cost },
        },
      };
      if (dayId === null) return { ...next, backlog: [...next.backlog, activityId] };
      requireDay(state, dayId, "ActivityAdded");
      return {
        ...next,
        days: next.days.map((d) =>
          d.dayId === dayId ? { ...d, activityIds: [...d.activityIds, activityId] } : d,
        ),
      };
    }
    case "ActivityUpdated": {
      const { activityId, title, timeWindow, location, notes, anchors, cost } = event.payload;
      return {
        ...state,
        activities: { ...state.activities, [activityId]: { title, timeWindow, location, notes, anchors, cost } },
      };
    }
    case "ActivityMoved": {
      const { activityId, toDayId, position } = event.payload;
      const removed = removeEverywhere(state, activityId);
      if (toDayId === null) {
        return { ...removed, backlog: insertAt(removed.backlog, activityId, position) };
      }
      requireDay(state, toDayId, "ActivityMoved");
      return {
        ...removed,
        days: removed.days.map((d) =>
          d.dayId === toDayId
            ? { ...d, activityIds: insertAt(d.activityIds, activityId, position) }
            : d,
        ),
      };
    }
    case "ActivityRemoved": {
      const removed = removeEverywhere(state, event.payload.activityId);
      const activities = { ...removed.activities };
      delete activities[event.payload.activityId];
      return { ...removed, activities };
    }
    case "ConflictDismissed": {
      const id = event.payload.conflictId;
      if (state.dismissedConflictIds.includes(id)) return state;
      return { ...state, dismissedConflictIds: [...state.dismissedConflictIds, id].sort() };
    }
    case "ConflictUndismissed":
      return {
        ...state,
        dismissedConflictIds: state.dismissedConflictIds.filter((id) => id !== event.payload.conflictId),
      };
    case "TripNameSet":
      return { ...state, name: event.payload.name };
    case "TripDeleted":
      return { ...state, status: "deleted" };
    case "TripRestored":
      return { ...state, status: "active" };
  }
}
