import type { ActivitySnapshot, Money, TripLineage, TripMember, TripStatus } from "@tc/contracts";

// The canonical stored field set, not a second copy of it (KI-2026-09-05-o).
// `z.infer` is the OUTPUT type, so the contract's `.default()`s resolve to
// non-optional here: `kind` is an ActivityKind and never null, `tags` an
// array and never null — the two facts the hand-written version used to carry
// as trailing comments, now enforced by the schema they were describing.
export type ActivityState = ActivitySnapshot;

export type DayState = {
  dayId: string;
  activityIds: string[];
};

export type TripState = {
  tripId: string;
  name: string;
  members: TripMember[];
  // Where this trip came from, or null if it started from nothing. Set at
  // genesis by TripCreated and never touched again — no command changes it,
  // which is what makes it a fact about the stream rather than a field.
  forkedFrom: TripLineage | null;
  startDate: string | null; // display-only until M3
  days: DayState[]; // ordinal = position in this array
  backlog: string[]; // ordered activityIds without a day
  activities: Record<string, ActivityState>;
  dismissedConflictIds: string[]; // sorted; content-derived conflict ids the user dismissed
  currency: string; // ISO-4217; defaults to "USD"
  budget: Money | null; // defaults to null
  status: TripStatus; // "deleted" is a soft delete; the stream survives
};
