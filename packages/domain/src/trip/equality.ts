import type { ActivityState, DayState, TripState } from "./state";

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

export function activityStatesEqual(a: ActivityState, b: ActivityState): boolean {
  return (
    a.title === b.title &&
    a.notes === b.notes &&
    (a.timeWindow === null) === (b.timeWindow === null) &&
    (a.timeWindow === null || (a.timeWindow.start === b.timeWindow!.start && a.timeWindow.end === b.timeWindow!.end)) &&
    (a.location === null) === (b.location === null) &&
    (a.location === null ||
      (a.location.name === b.location!.name && a.location.lat === b.location!.lat && a.location.lng === b.location!.lng))
  );
}

function daysEqual(a: readonly DayState[], b: readonly DayState[]): boolean {
  return (
    a.length === b.length &&
    a.every((d, i) => d.dayId === b[i]!.dayId && sameList(d.activityIds, b[i]!.activityIds))
  );
}

// Structural equality over the whole planning state. Activity record KEY ORDER
// is deliberately ignored (replay and diff construct it in different orders);
// every list that carries meaning (days, activityIds, backlog, dismissals) is
// compared in order.
export function tripStatesEqual(a: TripState, b: TripState): boolean {
  if (a.tripId !== b.tripId || a.name !== b.name || a.startDate !== b.startDate) return false;
  if (
    a.members.length !== b.members.length ||
    !a.members.every((m, i) => m.userId === b.members[i]!.userId && m.role === b.members[i]!.role)
  ) {
    return false;
  }
  if (!daysEqual(a.days, b.days) || !sameList(a.backlog, b.backlog)) return false;
  if (!sameList(a.dismissedConflictIds, b.dismissedConflictIds)) return false;
  const aIds = Object.keys(a.activities).sort();
  const bIds = Object.keys(b.activities).sort();
  if (!sameList(aIds, bIds)) return false;
  return aIds.every((id) => activityStatesEqual(a.activities[id]!, b.activities[id]!));
}
