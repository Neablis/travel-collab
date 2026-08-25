// Typed, validated importer for the design handoff's Japan trip export
// (.design-sync/handoff/data/japan-trip-seed.json — 14 days, 68 stops, 6
// cities, 4 unscheduled items). Nothing else in the repo reads that file, so
// without this module a contract change could silently leave it unimportable
// — the drift guard in japanTripImporter.test.ts (same directory) is the
// point.
//
// This is a FIXTURE format (`trip-seed/v1`), not a cross-boundary contract —
// it describes an export from the Trip Planner redesign prototype, not a
// travel-collab request/response shape — so its schema lives here rather
// than in packages/contracts (AGENTS.md: a contracts change is its own
// reviewed step). Lives under src/lib rather than apps/web/scripts so both
// intended callers can reach it: db-seed.ts (a relative import, same as any
// other apps/web module) and the future import endpoint (bundled server
// code, which src/lib already is).
//
// TripCommand[] is the output, not TripState — importing is "produce the
// commands a real user's actions would have produced," never a direct
// projection write (Invariant 1). Nothing here calls the command API; that's
// left to whoever wires this into db-seed.ts or an endpoint (out of scope
// for this module on purpose).
//
// Ids: the trip id is never generated here — POST /api/trips (or a
// CreateTrip command) mints it server-side, exactly as db-seed.ts's
// createTrip() already does, and this module takes that tripId as a
// parameter. Day and activity ids are freshly minted with randomUUID(),
// matching db-seed.ts's own pattern (its SetTripDates/AddActivity calls) —
// not derived from the seed's own string ids. Nothing downstream snapshots
// these ids or re-imports the same seed expecting stable output, and the
// domain can't mint ids itself (Invariant 4), so a plain random mint is the
// right shape here (see apps/web/src/server/ai/idFields.ts's mint/ref/inject
// taxonomy — day/activity ids are "mint": the caller's job, not something to
// derive).

import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { TripCommand } from "@tc/contracts";
// The seed itself carries no lat/lng (a design-handoff export, not a
// geocoder's output) — this overlay is scripts/geocode-japan-seed.mts's
// output, keyed by the seed's own stop id, and is the ONLY source of
// coordinates the importer ever attaches. No fallback, no on-the-fly lookup:
// see that script's own header comment for why (KI-15, docs/known-issues.md).
import coordinatesOverlay from "./japanTripSeedCoordinates.json" with { type: "json" };

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

// Exported so scripts/geocode-japan-seed.mts builds the exact same query
// string this importer uses for a stop's display name — the geocode overlay
// can't drift from what actually gets stored.
export function locationName(place: string, area: string, city: string): string {
  return `${place}, ${area}, ${city}, Japan`;
}

// Unscheduled items carry no city (StopWho/UnscheduledSeed, see the schema
// above) — same reasoning as locationName's export.
export function unscheduledLocationName(place: string, area: string): string {
  return `${place}, ${area}, Japan`;
}

type CoordinateOverlayEntry = { lat: number; lng: number; canonicalName: string };
const coordinatesById = coordinatesOverlay.coordinates as Record<string, CoordinateOverlayEntry>;

// Looked up by the seed's own stop id (never by name — two stops can share a
// display name without being the same lookup, e.g. Nishiki Market appears
// both scheduled and in the backlog). Absent = unresolved by
// geocode-japan-seed.mts (no candidate inside its city's box, or the lookup
// failed) — left coordinate-less rather than guessed, per KI-15.
function coordsFor(id: string): { lat: number; lng: number } | undefined {
  const entry = coordinatesById[id];
  return entry ? { lat: entry.lat, lng: entry.lng } : undefined;
}

// AddActivity for one scheduled stop, placed directly on its day. No
// MoveActivity follow-up is needed: ActivityAdded (packages/domain/src/trip/evolve.ts)
// appends to the end of the target day's activityIds, so iterating stops in
// the seed's own per-day order reproduces the seed's order exactly. `city`
// comes from the containing day, not the stop — stops carry no city of
// their own in this export (only `area`, folded into the location name).
// The seed's own stop.id is read to pick this stop out during mapping
// (day/city lookups etc.) and to look up its entry in the geocode overlay —
// it never appears in the emitted command itself, though: the activity's
// real id is a fresh randomUUID(), same as db-seed.ts mints one.
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
    activityId: randomUUID(),
    dayId,
    title: stop.title,
    timeWindow: { start: stop.start, end: stop.end },
    location: { name: locationName(stop.place, stop.area, city), city, ...coordsFor(stop.id) },
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
    activityId: randomUUID(),
    title: item.title,
    location: { name: unscheduledLocationName(item.place, item.area), ...coordsFor(item.id) },
    ...(item.note ? { notes: item.note } : {}),
  };
}

/**
 * Maps a validated trip-seed/v1 document to the TripCommand[] that finishes
 * setting it up: SetTripDates (minting one fresh day id per seed day via
 * randomUUID()), SetTripBudget, then one AddActivity per stop (scheduled
 * stops carry a dayId; unscheduled items don't, landing in the backlog) — in
 * the seed's own day/stop order, so replaying these commands reproduces both
 * the day layout and each day's activity order.
 *
 * `tripId` is supplied by the caller, not generated here: creating the trip
 * (POST /api/trips, or a CreateTrip command) is what mints it, matching
 * db-seed.ts's own two-step createTrip()-then-cmd() pattern. This function
 * only returns the commands that come after that.
 */
export function importJapanTripSeed(seed: TripSeedV1, tripId: string): TripCommand[] {
  const dayIds = seed.days.map(() => randomUUID());

  const commands: TripCommand[] = [
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
