// The `trip-seed/v1` schema — the shape of the design handoff's own export at
// .design-sync/handoff/data/japan-trip-seed.json.
//
// That file is an UPSTREAM DROP, re-synced from the design-system project
// (.design-sync/handoff/DS-UPSTREAM.md, DRIFT.md). Nothing in the running app
// reads it any more: `./trip.ts` owns the canonical copy of the trip, and this
// schema exists so `upstreamDrift.test.ts` can parse the export and prove the
// canonical copy still matches it. Without that, a design re-sync could change
// the trip and nothing would notice.
//
// It is a FIXTURE format, not a cross-boundary contract — it describes an
// export from the Trip Planner redesign prototype, not a travel-collab
// request/response shape — so it lives here rather than in packages/contracts
// (AGENTS.md invariant 5: a contracts change is its own reviewed step).
//
// Moved here from apps/web/src/lib/japanTripImporter.ts by ADR-030, unchanged
// except for this comment.

import { z } from "zod";


const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const StopStatus = z.enum(["booked", "hold", "idea", "transit", "planned"]);

// "all" or a list of traveler names (enums.who in the export documents this
// informally — there is no dedicated enum for it since it's a free-form
// name list). Not mapped to any command: Trip Planning doesn't know who's
// invited (module map, AGENTS.md) — that's Access & Membership's territory.
const StopWho = z.union([z.literal("all"), z.array(z.string().min(1))]);

const StopCostSeed = z.object({
  amount: z.number().int().nonnegative().nullable(), // null = "idea" stops, no estimate yet
  currency: z.string().regex(/^[A-Z]{3}$/),
  estimated: z.boolean(),
  source: z.string(), // e.g. "derived" — the prototype estimator's provenance tag
});

const StopSeed = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  place: z.string().min(1),
  area: z.string().min(1),
  start: z.string().regex(HHMM),
  end: z.string().regex(HHMM),
  durationMinutes: z.number().int().nonnegative(),
  who: StopWho,
  status: StopStatus,
  note: z.string().nullable(),
  cost: StopCostSeed,
});

const UnscheduledSeed = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  place: z.string().min(1),
  area: z.string().min(1),
  who: StopWho,
  status: StopStatus,
  note: z.string().nullable(),
  source: z.string(), // attribution, e.g. "Priya added it" — not a cost source
});

const DaySeed = z.object({
  index: z.number().int().positive(),
  label: z.string().min(1),
  weekday: z.string().min(1),
  dateOfMonth: z.number().int().positive(),
  month: z.string().min(1),
  year: z.number().int(),
  date: z.string().regex(ISO_DATE),
  city: z.string().min(1),
  previousCity: z.string().min(1),
  isDayTrip: z.boolean(),
  stops: z.array(StopSeed),
  dayCost: z.number(),
  overlaps: z.array(z.object({ stops: z.array(z.string()).min(2), minutes: z.number() })),
});

const SegmentSeed = z.object({
  city: z.string().min(1),
  nights: z.number().int().positive().optional(),
  dayTrip: z.boolean().optional(),
});

const TravelerSeed = z.object({
  name: z.string().min(1),
  initials: z.string().min(1),
  role: z.string().min(1),
});

const BudgetSeed = z.object({
  total: z.number().int().nonnegative(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  plannedTotal: z.number(),
  remaining: z.number(),
  over: z.boolean(),
  byCategory: z.record(z.string(), z.number()),
  unpricedStops: z.number().int().nonnegative(),
});

const TripMetaSeed = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  state: z.string().min(1),
  startDate: z.string().regex(ISO_DATE),
  endDate: z.string().regex(ISO_DATE),
  datesLabel: z.string().min(1),
  dayCount: z.number().int().positive(),
  stopCount: z.number().int().nonnegative(),
  cities: z.array(z.string()),
  segments: z.array(SegmentSeed),
  travelers: z.array(TravelerSeed),
  budget: BudgetSeed,
});

export const TripSeedV1 = z.object({
  $schema: z.literal("trip-seed/v1"),
  exportedAt: z.string(),
  note: z.string(),
  trip: TripMetaSeed,
  enums: z.object({ stopStatus: z.array(z.string()), who: z.string() }),
  days: z.array(DaySeed),
  unscheduled: z.array(UnscheduledSeed),
});
export type TripSeedV1 = z.infer<typeof TripSeedV1>;

/** Validates raw JSON against trip-seed/v1. Throws (via zod) on any drift. */
export function parseTripSeed(json: unknown): TripSeedV1 {
  return TripSeedV1.parse(json);
}
