import type { TripDetail } from "@tc/contracts";

// The `read_trip` readout needs a day's SHAPE cheaply — which cit(y/ies) it
// touches — so a model can find "which days are near Nara" without opening
// every day (`read_day`) to find out. That was the actual failure this exists
// to fix (2026-08-29 live run): no city on `read_trip` meant the model's only
// move was a roll call of every day, one `read_day` at a time.
//
// A day can span more than one city — a travel day, the exact case
// `conflicts.ts`'s `transitExcusesDistance` was written to excuse a distance
// conflict on — so this returns a LIST, not a single value.
//
// Three decisions, each load-bearing enough to need a test:
//
//   1. **Order is TIME order, not stored order**, for the same reason
//      `transitExcusesDistance` insists on it there: `day.activityIds` is
//      display order, which a user can reorder without changing when anything
//      actually happens, and "does this day end near Nara" needs the real
//      sequence. A stop with no time window cannot be placed in time, so — the
//      same conservative call `conflicts.ts` makes ("we don't know when this
//      is" is not evidence either way) — its city is appended AFTER every
//      timed city, in the day's stored order among themselves.
//   2. **`location.city` only**, never `cityFor`'s name/area fallback
//      (`DayChips.tsx`). That fallback exists so a day chip always has
//      something to show; answering "which CITY" with a fallback that might
//      not be one would trade a missing answer for a wrong one.
//   3. **Duplicates collapse to the first occurrence.** A day trip that starts
//      and ends in the same city reports it once, so "how many cities does
//      this day touch" reads directly off the list length.
//
// A day with no located, city-bearing stop reports `[]` — not `null` and not
// an omitted field — the same "nothing to report" shape `find_free_time`'s
// empty `gaps` array already uses.

/**
 * What the rule above actually reads off a stop: when it happens, and where.
 *
 * Structural rather than a contract type because two different stop shapes
 * need the identical answer — `ActivityView` (a day inside a trip) and
 * `SavedStop` (a day lifted out of one, M11b link 1). Both spell these two
 * fields `T | null`, so both satisfy this without an adapter.
 */
type CityBearingStop = {
  timeWindow: { start: string } | null;
  location: { city?: string | undefined } | null;
};

/**
 * The rule itself, over an ordered list of stops — **the one implementation**.
 *
 * It is exported and shared rather than reimplemented per caller because a
 * saved day's stored `cities` and the trip readout's `citiesOfDay` are read
 * side by side in M11b: a public profile counts a person's cities from the
 * former, Discover matches on the same column, and a second rule that agreed
 * today would be free to drift tomorrow. Two implementations disagreeing is
 * exactly how a profile's numbers come to contradict Discover's, which is one
 * of that milestone's gate boxes.
 *
 * `undefined` entries are tolerated so `citiesOfDay` can hand over a raw
 * id-to-activity lookup: an id naming no activity contributes no city, the
 * same as a stop with no location.
 */
export function citiesOfStops(stops: readonly (CityBearingStop | undefined)[]): string[] {
  const timed: { city: string; start: string }[] = [];
  const untimed: string[] = [];
  for (const stop of stops) {
    const city = stop?.location?.city;
    if (!city) continue;
    if (stop!.timeWindow) {
      timed.push({ city, start: stop!.timeWindow.start });
    } else {
      untimed.push(city);
    }
  }
  // Lexicographic order agrees with chronological order for zero-padded
  // "HH:mm" — the same fact `findFreeGaps`'s callers rely on elsewhere.
  timed.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));

  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const city of [...timed.map((t) => t.city), ...untimed]) {
    if (seen.has(city)) continue;
    seen.add(city);
    ordered.push(city);
  }
  return ordered;
}

/**
 * The rule over a saved SEQUENCE — several days as one flat, day-indexed array
 * (M23, ADR-048 decision 4).
 *
 * **This exists because `citiesOfStops` is wrong for a sequence, and wrong
 * quietly.** Decision 1 above makes it sort timed stops into TIME order across
 * everything it is handed — which is exactly right for one day and produces
 * nonsense for three: a 08:00 stop on day 3 sorts ahead of a 14:00 stop on day
 * 1, so the stored `cities` snapshot comes out in an order the sequence never
 * runs in. Before M23 no caller could hit it, because every caller had one
 * day's stops.
 *
 * So the fix FOLDS the one rule rather than adding a second: group by
 * `dayIndex`, apply `citiesOfStops` within each day, concatenate in day order,
 * and collapse duplicates to their first occurrence across the whole sequence.
 * That is the same relationship `citiesOfDay` below already has to
 * `citiesOfStops`, and it is the standing argument in this repo against a
 * second implementation — a profile's cities and Discover's must not be able to
 * disagree.
 *
 * A one-day sequence is byte-identical to `citiesOfStops` over the same stops,
 * which is what makes this safe to adopt everywhere rather than behind a
 * length check.
 *
 * Duplicates collapse ACROSS days, not within them: a three-day loop that
 * returns to Kyoto on day 3 reports Kyoto once, in the position day 1 put it.
 * "How many cities does this sequence touch" stays a length.
 */
export function citiesOfSequence(
  stops: readonly (CityBearingStop & { dayIndex?: number | undefined })[],
): string[] {
  const byDay = new Map<number, (CityBearingStop & { dayIndex?: number | undefined })[]>();
  for (const stop of stops) {
    const day = stop.dayIndex ?? 0;
    const bucket = byDay.get(day);
    if (bucket === undefined) byDay.set(day, [stop]);
    else bucket.push(stop);
  }
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const day of [...byDay.keys()].sort((a, b) => a - b)) {
    for (const city of citiesOfStops(byDay.get(day)!)) {
      if (seen.has(city)) continue;
      seen.add(city);
      ordered.push(city);
    }
  }
  return ordered;
}

/** The rule over one day of a trip. A day index past the end reports `[]`. */
export function citiesOfDay(detail: TripDetail, dayIndex: number): string[] {
  const day = detail.days[dayIndex];
  if (!day) return [];
  return citiesOfStops(day.activityIds.map((id) => detail.activities[id]));
}
