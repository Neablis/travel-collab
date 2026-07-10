import type { CreateTrip, TripCommand, TripEvent } from "@tc/contracts";
import { detectConflicts } from "./conflicts";
import { tripStatesEqual } from "./equality";
import { evolveTrip } from "./evolve";
import type { TripState } from "./state";

export type Rejection = { code: string; message: string };
export type Decision =
  | { ok: true; events: TripEvent[] }
  | { ok: false; rejection: Rejection };

export type DecideContext = { actorId: string };

function ok(events: TripEvent[]): Decision {
  return { ok: true, events };
}

function reject(code: string, message: string): Decision {
  return { ok: false, rejection: { code, message } };
}

function okUnlessNoOp(state: TripState, events: TripEvent[]): Decision {
  let next = state;
  for (const event of events) next = evolveTrip(next, event);
  if (tripStatesEqual(next, state)) {
    return reject("no-op", "This change would have no effect.");
  }
  return ok(events);
}

export function decideCreateTrip(
  state: TripState | null,
  command: CreateTrip,
  ctx: DecideContext,
): Decision {
  if (state !== null) {
    return reject("trip-already-exists", "A trip with this id already exists.");
  }
  return ok([
    {
      type: "TripCreated",
      version: 1,
      payload: {
        tripId: command.tripId,
        name: command.name,
        createdBy: ctx.actorId,
      },
    },
  ]);
}

export function decideTripCommand(
  state: TripState | null,
  command: TripCommand,
  ctx: DecideContext,
): Decision {
  if (command.type === "CreateTrip") return decideCreateTrip(state, command, ctx);
  if (state === null) return reject("trip-not-found", "This trip does not exist.");

  if (
    command.type === "UndoLastChange" ||
    command.type === "RedoChange" ||
    command.type === "RevertToState"
  ) {
    return reject("history-command", "History commands are decided by decideHistoryCommand.");
  }

  switch (command.type) {
    case "AddDay":
      if (state.days.some((d) => d.dayId === command.dayId)) {
        return reject("day-already-exists", "A day with this id already exists.");
      }
      return ok([
        { type: "DayAdded", version: 1, payload: { tripId: command.tripId, dayId: command.dayId } },
      ]);
    case "RemoveDay":
      if (!state.days.some((d) => d.dayId === command.dayId)) {
        return reject("day-not-found", "This day does not exist.");
      }
      return ok([
        { type: "DayRemoved", version: 1, payload: { tripId: command.tripId, dayId: command.dayId } },
      ]);
    case "SetTripStartDate":
      return okUnlessNoOp(state, [
        {
          type: "TripStartDateSet",
          version: 1,
          payload: { tripId: command.tripId, startDate: command.startDate },
        },
      ]);
    case "AddActivity": {
      if (state.activities[command.activityId] !== undefined) {
        return reject("activity-already-exists", "An activity with this id already exists.");
      }
      if (command.dayId !== undefined && !state.days.some((d) => d.dayId === command.dayId)) {
        return reject("day-not-found", "This day does not exist.");
      }
      return ok([
        {
          type: "ActivityAdded",
          version: 1,
          payload: {
            tripId: command.tripId,
            activityId: command.activityId,
            dayId: command.dayId ?? null,
            title: command.title,
            timeWindow: command.timeWindow ?? null,
            location: command.location ?? null,
            notes: command.notes ?? null,
            anchors: command.anchors ?? [],
          },
        },
      ]);
    }
    case "UpdateActivity": {
      const current = state.activities[command.activityId];
      if (current === undefined) {
        return reject("activity-not-found", "This activity does not exist.");
      }
      // Omitted = unchanged, null = cleared; the event snapshots the result.
      return okUnlessNoOp(state, [
        {
          type: "ActivityUpdated",
          version: 1,
          payload: {
            tripId: command.tripId,
            activityId: command.activityId,
            title: command.title ?? current.title,
            timeWindow: command.timeWindow === undefined ? current.timeWindow : command.timeWindow,
            location: command.location === undefined ? current.location : command.location,
            notes: command.notes === undefined ? current.notes : command.notes,
            anchors: command.anchors === undefined ? current.anchors : command.anchors,
          },
        },
      ]);
    }
    case "MoveActivity":
      if (state.activities[command.activityId] === undefined) {
        return reject("activity-not-found", "This activity does not exist.");
      }
      if (command.toDayId !== null && !state.days.some((d) => d.dayId === command.toDayId)) {
        return reject("day-not-found", "This day does not exist.");
      }
      return okUnlessNoOp(state, [
        {
          type: "ActivityMoved",
          version: 1,
          payload: {
            tripId: command.tripId,
            activityId: command.activityId,
            toDayId: command.toDayId,
            position: command.position,
          },
        },
      ]);
    case "RemoveActivity":
      if (state.activities[command.activityId] === undefined) {
        return reject("activity-not-found", "This activity does not exist.");
      }
      return ok([
        {
          type: "ActivityRemoved",
          version: 1,
          payload: { tripId: command.tripId, activityId: command.activityId },
        },
      ]);
    case "DismissConflict": {
      if (!detectConflicts(state).some((c) => c.id === command.conflictId)) {
        return reject("conflict-not-found", "This conflict is not currently active.");
      }
      if (state.dismissedConflictIds.includes(command.conflictId)) {
        return reject("conflict-already-dismissed", "This conflict is already dismissed.");
      }
      return ok([
        {
          type: "ConflictDismissed",
          version: 1,
          payload: { tripId: command.tripId, conflictId: command.conflictId },
        },
      ]);
    }
  }
}
