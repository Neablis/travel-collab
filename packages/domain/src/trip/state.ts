import type { Anchor, Location, TimeWindow, TripMember } from "@tc/contracts";

export type ActivityState = {
  title: string;
  timeWindow: TimeWindow | null;
  location: Location | null;
  notes: string | null;
  anchors: Anchor[];
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
};
