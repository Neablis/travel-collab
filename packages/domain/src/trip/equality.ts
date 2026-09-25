import type { ActivityTag, Anchor, Location, Money, PostalAddress, TimeWindow } from "@tc/contracts";
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

// Member-id lists compare POSITIONALLY, for the reason stated above `sameTags`
// and not because participants are "really" ordered: the update snapshot keeps
// whatever order the command supplied, and `diff` compares the two states
// positionally. Set semantics here would make a reorder equal-but-different —
// this function reporting no change while `diff` shows one — which is a worse
// answer than treating the stored order as the stored order.
function sameIdList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

// `lines` order is significant — it is the street-level part in the country's
// own order, so ["Apt 4", "5 High St"] and ["5 High St", "Apt 4"] are different
// addresses. Compared positionally, like anchors and tags.
function sameAddress(a: PostalAddress | undefined, b: PostalAddress | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return (
    a.countryCode === b.countryCode &&
    sameList(a.lines, b.lines) &&
    a.dependentLocality === b.dependentLocality &&
    a.locality === b.locality &&
    a.administrativeArea === b.administrativeArea &&
    a.postalCode === b.postalCode
  );
}

function sameTimeWindow(a: TimeWindow | null, b: TimeWindow | null): boolean {
  if (a === null || b === null) return a === b;
  return a.start === b.start && a.end === b.end;
}

// Location is compared FIELD BY FIELD, not deep-equal, so every field the
// contract grows has to be added here or diff() silently treats a change to it
// as a no-op and revert/undo quietly keeps the old value. `area` was added for
// exactly that reason (KI-35) — and `city` and `countryCode` were found missing
// in the same breath (KI-54, CodeRabbit on #72). This list is now every
// persisted field of Location; if you add one to the contract, add it here in
// the same commit. `precision` is the latest, and it is the one where
// forgetting would be least visible: two locations identical but for their
// granularity would compare equal, so re-geocoding a stop from a city centroid
// up to a real venue fix would be rejected as a no-op — the exact shape of
// KI-54, one field later. `address` (compared by `sameAddress`) is the one
// after that, and it is nested rather than scalar — correcting a street number
// changes nothing else about the stop, not even its coordinates, so no other
// comparison here can stand in for it.
function sameLocation(a: Location | null, b: Location | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.name === b.name &&
    a.lat === b.lat &&
    a.lng === b.lng &&
    a.city === b.city &&
    a.countryCode === b.countryCode &&
    a.area === b.area &&
    a.precision === b.precision &&
    sameAddress(a.address, b.address)
  );
}

// One comparator per field of the contract's `ActivitySnapshot`, keyed by the
// mapped type rather than written as a boolean chain. What that buys: a field
// added to the contract is a MISSING-KEY COMPILE ERROR here, instead of an edit
// this function silently reports as a no-op. It is load-bearing structure, not
// a style choice — KI-2026-09-05-o, filed after the same hole shipped three
// times (KI-1, KI-54, and M18's editor sheet dropping `kind`/`tags`).
const FIELD_EQUAL: { [K in keyof ActivityState]: (a: ActivityState[K], b: ActivityState[K]) => boolean } = {
  title: (a, b) => a === b,
  timeWindow: sameTimeWindow,
  location: sameLocation,
  notes: (a, b) => a === b,
  anchors: sameAnchors,
  kind: (a, b) => a === b,
  tags: sameTags,
  cost: moneyEqual,
  // M13 link 5. `bookedBy` is one id or nobody; `participants` compares
  // positionally, the same rule `tags` and `anchors` already follow.
  bookedBy: (a, b) => a === b,
  participants: sameIdList,
  // M24. `endLocation` is a Location like any other, so it compares field by
  // field through `sameLocation` — an endLocation-only edit is an edit.
  mode: (a, b) => a === b,
  endLocation: sameLocation,
};

const ACTIVITY_FIELDS = Object.keys(FIELD_EQUAL) as (keyof ActivityState)[];

function fieldEqual<K extends keyof ActivityState>(field: K, a: ActivityState, b: ActivityState): boolean {
  return FIELD_EQUAL[field](a[field], b[field]);
}

export function activityStatesEqual(a: ActivityState, b: ActivityState): boolean {
  return ACTIVITY_FIELDS.every((field) => fieldEqual(field, a, b));
}

function daysEqual(a: readonly DayState[], b: readonly DayState[]): boolean {
  return (
    a.length === b.length &&
    a.every((d, i) => d.dayId === b[i]!.dayId && sameList(d.activityIds, b[i]!.activityIds))
  );
}

function lineageEqual(a: TripState["forkedFrom"], b: TripState["forkedFrom"]): boolean {
  if (a === null || b === null) return a === b;
  return a.tripId === b.tripId && a.atSeq === b.atSeq && a.name === b.name;
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
  // Lineage is genesis-only and immutable, so two states of ONE stream can
  // never differ here — but tripStatesEqual is also what the rebuild golden
  // test compares stored against replayed, and a field replay dropped would
  // otherwise pass silently. That is the exact species of hole AGENTS.md's
  // "if a comment asserts an invariant, a test enforces it" rule is about.
  if (!lineageEqual(a.forkedFrom, b.forkedFrom)) return false;
  if (!daysEqual(a.days, b.days) || !sameList(a.backlog, b.backlog)) return false;
  if (!sameList(a.dismissedConflictIds, b.dismissedConflictIds)) return false;
  const aIds = Object.keys(a.activities).sort();
  const bIds = Object.keys(b.activities).sort();
  if (!sameList(aIds, bIds)) return false;
  return aIds.every((id) => activityStatesEqual(a.activities[id]!, b.activities[id]!));
}
