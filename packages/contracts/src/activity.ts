import { z } from "zod";

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export const TimeWindow = z
  .object({ start: z.string().regex(HHMM), end: z.string().regex(HHMM) })
  .refine((w) => w.start < w.end, { message: "end must be after start" });
export type TimeWindow = z.infer<typeof TimeWindow>;

export const Weekday = z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);
export type Weekday = z.infer<typeof Weekday>;

const ISO_DATE_A = /^\d{4}-\d{2}-\d{2}$/;

// Constraint on WHEN an activity may fall. All four ship in M3; the first three
// evaluate live (domain Task D3), publicHoliday is inert (permissive stub).
export const Anchor = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("dayOfWeek"), days: z.array(Weekday).min(1) }),
    z.object({ kind: z.literal("dateRange"), from: z.string().regex(ISO_DATE_A), to: z.string().regex(ISO_DATE_A) }),
    z.object({ kind: z.literal("timeOfDay"), window: TimeWindow }),
    z.object({ kind: z.literal("publicHoliday"), country: z.string().regex(/^[A-Z]{2}$/) }),
  ])
  .superRefine((a, ctx) => {
    if (a.kind === "dateRange" && a.from > a.to) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "from must be <= to" });
    }
  });
export type Anchor = z.infer<typeof Anchor>;

export const Location = z
  .object({
    name: z.string().min(1).max(200),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
    countryCode: z.string().regex(/^[A-Z]{2}$/).optional(), // populated by the geocoder (ADR-007)
  })
  .refine((l) => (l.lat === undefined) === (l.lng === undefined), {
    message: "lat and lng must be provided together",
  });
export type Location = z.infer<typeof Location>;

// ---- Commands ----

export const AddActivity = z.object({
  type: z.literal("AddActivity"),
  tripId: z.string().uuid(),
  activityId: z.string().uuid(),
  dayId: z.string().uuid().optional(), // omitted = backlog
  title: z.string().min(1).max(200),
  timeWindow: TimeWindow.optional(),
  location: Location.optional(),
  notes: z.string().max(2000).optional(),
  anchors: z.array(Anchor).optional(),
});
export type AddActivity = z.infer<typeof AddActivity>;

// Omitted field = unchanged; null = cleared. Title cannot be cleared.
export const UpdateActivity = z.object({
  type: z.literal("UpdateActivity"),
  tripId: z.string().uuid(),
  activityId: z.string().uuid(),
  title: z.string().min(1).max(200).optional(),
  timeWindow: TimeWindow.nullable().optional(),
  location: Location.nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  anchors: z.array(Anchor).optional(),
});
export type UpdateActivity = z.infer<typeof UpdateActivity>;

export const MoveActivity = z.object({
  type: z.literal("MoveActivity"),
  tripId: z.string().uuid(),
  activityId: z.string().uuid(),
  toDayId: z.string().uuid().nullable(), // null = backlog
  position: z.number().int().nonnegative(),
});
export type MoveActivity = z.infer<typeof MoveActivity>;

export const RemoveActivity = z.object({
  type: z.literal("RemoveActivity"),
  tripId: z.string().uuid(),
  activityId: z.string().uuid(),
});
export type RemoveActivity = z.infer<typeof RemoveActivity>;

// ---- Events (payloads use explicit null — they are stored as jsonb forever) ----

export const ActivityAddedV1 = z.object({
  type: z.literal("ActivityAdded"),
  version: z.literal(1),
  payload: z.object({
    tripId: z.string().uuid(),
    activityId: z.string().uuid(),
    dayId: z.string().uuid().nullable(),
    title: z.string().min(1).max(200),
    timeWindow: TimeWindow.nullable(),
    location: Location.nullable(),
    notes: z.string().max(2000).nullable(),
    anchors: z.array(Anchor).default([]),
  }),
});
export type ActivityAddedV1 = z.infer<typeof ActivityAddedV1>;

// Snapshot of the full field set AFTER the update — replay never merges patches.
export const ActivityUpdatedV1 = z.object({
  type: z.literal("ActivityUpdated"),
  version: z.literal(1),
  payload: z.object({
    tripId: z.string().uuid(),
    activityId: z.string().uuid(),
    title: z.string().min(1).max(200),
    timeWindow: TimeWindow.nullable(),
    location: Location.nullable(),
    notes: z.string().max(2000).nullable(),
    anchors: z.array(Anchor).default([]),
  }),
});
export type ActivityUpdatedV1 = z.infer<typeof ActivityUpdatedV1>;

export const ActivityMovedV1 = z.object({
  type: z.literal("ActivityMoved"),
  version: z.literal(1),
  payload: z.object({
    tripId: z.string().uuid(),
    activityId: z.string().uuid(),
    toDayId: z.string().uuid().nullable(),
    position: z.number().int().nonnegative(),
  }),
});
export type ActivityMovedV1 = z.infer<typeof ActivityMovedV1>;

export const ActivityRemovedV1 = z.object({
  type: z.literal("ActivityRemoved"),
  version: z.literal(1),
  payload: z.object({
    tripId: z.string().uuid(),
    activityId: z.string().uuid(),
  }),
});
export type ActivityRemovedV1 = z.infer<typeof ActivityRemovedV1>;
