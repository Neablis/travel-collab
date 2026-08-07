import {
  TripEvent as TripEventSchema,
  type EventEnvelope,
  type HistoryEntry,
  type Origin,
  type RedoChange,
  type RevertToState,
  type TripEvent,
  type UndoLastChange,
} from "@tc/contracts";
import type { Rejection } from "./decide";
import { diffTripStates } from "./diff";
import { evolveTrip } from "./evolve";
import type { TripState } from "./state";

export function foldEnvelopes(envelopes: EventEnvelope[], toSeq?: number): TripState | null {
  let state: TripState | null = null;
  for (const env of envelopes) {
    if (toSeq !== undefined && env.seq > toSeq) break;
    state = evolveTrip(
      state,
      TripEventSchema.parse({ type: env.type, version: env.version, payload: env.payload }),
    );
  }
  return state;
}

export type Batch = {
  batchId: string;
  origin: Origin;
  fromSeq: number;
  toSeq: number;
  actorId: string;
  occurredAt: string;
  events: TripEvent[];
};

// Envelopes arrive seq-ordered; a batch is a contiguous run sharing a batchId
// (batchIds are per-command uuids, so equal-and-adjacent means same command).
export function groupBatches(envelopes: EventEnvelope[]): Batch[] {
  const batches: Batch[] = [];
  for (const env of envelopes) {
    const event = TripEventSchema.parse({ type: env.type, version: env.version, payload: env.payload });
    const last = batches[batches.length - 1];
    if (last !== undefined && last.batchId === env.batchId) {
      last.toSeq = env.seq;
      last.events.push(event);
    } else {
      batches.push({
        batchId: env.batchId,
        origin: env.origin,
        fromSeq: env.seq,
        toSeq: env.seq,
        actorId: env.actorId,
        occurredAt: env.occurredAt,
        events: [event],
      });
    }
  }
  return batches;
}

export type UndoRedoTargets = {
  undo: { batchId: string; targetSeq: number } | null;
  redo: { batchId: string; targetSeq: number } | null;
  undoneBatchIds: string[];
};

// Standard editor stack semantics, derived purely from provenance:
// user/revert batches push onto the done stack and clear the redo stack;
// an undo moves the top of done onto the redo stack; a redo moves it back.
// Every batch is state-changing (decide's no-op guard), so this bookkeeping
// mirrors state exactly. The creation batch is never undoable.
export function deriveUndoRedo(batches: Batch[]): UndoRedoTargets {
  const done: Batch[] = [];
  const undone: Batch[] = [];
  for (const batch of batches) {
    switch (batch.origin.kind) {
      case "user":
      case "revert":
        done.push(batch);
        undone.length = 0;
        break;
      case "undo": {
        const popped = done.pop();
        if (popped !== undefined) undone.push(popped);
        break;
      }
      case "redo": {
        const popped = undone.pop();
        if (popped !== undefined) done.push(popped);
        break;
      }
    }
  }
  const top = done[done.length - 1];
  const redoTop = undone[undone.length - 1];
  return {
    // undoing batch B = revert to the state just before B first applied
    undo: top !== undefined && top !== batches[0] ? { batchId: top.batchId, targetSeq: top.fromSeq - 1 } : null,
    // redoing batch B = revert to the state just after B first applied
    redo: redoTop !== undefined ? { batchId: redoTop.batchId, targetSeq: redoTop.toSeq } : null,
    undoneBatchIds: undone.map((b) => b.batchId),
  };
}

export type HistoryCommand = UndoLastChange | RedoChange | RevertToState;
export type HistoryDecision =
  | { ok: true; events: TripEvent[]; origin: Origin }
  | { ok: false; rejection: Rejection };

function rejectHistory(code: string, message: string): HistoryDecision {
  return { ok: false, rejection: { code, message } };
}

export function decideHistoryCommand(
  envelopes: EventEnvelope[],
  command: HistoryCommand,
): HistoryDecision {
  const current = foldEnvelopes(envelopes);
  if (current === null) return rejectHistory("trip-not-found", "This trip does not exist.");
  const targets = deriveUndoRedo(groupBatches(envelopes));

  switch (command.type) {
    case "UndoLastChange": {
      if (targets.undo === null) return rejectHistory("nothing-to-undo", "There is nothing to undo.");
      const target = foldEnvelopes(envelopes, targets.undo.targetSeq);
      if (target === null) return rejectHistory("nothing-to-undo", "There is nothing to undo.");
      const events = diffTripStates(current, target);
      if (events.length === 0) return rejectHistory("nothing-to-undo", "There is nothing to undo.");
      return { ok: true, events, origin: { kind: "undo", undoesBatchId: targets.undo.batchId } };
    }
    case "RedoChange": {
      if (targets.redo === null) return rejectHistory("nothing-to-redo", "There is nothing to redo.");
      const target = foldEnvelopes(envelopes, targets.redo.targetSeq);
      if (target === null) return rejectHistory("nothing-to-redo", "There is nothing to redo.");
      const events = diffTripStates(current, target);
      if (events.length === 0) return rejectHistory("nothing-to-redo", "There is nothing to redo.");
      return { ok: true, events, origin: { kind: "redo", redoesBatchId: targets.redo.batchId } };
    }
    case "RevertToState": {
      const head = envelopes[envelopes.length - 1]?.seq ?? 0;
      if (command.toSeq > head) {
        return rejectHistory("invalid-revert-target", "That version does not exist.");
      }
      const target = foldEnvelopes(envelopes, command.toSeq);
      if (target === null) return rejectHistory("invalid-revert-target", "That version does not exist.");
      const events = diffTripStates(current, target);
      if (events.length === 0) {
        return rejectHistory("already-at-that-state", "The trip already matches that version.");
      }
      return { ok: true, events, origin: { kind: "revert", toSeq: command.toSeq } };
    }
  }
}

// ---- Human-readable history ----

function dayLabel(state: TripState | null, dayId: string): string {
  const index = state?.days.findIndex((d) => d.dayId === dayId) ?? -1;
  return index === -1 ? "a removed day" : `Day ${index + 1}`;
}

// The description of a user batch: each event described against the state at the
// moment it applied, joined. Shared by the history read model and the client
// predictor so the text never drifts.
export function describeUserBatch(stateBefore: TripState | null, events: TripEvent[]): string {
  const parts: string[] = [];
  let state = stateBefore;
  for (const event of events) {
    parts.push(describeEvent(state, event));
    state = evolveTrip(state, event);
  }
  return parts.join("; ");
}

// `state` is the state BEFORE the event — names resolve even when a payload
// carries only ids (e.g. ActivityMoved).
function describeEvent(state: TripState | null, event: TripEvent): string {
  switch (event.type) {
    case "TripCreated":
      return `Created trip "${event.payload.name}"`;
    case "DayAdded":
      return `Added Day ${(state?.days.length ?? 0) + 1}`;
    case "DayRemoved":
      return `Removed ${dayLabel(state, event.payload.dayId)}`;
    case "TripStartDateSet":
      return event.payload.startDate === null
        ? "Cleared the start date"
        : `Set the start date to ${event.payload.startDate}`;
    case "TripCurrencySet":
      return `Set the trip currency to ${event.payload.currency}`;
    case "TripBudgetSet":
      return event.payload.budget === null
        ? "Cleared the budget"
        : `Set the budget to ${(event.payload.budget.amountMinor / 100).toFixed(2)} ${event.payload.budget.currency}`;
    case "ActivityAdded":
      return `Added "${event.payload.title}" to ${
        event.payload.dayId === null ? "the backlog" : dayLabel(state, event.payload.dayId)
      }`;
    case "ActivityUpdated":
      return `Edited "${event.payload.title}"`;
    case "ActivityMoved": {
      const title = state?.activities[event.payload.activityId]?.title ?? "an activity";
      return `Moved "${title}" to ${
        event.payload.toDayId === null ? "the backlog" : dayLabel(state, event.payload.toDayId)
      }`;
    }
    case "ActivityRemoved":
      return `Removed "${state?.activities[event.payload.activityId]?.title ?? "an activity"}"`;
    case "ConflictDismissed":
      return "Dismissed a conflict";
    case "ConflictUndismissed":
      return "Restored a conflict";
    case "TripNameSet":
      return `Renamed the trip to "${event.payload.name}"`;
    case "TripDeleted":
      return "Deleted the trip";
    case "TripRestored":
      return "Restored the trip";
  }
}

function describeBatch(
  stateBefore: TripState | null,
  batch: Batch,
  priorDescriptions: ReadonlyMap<string, string>,
): string {
  switch (batch.origin.kind) {
    case "undo":
      return `Undid: ${priorDescriptions.get(batch.origin.undoesBatchId) ?? "an earlier change"}`;
    case "redo":
      return `Redid: ${priorDescriptions.get(batch.origin.redoesBatchId) ?? "an earlier change"}`;
    case "revert":
      return `Reverted to version ${batch.origin.toSeq}`;
    case "user":
      return describeUserBatch(stateBefore, batch.events);
  }
}

// Oldest first (natural log order); the API layer reverses for display.
export function buildHistoryEntries(envelopes: EventEnvelope[]): HistoryEntry[] {
  const batches = groupBatches(envelopes);
  const undoneSet = new Set(deriveUndoRedo(batches).undoneBatchIds);
  const descriptions = new Map<string, string>();
  const entries: HistoryEntry[] = [];
  let state: TripState | null = null;
  for (const batch of batches) {
    const description = describeBatch(state, batch, descriptions);
    descriptions.set(batch.batchId, description);
    for (const event of batch.events) state = evolveTrip(state, event);
    entries.push({
      batchId: batch.batchId,
      fromSeq: batch.fromSeq,
      toSeq: batch.toSeq,
      actorId: batch.actorId,
      occurredAt: batch.occurredAt,
      origin: batch.origin,
      description,
      undone: undoneSet.has(batch.batchId),
    });
  }
  return entries;
}
