import {
  PageEvent as PageEventSchema,
  TripEvent as TripEventSchema,
  isPageEventType,
  type EventEnvelope,
  type PageEvent,
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
import { evolvePages, type PagesState } from "./pageState";
import type { TripState } from "./state";

/**
 * The trip aggregate, folded from a stream that also carries page events.
 *
 * **The skip is BY NAME, and that is the whole care here.** This fold used to
 * parse every envelope as a `TripEvent`, which is what made a corrupt stream
 * fail loudly rather than fold to a plausible wrong state — the guarantee
 * `evolve.ts`'s `requireDay` comment defends. Notebook pages now live in this
 * same stream as a second aggregate (`pageState.ts`), so this has to step over
 * their events; stepping over *anything that fails to parse* would have thrown
 * that guarantee away to buy it. An envelope belonging to neither aggregate
 * still reaches `TripEventSchema.parse` and still throws.
 */
export function foldEnvelopes(envelopes: EventEnvelope[], toSeq?: number): TripState | null {
  let state: TripState | null = null;
  for (const env of envelopes) {
    if (toSeq !== undefined && env.seq > toSeq) break;
    if (isPageEventType(env.type)) continue;
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
  /**
   * The page aggregate's events from the same batch.
   *
   * Separate from `events` rather than a widened union, so every existing
   * reader of `batch.events` keeps its exhaustive `TripEvent` switch and is
   * not silently handed a shape it has no case for.
   *
   * **A batch of ONLY page events is still a batch** — it has a batchId and an
   * origin, so the history panel can describe it. It is deliberately NOT
   * undoable: `deriveUndoRedo` skips any batch with no trip events, and the
   * comment there says why stacking one wedges undo entirely.
   */
  pageEvents: PageEvent[];
};

// Envelopes arrive seq-ordered; a batch is a contiguous run sharing a batchId
// (batchIds are per-command uuids, so equal-and-adjacent means same command).
export function groupBatches(envelopes: EventEnvelope[]): Batch[] {
  const batches: Batch[] = [];
  for (const env of envelopes) {
    const page = isPageEventType(env.type);
    const parsed = page
      ? PageEventSchema.parse({ type: env.type, version: env.version, payload: env.payload })
      : TripEventSchema.parse({ type: env.type, version: env.version, payload: env.payload });
    const last = batches[batches.length - 1];
    if (last !== undefined && last.batchId === env.batchId) {
      last.toSeq = env.seq;
      if (page) last.pageEvents.push(parsed as PageEvent);
      else last.events.push(parsed as TripEvent);
    } else {
      batches.push({
        batchId: env.batchId,
        origin: env.origin,
        fromSeq: env.seq,
        toSeq: env.seq,
        actorId: env.actorId,
        occurredAt: env.occurredAt,
        events: page ? [] : [parsed as TripEvent],
        pageEvents: page ? [parsed as PageEvent] : [],
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
    // **A batch with no trip events never enters the stack.** Today that means
    // a page-only batch — a notebook save. Stacking one makes undo STUCK, not
    // merely ineffective: `foldEnvelopes` skips page events, so undoing to just
    // before the batch yields an empty trip diff, `decideHistoryCommand`
    // rejects `nothing-to-undo`, and nothing is popped. Press undo again and it
    // picks the same batch forever, with every earlier itinerary change
    // unreachable behind it.
    //
    // So a notebook edit is not undoable yet. Making it undoable means the
    // history decision carrying `PageEvent[]` alongside `TripEvent[]`, which is
    // `KI-2026-09-22-c` — open because the naive version emits `PageDeleted`
    // for every notebook when a trip is reverted behind a backfilled genesis.
    // Not-undoable is the smaller cost, and it is reversible.
    if (batch.events.length === 0) continue;
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
      // Checked before `nothing-to-undo`: a caller that named a batch is told
      // its batch is no longer on top — including when it was already undone
      // — not that the trip as a whole has nothing left.
      if (command.undoesBatchId !== undefined && targets.undo?.batchId !== command.undoesBatchId) {
        return rejectHistory(
          "undo-target-changed",
          "This trip has changed since. Undo it from History instead.",
        );
      }
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

/**
 * One page event in words, using the page state from BEFORE the batch.
 *
 * Before, not after, for the same reason `describeUserBatch` reads the trip
 * state before: a deletion has to name the page it removed, and after the
 * event there is nothing left to name.
 */
function describePageEvent(pagesBefore: PagesState, event: PageEvent): string {
  switch (event.type) {
    case "PageCreated":
      return `Added the notebook "${event.payload.title}"`;
    case "PageDeleted":
      return `Deleted the notebook "${pagesBefore[event.payload.pageId]?.title ?? "a notebook"}"`;
    case "PageEdited": {
      // A rename says so; a content edit names the page. Both read off the
      // title BEFORE this event, so "Renamed X to Y" is true in both halves.
      const before = pagesBefore[event.payload.pageId]?.title ?? "a notebook";
      if (event.payload.title !== undefined && event.payload.title !== before) {
        return `Renamed "${before}" to "${event.payload.title}"`;
      }
      return `Edited "${before}"`;
    }
  }
}

function describePageBatch(pagesBefore: PagesState, events: PageEvent[]): string {
  const first = events[0];
  if (first === undefined) return "Changed this trip";
  if (events.length === 1) return describePageEvent(pagesBefore, first);
  // More than one page event in one batch only happens on undo/redo/revert,
  // which have their own wording below, and on a backfill. Naming the count is
  // honest and does not pretend to summarise documents.
  return `${describePageEvent(pagesBefore, first)} and ${events.length - 1} more notebook change${
    events.length - 1 === 1 ? "" : "s"
  }`;
}

function describeBatch(
  stateBefore: TripState | null,
  pagesBefore: PagesState,
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
      // **A batch is one aggregate's or the other's, never both**, because a
      // command targets one of them. The trip's events win the tie only so
      // that a future batched command carrying both still reads as a trip
      // change rather than silently losing its notebook half.
      return batch.events.length > 0
        ? describeUserBatch(stateBefore, batch.events)
        : describePageBatch(pagesBefore, batch.pageEvents);
  }
}

// Oldest first (natural log order); the API layer reverses for display.
export function buildHistoryEntries(envelopes: EventEnvelope[]): HistoryEntry[] {
  const batches = groupBatches(envelopes);
  const undoneSet = new Set(deriveUndoRedo(batches).undoneBatchIds);
  const descriptions = new Map<string, string>();
  const entries: HistoryEntry[] = [];
  let state: TripState | null = null;
  // Folded alongside the trip state, and for one reason: a page event's
  // description needs the page's TITLE, which lives in the page aggregate.
  // Rebuilding it per entry would be quadratic over the stream.
  let pages: PagesState = {};
  for (const batch of batches) {
    const description = describeBatch(state, pages, batch, descriptions);
    descriptions.set(batch.batchId, description);
    for (const event of batch.events) state = evolveTrip(state, event);
    for (const event of batch.pageEvents) pages = evolvePages(pages, event);
    // One page and only one: a batch touching two pages has no single subject,
    // and a batch with trip events in it is a trip change that happens to carry
    // a page event. Both fall through to `undefined`, which the panel reads as
    // "do not group this".
    const pageIds = new Set(batch.pageEvents.map((e) => e.payload.pageId));
    const pageId =
      batch.events.length === 0 && pageIds.size === 1 ? [...pageIds][0] : undefined;
    entries.push({
      batchId: batch.batchId,
      fromSeq: batch.fromSeq,
      toSeq: batch.toSeq,
      actorId: batch.actorId,
      occurredAt: batch.occurredAt,
      origin: batch.origin,
      description,
      undone: undoneSet.has(batch.batchId),
      ...(pageId === undefined ? {} : { pageId }),
    });
  }
  return entries;
}
