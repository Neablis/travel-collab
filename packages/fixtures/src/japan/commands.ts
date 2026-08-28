// The ONE producer of the Japan demo trip's commands. Every caller — db-seed,
// the preview reset route, the @tc/factories scenario, the verifier — goes
// through this function, so all four necessarily agree (ADR-030).
//
// TripCommand[] is the output, not TripState: seeding is "produce the commands
// a real user's actions would have produced", never a direct projection write
// (AGENTS.md invariant 1). Nothing here talks to a database or an API; wiring
// these into the command pipeline is the caller's job.

import type { ActivityKind, ActivityTag, TripCommand } from "@tc/contracts";
import {
  JAPAN_BACKLOG,
  JAPAN_COUNTRY_CODE,
  JAPAN_TRIP_BUDGET_USD,
  JAPAN_TRIP_CURRENCY,
  JAPAN_TRIP_DAY_COUNT,
  JAPAN_STOPS,
  type JapanBacklogItem,
  type JapanStop,
} from "./trip.ts";

/** Mints a fresh uuid. Injectable so the verifier can be deterministic. */
export type MintId = () => string;

export type JapanTripOptions = {
  /**
   * The trip's first day, `YYYY-MM-DD`. Required, never defaulted from the
   * clock: this module stays pure so `verify.ts` produces the same commands on
   * every run, and both real callers deliberately pass a date relative to
   * *today* so the demo trip is always upcoming (ADR-030). The upstream
   * export's own fixed `2026-09-20` is not used — it goes stale.
   */
  startDate: string;
  /** Defaults to `crypto.randomUUID` (Node 22+ and every browser). */
  mintId?: MintId;
};

/** Calendar-date arithmetic in UTC, so it cannot drift across a local offset. */
export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

/**
 * The full human label stored as `Location.name`, e.g.
 * "Gonpachi Nishiazabu, Nishi-Azabu, Tokyo, Japan".
 *
 * `area` is BOTH folded in here and carried as its own `Location.area`
 * (KI-35). The duplication is deliberate: `name` is the human label, `area` is
 * the structured field the UI reads. Exported so scripts/geocode-japan-seed.mts
 * builds the exact same query string that gets stored.
 */
export function locationName(place: string, area: string, city: string): string {
  return `${place}, ${area}, ${city}, Japan`;
}

/**
 * The city-less form, "<place>, <area>, Japan".
 *
 * Only scripts/geocode-japan-seed.mts uses this, and only because it reads the
 * UPSTREAM export, where a backlog item carries no city (a parked idea is not
 * tied to a day, so the export never assigned it one). ./trip.ts does give each
 * backlog item a city, so what actually gets stored uses `locationName` above —
 * a future geocoder run could pass that city and get a tight per-city box
 * instead of searching all six. Left alone for now: changing that script's
 * query shape means re-running ~70 live lookups and re-reviewing every result,
 * which is its own piece of work (KI-58), not a rider on this one.
 */
export function unscheduledLocationName(place: string, area: string): string {
  return `${place}, ${area}, Japan`;
}

/**
 * Folds `who` into the notes field. It is the last piece of stop metadata the
 * domain doesn't model — Access & Membership's data, not an activity field
 * (module map) — and "all" is the uninteresting default, omitted so notes stay
 * quiet for the common case.
 *
 * `status` used to be folded in here too, which is why cards once read
 * "(transit)" and "(idea)". M18 gave it a real home: `AddActivity.kind`. Do
 * not put it back.
 */
export function buildNotes(note: string | null, who: "all" | readonly string[]): string | undefined {
  const parts: string[] = [];
  if (note) parts.push(note);
  if (who !== "all" && who.length > 0) parts.push(`(${who.join(" + ")})`);
  return parts.length > 0 ? parts.join(" ") : undefined;
}

/**
 * One `AddActivity` for one row, scheduled or backlogged.
 *
 * Shared by both so a stop and a parked idea cannot drift apart in how they are
 * built: the only differences are the three arguments a backlog item passes as
 * absent — no `dayId` (`AddActivity`'s documented "omitted = backlog"), no time
 * window, and no cost.
 *
 * `who` is folded into `notes` here rather than carried as a field, because
 * Trip Planning does not know who is invited (module map, AGENTS.md), and
 * `tags`/`cost` are omitted entirely when empty so the emitted command matches
 * what a real user's action would have produced.
 */
function addActivity(
  tripId: string,
  activityId: string,
  row: JapanStop | JapanBacklogItem,
  dayId: string | undefined,
  timeWindow: { start: string; end: string } | undefined,
  costUsd: number | null,
): TripCommand {
  const notes = buildNotes(row.note, row.who);
  return {
    type: "AddActivity",
    tripId,
    activityId,
    ...(dayId ? { dayId } : {}),
    title: row.title,
    ...(timeWindow ? { timeWindow } : {}),
    location: {
      name: locationName(row.place, row.area, row.city),
      city: row.city,
      area: row.area,
      lat: row.lat,
      lng: row.lng,
      countryCode: JAPAN_COUNTRY_CODE,
    },
    kind: row.kind satisfies ActivityKind,
    ...(row.tags.length > 0 ? { tags: row.tags as ActivityTag[] } : {}),
    ...(costUsd !== null ? { cost: { amountMinor: costUsd * 100, currency: JAPAN_TRIP_CURRENCY } } : {}),
    ...(notes ? { notes } : {}),
  };
}

/**
 * The same commands, grouped the way they are meant to be SENT.
 *
 * Grouping is not a caller's private business here: one batch is one History
 * entry (the server appends a batch under a single batchId, and
 * packages/domain/src/trip/history.ts's `describeUserBatch` joins every event's
 * description with "; "). Sending all 72 stops as one batch leaves the History
 * popover — a designed surface the demo data exists to exercise — showing a
 * single unreadable entry. So the split is part of the fixture, not an
 * implementation detail each caller re-invents:
 *
 *   [0]      the trip's dates and budget
 *   [1..14]  one group per day, so History reads "Day 3" at a time
 *   [15]     the backlog, so four parked ideas read as one wishlist drop
 *
 * `api/dev/reset-demo-data` deliberately flattens this back into one batch —
 * it runs inside a Vercel function with a 30s ceiling and wants the whole seed
 * to roll back together. That is a considered trade of History readability for
 * atomicity on a throwaway preview reset, not an oversight.
 */
export function japanTripCommandGroups(tripId: string, options: JapanTripOptions): TripCommand[][] {
  const { startDate, mintId = () => crypto.randomUUID() } = options;
  const dayIds = Array.from({ length: JAPAN_TRIP_DAY_COUNT }, mintId);

  const setup: TripCommand[] = [
    {
      type: "SetTripDates",
      tripId,
      startDate,
      endDate: addDays(startDate, JAPAN_TRIP_DAY_COUNT - 1),
      newDayIds: dayIds,
    },
    {
      type: "SetTripBudget",
      tripId,
      budget: { amountMinor: JAPAN_TRIP_BUDGET_USD * 100, currency: JAPAN_TRIP_CURRENCY },
    },
  ];

  // No `MoveActivity` follow-up is needed to get each day's order right.
  // `ActivityAdded` appends to the end of the target day's `activityIds`
  // (packages/domain/src/trip/evolve.ts), so iterating stops in this file's own
  // per-day order reproduces that order exactly — which `verify.ts` asserts
  // rather than assumes, a day rendered backwards having been a real defect
  // once (docs/design-feedback/2026-08-26-design-sync-ui-audit.md, A1).
  const days: TripCommand[][] = Array.from({ length: JAPAN_TRIP_DAY_COUNT }, () => []);
  for (const stop of JAPAN_STOPS) {
    days[stop.day - 1]!.push(
      addActivity(tripId, mintId(), stop, dayIds[stop.day - 1]!, { start: stop.start, end: stop.end }, stop.costUsd),
    );
  }

  // No dayId, no time window, no cost — `AddActivity`'s documented
  // "omitted = backlog", and a parked idea has neither a slot nor a price yet.
  const backlog = JAPAN_BACKLOG.map((item) => addActivity(tripId, mintId(), item, undefined, undefined, null));

  return [setup, ...days, backlog];
}

/**
 * Every command that finishes setting up the Japan trip, flat and in order:
 * `SetTripDates` (minting one fresh day id per day), `SetTripBudget`, then one
 * `AddActivity` per stop — scheduled stops carrying a `dayId`, backlog items
 * not.
 *
 * `tripId` is supplied by the caller, not generated here: creating the trip
 * (`CreateTrip`, or POST /api/trips) is what mints it.
 *
 * Use `japanTripCommandGroups` instead when the History popover matters.
 */
export function japanTripCommands(tripId: string, options: JapanTripOptions): TripCommand[] {
  return japanTripCommandGroups(tripId, options).flat();
}
