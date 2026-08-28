import type { ActivityTag, Anchor, Money } from "@tc/contracts";
import type { ActivityState, DayState, TripState } from "./state";

export function moneyEqual(a: Money | null, b: Money | null): boolean {
  if (a === null || b === null) return a === b;
  return a.amountMinor === b.amountMinor && a.currency === b.currency;
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

// Canonical string per anchor — order-insensitive within an anchor's own list
// fields, so equality doesn't spuriously fail on weekday ordering.
export function anchorKey(a: Anchor): string {
  switch (a.kind) {
    case "dayOfWeek": return `dow:${[...a.days].sort().join(",")}`;
    case "dateRange": return `range:${a.from}_${a.to}`;
    case "timeOfDay": return `tod:${a.window.start}-${a.window.end}`;
    case "publicHoliday": return `hol:${a.country}`;
  }
}

// Anchor LIST order is significant (the update snapshot preserves it), so we
// compare positionally by canonical key.
function sameAnchors(a: readonly Anchor[], b: readonly Anchor[]): boolean {
  return a.length === b.length && a.every((x, i) => anchorKey(x) === anchorKey(b[i]!));
}

// Tag LIST order is significant for the same reason anchor order is: the update
// snapshot preserves whatever order the command supplied, and diff compares the
// two states positionally.
function sameTags(a: readonly ActivityTag[], b: readonly ActivityTag[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

export function activityStatesEqual(a: ActivityState, b: ActivityState): boolean {
  return (
    a.title === b.title &&
    a.notes === b.notes &&
    (a.timeWindow === null) === (b.timeWindow === null) &&
    (a.timeWindow === null || (a.timeWindow.start === b.timeWindow!.start && a.timeWindow.end === b.timeWindow!.end)) &&
    (a.location === null) === (b.location === null) &&
    // Location is compared field by field, so every field the contract grows
    // has to be added here or diff() silently treats a change to it as a
    // no-op and revert/undo quietly keeps the old value. `area` is included
    // for exactly that reason (KI-35).
    (a.location === null ||
      (a.location.name === b.location!.name &&
        a.location.lat === b.location!.lat &&
        a.location.lng === b.location!.lng &&
        a.location.area === b.location!.area)) &&
    sameAnchors(a.anchors, b.anchors) &&
    a.kind === b.kind &&
    sameTags(a.tags, b.tags) &&
    moneyEqual(a.cost, b.cost)
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
  if (a.status !== b.status) return false;
  if (a.currency !== b.currency || !moneyEqual(a.budget, b.budget)) return false;
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
