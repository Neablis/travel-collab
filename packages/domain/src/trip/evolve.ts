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
  }
}
