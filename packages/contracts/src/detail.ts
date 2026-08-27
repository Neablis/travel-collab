import { z } from "zod";
import { Conflict } from "./conflict";
import { TripLineage, TripMember, TripStatus } from "./trip";
import { ActivityKind, ActivityTag, Anchor, Location, TimeWindow } from "./activity";
import { Money } from "./money";

export const ActivityView = z.object({
  activityId: z.string().uuid(),
  title: z.string(),
  timeWindow: TimeWindow.nullable(),
  location: Location.nullable(),
  notes: z.string().nullable(),
  anchors: z.array(Anchor),
  kind: ActivityKind,
  tags: z.array(ActivityTag),
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
  // Null for a trip that started from nothing (M11 link 5). Deliberately NOT
  // on TripSummary: the home grid's card says nothing about provenance, and
  // adding it there would mean a `trip_summaries` column and a migration for
  // a line of text the trip's own settings sheet already carries.
  //
  // `.default(null)` is what makes this additive against a LIVE database:
  // every `trip_details.doc` written before this change has no such key, and
  // those rows are only rewritten when their trip next changes. Without the
  // default, `TripDetail.parse` in the read route would 500 on every existing
  // trip until someone remembered to rebuild the projections.
  forkedFrom: TripLineage.nullable().default(null),
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
