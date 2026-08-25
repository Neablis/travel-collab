// Typed, validated importer for the design handoff's Japan trip export
// (.design-sync/handoff/data/japan-trip-seed.json — 14 days, 68 stops, 6
// cities, 4 unscheduled items). Nothing else in the repo reads that file, so
// without this module a contract change could silently leave it unimportable
// — the drift guard in src/lib/japanTripImporter.test.ts is the point.
//
// This is a FIXTURE format (`trip-seed/v1`), not a cross-boundary contract —
// it describes an export from the Trip Planner redesign prototype, not a
// travel-collab request/response shape — so its schema lives here, next to
// the seed script that's its only intended consumer, rather than in
// packages/contracts (AGENTS.md: a contracts change is its own reviewed
// step). Living in apps/web/scripts also keeps it dependency-free of the
// `@/` path alias, which only bundlers/tsc resolve — this file (like
// db-seed.ts) is run directly by Node's native type-stripping when a script
// needs it, so it only imports workspace packages (resolved via
// node_modules, not relative-path aliasing) and Node builtins.
//
// TripCommand[] is the output, not TripState — importing is "produce the
// commands a real user's actions would have produced," never a direct
// projection write (Invariant 1). Nothing here calls the command API; that's
// left to whoever wires this into db-seed.ts or an endpoint (out of scope
// for this module on purpose).

import { z } from "zod";
import type { TripCommand } from "@tc/contracts";
import { uuidFrom } from "@tc/factories";

// ---- schema: trip-seed/v1 --------------------------------------------

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

// ---- deterministic ids --------------------------------------------------

// FNV-1a 32-bit — cheap, dependency-free, stable across runs/platforms.
// uuidFrom (@tc/factories) wants a numeric sequence; this turns each seed
// string id into one, so re-running the importer on the same JSON always
// produces the same command ids instead of a fresh crypto.randomUUID() set.
function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

// uuidFrom's own fields (packages/factories/src/ids.ts) are only 4 hex
// digits wide in three of five UUID segments — it's built for Fishery's
// small incrementing counters, not an arbitrary 32-bit value. Feeding it a
// full hash produces a mis-shaped, non-UUID string once the hash exceeds
// 0xFFFF. Reducing to 16 bits keeps every segment the width uuidFrom assumes.
const SEQUENCE_SPACE = 0x10000;

// Namespaced (`kind:seedId`) so a trip id, a day date, and a stop id that
// happened to collide as raw strings still can't collide as hash inputs.
// idFor asserts global uniqueness of the ids it hands out (below) rather
// than trusting a 16-bit hash space never collides across this seed's ~90
// ids — verified collision-free for the real file, but a future edit to it
// should fail loudly, not silently double-assign an id.
const keyById = new Map<string, string>(); // id -> seed key that produced it

function idFor(kind: "trip" | "day" | "activity", seedId: string): string {
  const key = `${kind}:${seedId}`;
  const id = uuidFrom(fnv1a32(key) % SEQUENCE_SPACE);
  const priorKey = keyById.get(id);
  if (priorKey !== undefined && priorKey !== key) {
    throw new Error(`idFor: hash collision between "${priorKey}" and "${key}" — both mapped to ${id}`);
  }
  keyById.set(id, key);
  return id;
}

// ---- import: TripSeedV1 -> TripCommand[] ---------------------------------

// Fields read from the seed but with no TripCommand/contract equivalent —
// dropped rather than stretched into a field that doesn't mean them. Kept
// as a const (not just a comment) so the drift test can assert this list
// stays intentional rather than silently growing.
export const DROPPED_SEED_FIELDS = [
  "trip.state", // display workflow label ("Planning"); TripStatus is active|deleted, a different axis
  "trip.datesLabel", // derived display string of startDate/endDate
  "trip.dayCount", // derived from days.length
  "trip.stopCount", // derived from days[].stops.length
  "trip.cities", // derived from days[].city
  "trip.segments", // derived city/night grouping; no command models trip structure this way
  "trip.travelers", // Access & Membership's data (module map) — Trip Planning never knows who's invited
  "trip.budget.plannedTotal", // computed rollup (packages/domain's rollupCosts owns this, not seed input)
  "trip.budget.remaining", // computed rollup
  "trip.budget.over", // computed rollup
  "trip.budget.byCategory", // computed rollup
  "trip.budget.unpricedStops", // computed rollup
  "enums", // documents the file's own vocabulary; not trip content
  "exportedAt", // export provenance, not trip content
  "note", // export provenance, not trip content
  "days[].label", // derived display string of date
  "days[].weekday", // derived from date
  "days[].dateOfMonth", // derived from date
  "days[].month", // derived from date
  "days[].year", // derived from date
  "days[].city", // no Day contract field — a day's "city" is read from its activities' locations, not set
  "days[].previousCity", // same — no Day contract field
  "days[].isDayTrip", // same — no Day contract field
  "days[].dayCost", // computed rollup (rollupCosts), not seed input
  "days[].overlaps", // precomputed conflict data from the prototype; the real Conflict Engine
  // derives overlaps live from placed activities (Invariant 3) — importing a stale,
  // precomputed copy would risk it silently disagreeing with what the engine finds.
  "stops[].area", // no Location sub-field for it; folded into `place` in the AddActivity location.name instead
  "stops[].who", // Access & Membership's territory, not an activity field
  "stops[].status", // no AddActivity field models a workflow status
  "stops[].durationMinutes", // redundant with start/end, which TimeWindow already carries
  "stops[].cost.estimated", // Money is {amountMinor, currency} only — no provenance sub-field
  "stops[].cost.source", // same
  "unscheduled[].area", // see stops[].area
  "unscheduled[].who", // see stops[].who
  "unscheduled[].status", // see stops[].status
  "unscheduled[].source", // attribution ("Priya added it"), not a Money source — no field for it
] as const;

function locationName(place: string, area: string, city: string): string {
  return `${place}, ${area}, ${city}, Japan`;
}

// AddActivity for one scheduled stop, placed directly on its day. No
// MoveActivity follow-up is needed: ActivityAdded (packages/domain/src/trip/evolve.ts)
// appends to the end of the target day's activityIds, so iterating stops in
// the seed's own per-day order reproduces the seed's order exactly. `city`
// comes from the containing day, not the stop — stops carry no city of
// their own in this export (only `area`, folded into the location name).
function stopToAddActivity(
  tripId: string,
  dayId: string,
  city: string,
  stop: TripSeedV1["days"][number]["stops"][number],
): TripCommand {
  const cost = stop.cost.amount === null ? undefined : { amountMinor: stop.cost.amount * 100, currency: stop.cost.currency };
  return {
    type: "AddActivity",
    tripId,
    activityId: idFor("activity", stop.id),
    dayId,
    title: stop.title,
    timeWindow: { start: stop.start, end: stop.end },
    location: { name: locationName(stop.place, stop.area, city), city },
    ...(stop.note ? { notes: stop.note } : {}),
    ...(cost ? { cost } : {}),
  };
}

// Backlog item: no dayId (AddActivity's documented "omitted = backlog"), no
// timeWindow or cost — the export carries neither for unscheduled items, and
// no city either (unlike a scheduled stop, a backlog idea isn't tied to a
// day, so the export never assigned it one).
function unscheduledToAddActivity(tripId: string, item: TripSeedV1["unscheduled"][number]): TripCommand {
  return {
    type: "AddActivity",
    tripId,
    activityId: idFor("activity", item.id),
    title: item.title,
    location: { name: `${item.place}, ${item.area}, Japan` },
    ...(item.note ? { notes: item.note } : {}),
  };
}

/**
 * Maps a validated trip-seed/v1 document to the TripCommand[] that would
 * produce it: CreateTrip, SetTripDates (minting one day id per seed day),
 * SetTripBudget, then one AddActivity per stop (scheduled stops carry a
 * dayId; unscheduled items don't, landing in the backlog) — in the seed's
 * own day/stop order, so replaying these commands reproduces both the day
 * layout and each day's activity order.
 */
export function importJapanTripSeed(seed: TripSeedV1): TripCommand[] {
  const tripId = idFor("trip", seed.trip.id);
  const dayIds = seed.days.map((day) => idFor("day", day.date));

  const commands: TripCommand[] = [
    { type: "CreateTrip", tripId, name: seed.trip.name },
    { type: "SetTripDates", tripId, startDate: seed.trip.startDate, endDate: seed.trip.endDate, newDayIds: dayIds },
    {
      type: "SetTripBudget",
      tripId,
      budget: { amountMinor: seed.trip.budget.total * 100, currency: seed.trip.budget.currency },
    },
  ];

  seed.days.forEach((day, i) => {
    const dayId = dayIds[i]!;
    for (const stop of day.stops) {
      commands.push(stopToAddActivity(tripId, dayId, day.city, stop));
    }
  });

  for (const item of seed.unscheduled) {
    commands.push(unscheduledToAddActivity(tripId, item));
  }

  return commands;
}
