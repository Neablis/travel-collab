import { z } from "zod";
import { Money } from "./money";

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
    // Populated by the geocoder from its structured address data (city, or
    // the nearest equivalent — town/village/hamlet), distinct from `name`
    // (the full place label, e.g. "National Museum of Play at The Strong,
    // Rochester, Monroe County, New York, 14607, USA"). Optional: manually-
    // entered locations, or a geocoder result with no city-level address
    // component, carry no city. cityFor() (DayChips.tsx) prefers this over
    // `name` for grouping/coloring by city; falls back to `name` when a
    // location predates this field or never had one.
    city: z.string().min(1).max(200).optional(),
    // The sub-settlement locality: neighbourhood, suburb, quarter, or city
    // district, populated by the geocoder from the same structured address
    // data as `city` and strictly finer-grained than it ("Nishi-Azabu" inside
    // "Tokyo"). Display-only: it is what shortPlace() (apps/web/src/lib/place.ts)
    // shows on a timeline route/place line so a day inside one city reads
    // "Nishi-Azabu → Ebisu" rather than "Tokyo → Tokyo", and it is
    // cityFor()'s (DayChips.tsx) fallback when there is no city, in place of
    // the venue name that stood in for one before (KI-35).
    //
    // Nothing groups or colours by it: the calendar's city cards and the day
    // accents group strictly on `city`, deliberately (see
    // components/lenses/calendarCityCards.ts).
    //
    // Optional, like `city` and for the same reasons: manually-entered
    // locations, geocoder results with no sub-settlement component, and every
    // location written before this field existed carry none. That optionality
    // is load-bearing, not tidiness — `trip_details.doc` is stored as raw
    // jsonb and parsed on read, so a projection written before this field must
    // still parse (see contracts/test/ki35-location-area.test.ts, and the M18
    // regression it exists to not repeat).
    area: z.string().min(1).max(200).optional(),
  })
  .refine((l) => (l.lat === undefined) === (l.lng === undefined), {
    message: "lat and lng must be provided together",
  });
export type Location = z.infer<typeof Location>;

// Where a stop sits in the booking/travel workflow. Exactly one per activity,
// and never absent: "planned" is the zero value, which is why the field
// defaults rather than being nullable — db-seed.ts and the design handoff's
// export (`enums.stopStatus`) both already treat it that way. Calendar reads
// `transit` to split a travel day; `N to book` counts everything that is
// neither `booked` nor `transit` (M18).
export const ActivityKind = z.enum(["booked", "hold", "idea", "transit", "planned"]);
export type ActivityKind = z.infer<typeof ActivityKind>;

// What sort of thing a stop IS — orthogonal to where it is in the workflow.
// A closed vocabulary, never freeform: the design attaches behaviour to each
// tag ("power"), and a free string can't carry one.
//
// The handoff lists six; `considering` and `travel` are deliberately absent
// because ActivityKind already answers those (`idea` and `transit`). Two
// fields that can disagree about one fact is a bug generator: a stop tagged
// `considering` while its kind says `booked` would render dashed under a
// "Booked" badge with its cost outside the committed total, and no surface
// would own the contradiction. See docs/milestones/M18-stop-kind.md.
export const ActivityTag = z.enum(["meal", "lodging", "ticketed", "outdoors"]);
export type ActivityTag = z.infer<typeof ActivityTag>;

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
  kind: ActivityKind.optional(),         // omitted = "planned"
  tags: z.array(ActivityTag).optional(), // omitted = none
  cost: Money.optional(), // omitted = no cost
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
  kind: ActivityKind.optional(),         // omitted = unchanged; no null (set "planned" to clear)
  tags: z.array(ActivityTag).optional(), // omitted = unchanged; whole-array replace, like anchors
  cost: Money.nullable().optional(), // omitted = unchanged, null = cleared
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

// The activity field set as an event payload carries it: explicit null instead
// of omission, and a `.default()` on every field added after v1 shipped so a
// payload written before that field existed still parses off jsonb.
//
// ActivityAdded and ActivityUpdated both `.extend()` this rather than listing
// it twice (they were verbatim copies until 2026-08-28). The duplication was a
// live hazard, not just noise: a `.default()` added to one payload and missed
// on the other corrupts replay for *updated* activities only, and nothing would
// surface it until someone replayed an old log. `.extend()` after the ids keeps
// the shape's key order — and therefore the serialised payload — unchanged.
const ActivityPayloadFields = {
  title: z.string().min(1).max(200),
  timeWindow: TimeWindow.nullable(),
  location: Location.nullable(),
  notes: z.string().max(2000).nullable(),
  anchors: z.array(Anchor).default([]),
  kind: ActivityKind.default("planned"),
  tags: z.array(ActivityTag).default([]),
  cost: Money.nullable().default(null),
};

export const ActivityAddedV1 = z.object({
  type: z.literal("ActivityAdded"),
  version: z.literal(1),
  payload: z
    .object({
      tripId: z.string().uuid(),
      activityId: z.string().uuid(),
      dayId: z.string().uuid().nullable(),
    })
    .extend(ActivityPayloadFields),
});
export type ActivityAddedV1 = z.infer<typeof ActivityAddedV1>;

// Snapshot of the full field set AFTER the update — replay never merges patches.
export const ActivityUpdatedV1 = z.object({
  type: z.literal("ActivityUpdated"),
  version: z.literal(1),
  payload: z
    .object({
      tripId: z.string().uuid(),
      activityId: z.string().uuid(),
    })
    .extend(ActivityPayloadFields),
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
