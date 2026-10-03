import type { BatchableCommand } from "@tc/contracts";

// Which changes of one suggestion need another accepted first (spec W9).
//
// A suggester's draft is predicted against the trip they saw, so a later unit
// can name a day or stop an earlier unit of the same draft created — and that
// id exists nowhere until the earlier change is accepted. Only within one
// suggestion: ghosts are not editable, so a draft cannot name an id another
// suggestion created.
//
// Pure, and computed once at creation; the stored `depends_on` is what accept
// and the dismiss cascade read.

/** The day and stop ids a unit brings into existence. */
export function createdIds(unit: readonly BatchableCommand[]): Set<string> {
  const ids = new Set<string>();
  for (const command of unit) {
    switch (command.type) {
      case "AddDay":
        ids.add(command.dayId);
        break;
      case "AddActivity":
        ids.add(command.activityId);
        break;
      case "SetTripDates":
        for (const id of command.newDayIds) ids.add(id);
        break;
      default:
        break;
    }
  }
  return ids;
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
 * For each unit, the indices of the EARLIER units whose created ids it
 * references, ascending. Direct dependencies only; the cascade walks them.
 */
export function dependsOn(units: readonly (readonly BatchableCommand[])[]): number[][] {
  const created = units.map(createdIds);
  return units.map((unit, i) => {
    const referenced = referencedIds(unit);
    const deps: number[] = [];
    for (let j = 0; j < i; j++) {
      if ([...created[j]!].some((id) => referenced.has(id))) deps.push(j);
    }
    return deps;
  });
}
