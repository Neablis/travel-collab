import type { Anchor, Location, Money, TimeWindow, TripMember, TripStatus } from "@tc/contracts";

export type ActivityState = {
  title: string;
  timeWindow: TimeWindow | null;
  location: Location | null;
  notes: string | null;
  anchors: Anchor[];
  cost: Money | null;
};

export type DayState = {
  dayId: string;
  activityIds: string[];
};

export type TripState = {
  tripId: string;
  name: string;
  members: TripMember[];
  startDate: string | null; // display-only until M3
  days: DayState[]; // ordinal = position in this array
  backlog: string[]; // ordered activityIds without a day
  activities: Record<string, ActivityState>;
  dismissedConflictIds: string[]; // sorted; content-derived conflict ids the user dismissed
  currency: string; // ISO-4217; defaults to "USD"
  budget: Money | null; // defaults to null
  status: TripStatus; // "deleted" is a soft delete; the stream survives
};
