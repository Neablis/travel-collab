import type { SavedStop } from "@tc/contracts";
import { MIN_POINTS_TO_DRAW } from "@tc/contracts";

// SPEC §16 — the shared day is a map plus a list. This module is the map's
// half of that, and deliberately all of it that can be decided without a
// browser: which points exist, which legs join them, and what the map frame
// holds for them (`mapShape`).
//
// It is pure because the three rules below are the ones that have historically
// been got wrong, and none of them needs MapLibre to be tested:
//
//   1. **Geometry is per DAY, and `All days` is a merge, not a concatenation.**
//   2. **No leg may join the last stop of one day to the first of the next.**
//      A straight line across a night is a fact the map would be inventing —
//      nobody walked it, and the line says they did.
//   3. **The cache key includes the day**, or switching tabs leaves the
//      previous day's line on screen.

/** A stop that actually has somewhere to be drawn. */
export type MapPoint = {
  /** Its number in the current scope — the same number the list shows. */
  number: number;
  title: string;
  lat: number;
  lng: number;
  /** 0-based day, so a merged view can colour or group by it. */
  dayIndex: number;
};

/** Two consecutive located stops **on the same day**. */
export type MapLeg = {
  from: MapPoint;
  to: MapPoint;
  /**
   * True when the two stops are consecutive in the day's list, false when
   * located stops were separated by one or more stops with no location.
   *
   * The map draws a gap differently because the line between them is a
   * guess about a route that skipped something, not a leg somebody took.
   */
  contiguous: boolean;
};

export type DayGeometry = { dayIndex: number; points: readonly MapPoint[]; legs: readonly MapLeg[] };

// Re-exported so this module stays the one place the map code imports from,
// while `@tc/contracts` stays the one place the NUMBER is written down.
export { MIN_POINTS_TO_DRAW };

function hasCoords(stop: SavedStop): stop is SavedStop & { location: { lat: number; lng: number } } {
  return (
    // `Number.isFinite`, not `typeof === "number"`: `typeof NaN` is `"number"`,
    // so the weaker check called a stop located and handed NaN straight to
    // MapLibre, which silently draws nothing. Found by CodeRabbit on PR #196
    // against the fixtures test — the same hole was here, in the code that
    // actually feeds the map.
    stop.location != null &&
    Number.isFinite(stop.location.lat) &&
    Number.isFinite(stop.location.lng)
  );
}

/**
 * A stop with a coordinate of ITS OWN — a pin, and a point on the route.
 *
 * **A city-level coordinate is not one** (M27 link 10). `precision: "city"`
 * says "somewhere in this city" (contracts `activity.ts`), and the backfill
 * that puts Playbooks on the map writes exactly that for every stop the vendor
 * could not corroborate. Treated as a pin, five such stops are five numbered
 * pins stacked on one centroid and a route of zero length between them — a
 * picture of a walk nobody took. They are drawn as a city instead
 * (`cityMarkers`).
 */
function located(stop: SavedStop): stop is SavedStop & { location: { lat: number; lng: number } } {
  return hasCoords(stop) && stop.location.precision !== "city";
}

/**
 * One day's points and legs.
 *
 * `startNumber` is what the first stop of this day is numbered in the current
 * scope, so the pins agree with the list — continuous across `All days`, from
 * 1 within one day (§33.1).
 *
 * **Numbering counts every stop, located or not.** A stop with no location has
 * no pin, but it still has a number in the list, and a map whose pin 4 sat
 * beside the list's stop 5 would be worse than one with a gap in its numbers.
 */
export function dayGeometry(
  stops: readonly SavedStop[],
  dayIndex: number,
  startNumber = 1,
): DayGeometry {
  const points: MapPoint[] = [];
  const legs: MapLeg[] = [];
  let skippedSinceLast = false;

  stops.forEach((stop, i) => {
    if (!located(stop)) {
      if (points.length > 0) skippedSinceLast = true;
      return;
    }
    const point: MapPoint = {
      number: startNumber + i,
      title: stop.title,
      lat: stop.location.lat,
      lng: stop.location.lng,
      dayIndex,
    };
    const previous = points[points.length - 1];
    if (previous !== undefined) legs.push({ from: previous, to: point, contiguous: !skippedSinceLast });
    points.push(point);
    skippedSinceLast = false;
  });

  return { dayIndex, points, legs };
}

/**
 * Every day's geometry, in order.
 *
 * **The merge happens by concatenating the per-day results, never by running
 * one pass over all the stops.** A single pass would join the last located stop
 * of day 1 to the first of day 2 — the leg across a night that rule 2 forbids —
 * and it would do so silently, because the resulting line looks exactly like
 * every other leg.
 */
export function playbookGeometry(
  days: readonly { dayIndex: number; stops: readonly SavedStop[] }[],
  { continuousNumbering = true }: { continuousNumbering?: boolean } = {},
): readonly DayGeometry[] {
  let running = 1;
  return days.map((day) => {
    const geometry = dayGeometry(day.stops, day.dayIndex, continuousNumbering ? running : 1);
    running += day.stops.length;
    return geometry;
  });
}

/** Every point across the given days, in order. */
export function allPoints(geometry: readonly DayGeometry[]): readonly MapPoint[] {
  return geometry.flatMap((g) => g.points);
}

/** Every leg across the given days — and never one between two of them. */
export function allLegs(geometry: readonly DayGeometry[]): readonly MapLeg[] {
  return geometry.flatMap((g) => g.legs);
}

/**
 * Is there enough located detail for a ROUTE?
 *
 * Two pins or more. This used to decide whether there was a map at all — §16's
 * degrade-to-list-only below two located stops — and that rule is gone (M27
 * link 10, Mitchell: *"Every playbook should have maps"*). Below two, the map
 * still draws whatever there is to place; see `mapShape`.
 */
export function worthDrawing(geometry: readonly DayGeometry[]): boolean {
  return allPoints(geometry).length >= MIN_POINTS_TO_DRAW;
}

/** A city the stops in view happen in, at the centre the backfill stored for it. */
export type CityMarker = { city: string; lat: number; lng: number; stops: number };

/**
 * One marker per city among the in-scope stops that are placed only at city
 * level — the map's answer when the stops themselves are not pinned yet.
 *
 * Grouped by the city's NAME, and placed at the first coordinate stored for
 * it: the backfill writes one centre per city, so every stop in a city carries
 * the same one.
 */
export function cityMarkers(
  days: readonly { dayIndex: number; stops: readonly SavedStop[] }[],
  scope: "all" | number,
): readonly CityMarker[] {
  const byCity = new Map<string, CityMarker>();
  for (const day of scope === "all" ? days : days.filter((d) => d.dayIndex === scope)) {
    for (const stop of day.stops) {
      if (!hasCoords(stop) || stop.location.precision !== "city") continue;
      const city = stop.location.city ?? stop.location.name;
      const key = city.trim().toLowerCase();
      const marker = byCity.get(key);
      if (marker) marker.stops += 1;
      else byCity.set(key, { city, lat: stop.location.lat, lng: stop.location.lng, stops: 1 });
    }
  }
  return [...byCity.values()];
}

/** What the map frame holds — see `mapShape`. */
export type MapShape = "route" | "places" | "none";

/**
 * What the map frame holds for what is in view (M27 link 10).
 *
 *   * `route` — two pins or more: the numbered pins and the line between them.
 *   * `places` — anything less that can still be placed: a lone pin, or the
 *     cities the day happens in. No line, because there is no route to draw.
 *   * `none` — nothing to place at all. The frame still renders, empty and
 *     saying so, so the page never reflows (Mitchell).
 */
export function mapShape(geometry: readonly DayGeometry[], cities: readonly CityMarker[]): MapShape {
  if (worthDrawing(geometry)) return "route";
  return allPoints(geometry).length > 0 || cities.length > 0 ? "places" : "none";
}

/**
 * The cache key for what is currently drawn.
 *
 * **It includes the scope**, which is the whole point: without it, switching
 * from `All days` to `Day 2` leaves the previous line on screen, because the
 * points it is keyed on are a subset and nothing looks changed.
 */
export function geometryKey(
  savedDayId: string,
  scope: "all" | number,
  geometry: readonly DayGeometry[],
  cities: readonly CityMarker[] = [],
): string {
  const shape = allPoints(geometry)
    .map((p) => `${p.number}@${p.lat.toFixed(5)},${p.lng.toFixed(5)}`)
    .join("|");
  // The cities too, or a backfill that lands while the page is open — cities
  // arriving where there were none — would leave the empty frame standing.
  const places = cities.map((c) => `${c.city}@${c.lat.toFixed(5)},${c.lng.toFixed(5)}`).join("|");
  return `${savedDayId}:${scope}:${shape}:${places}`;
}

/**
 * The geometry of whatever the reader is looking at: every day under `All
 * days`, one day otherwise — numbered the way the LIST numbers that scope
 * (continuous across the whole Playbook, restarting at 1 inside one day).
 *
 * One function because two consumers must agree on it: the map draws its pins
 * from it and the stop list reads its leg lines from it, and a leg line keyed
 * to stop 5 under a row the list calls 1 is the disagreement this file exists
 * to prevent.
 */
export function scopedGeometry(
  days: readonly { dayIndex: number; stops: readonly SavedStop[] }[],
  scope: "all" | number,
): readonly DayGeometry[] {
  const geometry = playbookGeometry(days, { continuousNumbering: scope === "all" });
  return scope === "all" ? geometry : geometry.filter((g) => g.dayIndex === scope);
}
