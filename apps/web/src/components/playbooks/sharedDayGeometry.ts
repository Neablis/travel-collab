import type { SavedStop } from "@tc/contracts";

// SPEC §16 — the shared day is a map plus a list. This module is the map's
// half of that, and deliberately all of it that can be decided without a
// browser: which points exist, which legs join them, and whether there is
// enough to draw at all.
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

/** Below two located stops there is nothing a map adds over the list (§16). */
export const MIN_POINTS_TO_DRAW = 2;

function located(stop: SavedStop): stop is SavedStop & { location: { lat: number; lng: number } } {
  return (
    stop.location != null &&
    typeof stop.location.lat === "number" &&
    typeof stop.location.lng === "number"
  );
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
 * Is there enough located detail for a map to say anything?
 *
 * §16: below two located stops the surface **degrades to list-only** rather
 * than rendering an empty canvas. One pin on a world map tells a reader less
 * than the city name already in the list does.
 */
export function worthDrawing(geometry: readonly DayGeometry[]): boolean {
  return allPoints(geometry).length >= MIN_POINTS_TO_DRAW;
}

/**
 * The cache key for what is currently drawn.
 *
 * **It includes the scope**, which is the whole point: without it, switching
 * from `All days` to `Day 2` leaves the previous line on screen, because the
 * points it is keyed on are a subset and nothing looks changed.
 */
export function geometryKey(savedDayId: string, scope: "all" | number, geometry: readonly DayGeometry[]): string {
  const shape = allPoints(geometry)
    .map((p) => `${p.number}@${p.lat.toFixed(5)},${p.lng.toFixed(5)}`)
    .join("|");
  return `${savedDayId}:${scope}:${shape}`;
}
