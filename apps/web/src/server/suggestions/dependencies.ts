import type { BatchableCommand, TripEvent } from "@tc/contracts";

// Which changes of one suggestion need another accepted first (spec W9, W56).
//
// A suggester's draft is predicted against the trip they saw, so a later unit
// can name a day or stop an earlier unit of the same draft created — and that
// id exists nowhere until the earlier change is accepted. Only within one
// suggestion: ghosts are not editable, so a draft cannot name an id another
// suggestion created.
//
// What a unit created is read from its dry run's EVENTS, never from its
// commands' fields: `SetTripDates.newDayIds` is a pool the decider takes only
// the prefix it needs from — none at all for a start-only change — so an id in
// it may be created, or may name a day that already exists (review of #308).
//
// Pure, and computed once at creation; the stored `depends_on` is what accept
// and the dismiss cascade read.

/** What a unit's dry run did that a later unit of the same draft can build on. */
export type UnitEffect = {
  /** The day and stop ids the unit brought into existence. */
  created: ReadonlySet<string>;
  /** Whether it added or removed a day. */
  changedDayCount: boolean;
};

/** A unit's {@link UnitEffect}, from the events its dry run decided. */
export function effectOf(events: readonly TripEvent[]): UnitEffect {
  const created = new Set<string>();
  let changedDayCount = false;
  for (const event of events) {
    if (event.type === "DayAdded") created.add(event.payload.dayId);
    if (event.type === "ActivityAdded") created.add(event.payload.activityId);
    if (event.type === "DayAdded" || event.type === "DayRemoved") changedDayCount = true;
  }
  return { created, changedDayCount };
}

/**
 * The day and stop ids a unit acts on without creating them. Exhaustive, so a
 * new batchable command that targets a day or stop fails to compile here
 * instead of silently depending on nothing.
 */
export function referencedIds(unit: readonly BatchableCommand[]): Set<string> {
  const ids = new Set<string>();
  for (const command of unit) {
    switch (command.type) {
      case "RemoveDay":
        ids.add(command.dayId);
        break;
      case "AddActivity":
        if (command.dayId !== undefined) ids.add(command.dayId);
        break;
      case "UpdateActivity":
      case "RemoveActivity":
        ids.add(command.activityId);
        break;
      case "MoveActivity":
        ids.add(command.activityId);
        if (command.toDayId !== null) ids.add(command.toDayId);
        break;
      case "AddDay":
      case "SetTripDates":
      case "SetTripStartDate":
      case "SetTripName":
      case "SetTripCurrency":
      case "SetTripBudget":
      case "DismissConflict":
        break;
      default: {
        const unhandled: never = command;
        throw new Error(`referencedIds: unhandled command ${JSON.stringify(unhandled)}`);
      }
    }
  }
  return ids;
}

/**
 * A range edit — `SetTripDates` with an end date — is decided against the
 * trip's day count: it adds or removes the difference, taking new ids from its
 * pool. Accepted before an earlier unit that changed the count, it would find
 * a different count than its dry run did, and need ids it was not given.
 */
function isRangeEdit(unit: readonly BatchableCommand[]): boolean {
  return unit.some((c) => c.type === "SetTripDates" && c.endDate !== null);
}

/**
 * For each unit, the indices of the EARLIER units it builds on, ascending: one
 * that created an id it references, and — for a range edit — one that changed
 * the day count. Direct dependencies only; the cascade walks them.
 */
export function dependsOn(
  units: readonly { commands: readonly BatchableCommand[]; effect: UnitEffect }[],
): number[][] {
  return units.map(({ commands }, i) => {
    const referenced = referencedIds(commands);
    const rangeEdit = isRangeEdit(commands);
    const deps: number[] = [];
    for (let j = 0; j < i; j++) {
      const { effect } = units[j]!;
      if ((rangeEdit && effect.changedDayCount) || [...effect.created].some((id) => referenced.has(id))) deps.push(j);
    }
    return deps;
  });
}
