import type { TripEvent } from "@tc/contracts";
import { tripStatesEqual, activityStatesEqual } from "./equality";
import { evolveTrip } from "./evolve";
import type { TripState } from "./state";

// Compensating-events workhorse (ADR-005): emit ordinary domain events that
// transform `current` into `target`. Undo, redo, and revert are all "diff to a
// replayed past state". Correctness contract (property-tested): applying the
// returned events to `current` yields a state structurally equal to `target`.
// Minimality is NOT required — but every returned event changes state (the
// push() simulation drops no-ops), so an empty result means current == target.
//
// Precondition: same stream — tripId/name/members never differ between two
// states of one trip (no rename/membership commands exist in Phase 1).
export function diffTripStates(current: TripState, target: TripState): TripEvent[] {
  const events: TripEvent[] = [];
  let working = current;
  const push = (event: TripEvent): void => {
    const next = evolveTrip(working, event);
    if (!tripStatesEqual(next, working)) {
      events.push(event);
      working = next;
    }
  };

  // 1. Start date.
  if (working.startDate !== target.startDate) {
    push({
      type: "TripStartDateSet",
      version: 1,
      payload: { tripId: target.tripId, startDate: target.startDate },
    });
  }

  // 2. Activities that no longer exist in the target.
  for (const id of Object.keys(working.activities)) {
    if (target.activities[id] === undefined) {
      push({ type: "ActivityRemoved", version: 1, payload: { tripId: target.tripId, activityId: id } });
    }
  }

  // 3. Day reconciliation. DayAdded can only APPEND, and ordinals are derived
  //    from array position, so day order matters. Both states' day lists
  //    preserve the stream's original append order; the only order breaker is
  //    a day that must be re-created mid-list. From the first such day onward,
  //    every surviving day is removed and re-appended in target order.
  //    (DayRemoved sends its activities to the backlog; step 5 re-places them.)
  const targetDayIds = new Set(target.days.map((d) => d.dayId));
  for (const day of working.days) {
    if (!targetDayIds.has(day.dayId)) {
      push({ type: "DayRemoved", version: 1, payload: { tripId: target.tripId, dayId: day.dayId } });
    }
  }
  const survivorIds = new Set(working.days.filter((d) => targetDayIds.has(d.dayId)).map((d) => d.dayId));
  const firstMissing = target.days.findIndex((d) => !survivorIds.has(d.dayId));
  if (firstMissing !== -1) {
    for (const day of target.days.slice(firstMissing)) {
      if (survivorIds.has(day.dayId)) {
        push({ type: "DayRemoved", version: 1, payload: { tripId: target.tripId, dayId: day.dayId } });
      }
    }
    for (const day of target.days.slice(firstMissing)) {
      push({ type: "DayAdded", version: 1, payload: { tripId: target.tripId, dayId: day.dayId } });
    }
  }

  // 4. Activities that exist only in the target: add to the backlog (full
  //    target field set); step 5 puts every activity in its final place.
  for (const [id, a] of Object.entries(target.activities)) {
    if (working.activities[id] === undefined) {
      push({
        type: "ActivityAdded",
        version: 1,
        payload: {
          tripId: target.tripId,
          activityId: id,
          dayId: null,
          title: a.title,
          timeWindow: a.timeWindow,
          location: a.location,
          notes: a.notes,
          anchors: a.anchors,
          cost: a.cost,
        },
      });
    }
  }

  // 5. Field changes: full-snapshot update (ActivityUpdated replay semantics).
  for (const [id, a] of Object.entries(target.activities)) {
    const w = working.activities[id];
    if (w !== undefined && !activityStatesEqual(w, a)) {
      push({
        type: "ActivityUpdated",
        version: 1,
        payload: {
          tripId: target.tripId,
          activityId: id,
          title: a.title,
          timeWindow: a.timeWindow,
          location: a.location,
          notes: a.notes,
          anchors: a.anchors,
          cost: a.cost,
        },
      });
    }
  }

  // 6. Placement: rebuild every list in target order. Moving ids to positions
  //    0,1,2,… makes each list's prefix exactly match the target as we go;
  //    push() drops the moves that are already in place.
  for (const day of target.days) {
    day.activityIds.forEach((id, position) => {
      push({
        type: "ActivityMoved",
        version: 1,
        payload: { tripId: target.tripId, activityId: id, toDayId: day.dayId, position },
      });
    });
  }
  target.backlog.forEach((id, position) => {
    push({
      type: "ActivityMoved",
      version: 1,
      payload: { tripId: target.tripId, activityId: id, toDayId: null, position },
    });
  });

  // 7. Dismissals.
  for (const id of working.dismissedConflictIds) {
    if (!target.dismissedConflictIds.includes(id)) {
      push({ type: "ConflictUndismissed", version: 1, payload: { tripId: target.tripId, conflictId: id } });
    }
  }
  for (const id of target.dismissedConflictIds) {
    if (!working.dismissedConflictIds.includes(id)) {
      push({ type: "ConflictDismissed", version: 1, payload: { tripId: target.tripId, conflictId: id } });
    }
  }

  return events;
}
