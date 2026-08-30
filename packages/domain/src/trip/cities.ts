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
export function citiesOfDay(detail: TripDetail, dayIndex: number): string[] {
  const day = detail.days[dayIndex];
  if (!day) return [];

  const timed: { city: string; start: string }[] = [];
  const untimed: string[] = [];
  for (const id of day.activityIds) {
    const activity = detail.activities[id];
    const city = activity?.location?.city;
    if (!city) continue;
    if (activity!.timeWindow) {
      timed.push({ city, start: activity!.timeWindow.start });
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
