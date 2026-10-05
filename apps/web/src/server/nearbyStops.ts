import { sql } from "drizzle-orm";
import {
  NEARBY_STOPS_MAX,
  SavedDayVisibility,
  type Location,
  type NearbyStop,
  type SavedStop,
  type TripDetail,
} from "@tc/contracts";
import { citiesOfDay, haversineKm } from "@tc/domain";
import { toEndMinutes, toMinutes } from "@/lib/time";
import { db } from "./db/client";
import { parseSavedDayColumns } from "./savedDayRow";

// Nearby stops (M34): what other travellers did in the city of the day a stop
// is being added to, read from the public library and ranked here. Decisions
// are M34's D1–D15 (`docs/milestones/M34-nearby-stops.md`).
//
// Two halves on purpose. `rankNearbyStops` is pure, so every rule it applies is
// unit-tested without a database; `nearbyStopsFor` is the one read that feeds
// it, and the half the integration test covers. The SQL decides what a reader
// may SEE (public, not deleted, not moderated, not theirs); the ranking decides
// only what is worth offering, so a rule that hides somebody's day never lives
// in application code where a test with no database could miss it.

/** How many published days the query reads before ranking. Discover's `CANDIDATE_LIMIT`, for its reason. */
const CANDIDATE_DAYS = 200;

/** A published day the query found, parsed. */
export type NearbyStopsCandidateDay = { savedDayId: string; name: string; stops: readonly SavedStop[] };

export type RankNearbyStopsInput = {
  /** Already filtered by the query: public, not deleted, not moderated, not the reader's. */
  days: readonly NearbyStopsCandidateDay[];
  /** The cities of the day being added to (or of the trip). Matched case-insensitively. */
  cities: readonly string[];
  /** Where "closest" is measured from, or null for no distance ranking. */
  anchor: { lat: number; lng: number } | null;
  /** Titles already on the day; a stop with one of these is not offered again (D8). */
  titlesOnDay: readonly string[];
};

/** Case-insensitive and trimmed: how every comparison of a title or a place name is spelled here. */
function fold(text: string): string {
  return text.trim().toLowerCase();
}

/**
 * The point a location can be measured from, or null.
 *
 * `precision: "city"` is a city centre, not where the stop is (D1): ranked by
 * it, every stop in the city ties at the same few metres from the anchor, and
 * a stop that only said "Kyoto" would outrank a real venue across town.
 * Undefined precision counts as a real point — it is what every location
 * geocoded before precision existed carries, and those were venue lookups.
 */
function pointOf(location: Location | null): { lat: number; lng: number } | null {
  if (location === null || location.lat === undefined || location.lng === undefined) return null;
  if (location.precision === "city") return null;
  return { lat: location.lat, lng: location.lng };
}

/** The stop's length in minutes, or null with no window. 23:59 is midnight, as the editor reads it. */
function lengthOf(stop: SavedStop): number | null {
  if (stop.timeWindow === null) return null;
  return toEndMinutes(stop.timeWindow.end) - toMinutes(stop.timeWindow.start);
}

/**
 * The published stops worth offering for one day, best first, at most
 * `NEARBY_STOPS_MAX` of them (M34 D1, D5, D7–D9).
 *
 * Pure: no I/O and no clock. The order of `days` matters only as a tie-break of
 * last resort and for which copy of a duplicate is kept, and the query hands
 * them over newest first.
 */
export function rankNearbyStops(input: RankNearbyStopsInput): NearbyStop[] {
  const cities = new Set(input.cities.map(fold));
  const onDay = new Set(input.titlesOnDay.map(fold));

  type Group = { stop: SavedStop & { location: Location }; day: NearbyStopsCandidateDay; days: Set<string> };
  const groups = new Map<string, Group>();
  for (const day of input.days) {
    for (const stop of day.stops) {
      const { location } = stop;
      // D1: "nearby" is the same city. A stop with no place, or with a place
      // and no city, cannot be said to be in one.
      if (location === null || location.city === undefined || !cities.has(fold(location.city))) continue;
      // D7: a leg between two places, not a place to add.
      if (stop.kind === "transit") continue;
      // D8: already on the day, by name.
      if (onDay.has(fold(stop.title))) continue;

      // D9: the same stop is the same name at the same place. The JSON pair
      // rather than a joined string, so no separator can make two different
      // pairs collide.
      const key = JSON.stringify([fold(stop.title), fold(location.name)]);
      const group = groups.get(key);
      if (group === undefined) {
        groups.set(key, { stop: { ...stop, location }, day, days: new Set([day.savedDayId]) });
        continue;
      }
      group.days.add(day.savedDayId);
      // The first day's copy is kept unless a later one can be measured and it
      // cannot: the row is the same stop, and the copy with a real point is the
      // one that can rank by distance.
      if (pointOf(group.stop.location) === null && pointOf(location) !== null) {
        group.stop = { ...stop, location };
        group.day = day;
      }
    }
  }

  const ranked = [...groups.values()].map(({ stop, day, days }): NearbyStop => {
    const point = pointOf(stop.location);
    return {
      title: stop.title,
      location: stop.location,
      kind: stop.kind,
      tags: stop.tags,
      lengthMinutes: lengthOf(stop),
      savedDayId: day.savedDayId,
      savedDayName: day.name,
      playbookCount: days.size,
      distanceKm: input.anchor !== null && point !== null ? haversineKm(input.anchor, point) : null,
    };
  });

  // Measured first, closest first; then the unmeasured. Within a tie, the stop
  // more days carry, then the title — a fixed locale, so two servers agree.
  ranked.sort((a, b) => {
    if ((a.distanceKm === null) !== (b.distanceKm === null)) return a.distanceKm === null ? 1 : -1;
    if (a.distanceKm !== null && b.distanceKm !== null && a.distanceKm !== b.distanceKm) {
      return a.distanceKm - b.distanceKm;
    }
    if (a.playbookCount !== b.playbookCount) return b.playbookCount - a.playbookCount;
    return a.title.localeCompare(b.title, "en");
  });
  return ranked.slice(0, NEARBY_STOPS_MAX);
}

/** Every day's cities, in day order, each once — the trip's cities by `citiesOfDay`'s own rule. */
function citiesOfTrip(detail: TripDetail): string[] {
  return [...new Set(detail.days.flatMap((_, index) => citiesOfDay(detail, index)))];
}

/**
 * The centroid of the day's measurable stops, or null.
 *
 * A plain mean of the coordinates, which is fine at the scale of one day in
 * one city and wrong only across the antimeridian — where a day of stops is
 * not something this product has.
 */
function centroidOf(detail: TripDetail, dayIndex: number): { lat: number; lng: number } | null {
  const points = (detail.days[dayIndex]?.activityIds ?? [])
    .map((id) => pointOf(detail.activities[id]?.location ?? null))
    .filter((point) => point !== null);
  if (points.length === 0) return null;
  return {
    lat: points.reduce((sum, p) => sum + p.lat, 0) / points.length,
    lng: points.reduce((sum, p) => sum + p.lng, 0) / points.length,
  };
}

export type NearbyStopsQuery = {
  detail: TripDetail;
  /** The day being added to. Unknown or absent: the trip's cities, and no centroid. */
  dayId: string | null;
  /** An explicit point (a stop started from the map). Wins over the day's centroid. */
  anchor: { lat: number; lng: number } | null;
  /**
   * Whose days are left out (D6): the access seam's `userId`. The route opts
   * into neither the demo nor an invite token, so this is always a signed-in
   * account — never `demo-visitor` or `invite-visitor`. Were either ever let
   * in, excluding it would be harmless: neither owns a saved day a reader can
   * see, so the reader would get the whole public library.
   */
  readerId: string;
};

/**
 * Nearby stops for a day of `detail`: one read of the public library, ranked
 * by {@link rankNearbyStops}. A trip with no city anywhere asks nothing.
 */
export async function nearbyStopsFor(query: NearbyStopsQuery): Promise<NearbyStop[]> {
  const { detail } = query;
  const dayIndex = query.dayId === null ? -1 : detail.days.findIndex((d) => d.dayId === query.dayId);
  // D1: the day's cities; a day with none (a new day, or stops with no city)
  // borrows the trip's.
  const dayCities = dayIndex === -1 ? [] : citiesOfDay(detail, dayIndex);
  const cities = dayCities.length > 0 ? dayCities : citiesOfTrip(detail);
  if (cities.length === 0) return [];

  const anchor = query.anchor ?? (dayIndex === -1 ? null : centroidOf(detail, dayIndex));
  const titlesOnDay =
    dayIndex === -1
      ? []
      : detail.days[dayIndex]!.activityIds.flatMap((id) => {
          const title = detail.activities[id]?.title;
          return title === undefined ? [] : [title];
        });

  // The published filter, spelled as `playbooks.ts` spells it — `notDeleted`,
  // `notModerated` and the public half of `scopePredicate` — rather than
  // imported: those are module-private there, and exporting them for one
  // caller would widen that file's surface for a three-clause predicate.
  // `sql.param`, not a bare array: drizzle flattens a JS array in a template
  // hole into one placeholder per element (`matchPredicate` says why).
  const rows = await db.execute<{
    id: string;
    name: string;
    stops: unknown;
    visibility: unknown;
    author_kind: unknown;
    day_count: unknown;
  }>(sql`
    select d.id, d.name, d.stops, d.visibility, d.author_kind, d.day_count
    from saved_days d
    where d.visibility = ${SavedDayVisibility.enum.public}
      and d.deleted_at is null
      and d.moderated_at is null
      and d.owner_id <> ${query.readerId}
      and d.cities && ${sql.param(cities)}::text[]
    order by d.published_at desc nulls last, d.id asc
    limit ${CANDIDATE_DAYS}
  `);

  // A row that fails the read boundary is skipped and logged there, as
  // Discover skips it: one bad day must not empty the list.
  const days = rows.rows.flatMap((row): NearbyStopsCandidateDay[] => {
    const parsed = parseSavedDayColumns({
      savedDayId: row.id,
      stops: row.stops,
      visibility: row.visibility,
      authorKind: row.author_kind,
      dayCount: row.day_count,
    });
    return parsed === null ? [] : [{ savedDayId: row.id, name: row.name, stops: parsed.stops }];
  });
  return rankNearbyStops({ days, cities, anchor, titlesOnDay });
}
