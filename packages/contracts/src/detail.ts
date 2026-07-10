import { z } from "zod";
import { Conflict } from "./conflict";
import { TripMember } from "./trip";
import { Anchor, Location, TimeWindow } from "./activity";

export const ActivityView = z.object({
  activityId: z.string().uuid(),
  title: z.string(),
  timeWindow: TimeWindow.nullable(),
  location: Location.nullable(),
  notes: z.string().nullable(),
  anchors: z.array(Anchor),
});
export type ActivityView = z.infer<typeof ActivityView>;

// The board read model: one document per trip, conflicts included.
export const TripDetail = z.object({
  tripId: z.string().uuid(),
  name: z.string(),
  startDate: z.string().nullable(),
  members: z.array(TripMember).min(1),
  days: z.array(
    z.object({ dayId: z.string().uuid(), activityIds: z.array(z.string().uuid()), date: z.string().nullable() }),
  ),
  backlog: z.array(z.string().uuid()),
  activities: z.record(ActivityView),
  conflicts: z.array(Conflict),
  dismissedConflictIds: z.array(z.string()), // sorted; ids are content-derived
  createdAt: z.string(), // ISO 8601, from the first envelope
});
export type TripDetail = z.infer<typeof TripDetail>;
