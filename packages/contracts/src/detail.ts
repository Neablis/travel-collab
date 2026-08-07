import { z } from "zod";
import { Conflict } from "./conflict";
import { TripMember, TripStatus } from "./trip";
import { Anchor, Location, TimeWindow } from "./activity";
import { Money } from "./money";

export const ActivityView = z.object({
  activityId: z.string().uuid(),
  title: z.string(),
  timeWindow: TimeWindow.nullable(),
  location: Location.nullable(),
  notes: z.string().nullable(),
  anchors: z.array(Anchor),
  cost: Money.nullable(),
});
export type ActivityView = z.infer<typeof ActivityView>;

// The board read model: one document per trip, conflicts included.
export const TripDetail = z.object({
  tripId: z.string().uuid(),
  name: z.string(),
  status: TripStatus,
  startDate: z.string().nullable(),
  currency: z.string(), // ISO-4217, from state (default "USD")
  budget: Money.nullable(),
  members: z.array(TripMember).min(1),
  days: z.array(
    z.object({
      dayId: z.string().uuid(),
      activityIds: z.array(z.string().uuid()),
      date: z.string().nullable(),        // M3
      costSubtotal: z.number().int(),     // M4 (minor units)
    }),
  ),
  backlog: z.array(z.string().uuid()),
  activities: z.record(ActivityView),
  conflicts: z.array(Conflict),
  dismissedConflictIds: z.array(z.string()), // sorted; ids are content-derived
  createdAt: z.string(), // ISO 8601, from the first envelope
  unscheduledCostSubtotal: z.number().int(),
  tripCostTotal: z.number().int(),
  budgetRemaining: z.number().int().nullable(), // budget − total, null if no budget (may be negative)
});
export type TripDetail = z.infer<typeof TripDetail>;
