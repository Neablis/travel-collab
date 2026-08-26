import type { ActivityView, TripDetail } from "@tc/contracts";
import { toMinutes } from "@/lib/time";

/** 7am–11pm, the fixed track SPEC §12 draws every span bar against. */
export const SPAN_TRACK_START_MIN = 7 * 60;
export const SPAN_TRACK_END_MIN = 23 * 60;

export type CityCard = {
  /** Null only when no stop in the group has a location at all. */
  city: string | null;
  stops: number;
  /** Minor units, summed over this group's stops. Null when none carry a cost. */
  costMinor: number | null;
  /** This group's earliest start and latest end, or null if nothing is timed. */
  window: { start: string; end: string } | null;
  /**
   * Position of the filled segment on the 7am–11pm track, 0–1. Null when the
   * group has no timed stop to place. Clamped, so a 6am stop starts at 0 and a
   * midnight one ends at 1 rather than overflowing the bar.
   */
  span: { from: number; to: number } | null;
  /** The group's first start time — what a departing-city strip shows. */
  firstStart: string | null;
};

/**
 * A day's stops grouped into one card per city it touches, in the order the day
 * moves through them (SPEC §12, "Calendar stopped competing with Day columns").
 *
 * The last group is where the day ends, and gets the full card; earlier groups
 * render as one-line strips. That is the design's own framing — "the day
 * belongs to where you end up" — and it is what keeps cell heights even across
 * a week instead of doubling on travel days.
 *
 * **What this deliberately does not do yet.** SPEC §12 splits a travel day at
 * the *last `transit` stop*, and flags `N to book` from "every stop whose kind
 * is neither `booked` nor `transit`". A stop has no `kind` — it lives in note
 * prose (`db-seed.ts` folds it there and says so), so neither rule is
 * computable without parsing text a user can edit. Deferred to M18, by
 * Mitchell's call on 2026-08-26: "Keep Stop Kind as a future milestone, lets
 * just ship what we can for now with the city level cards, and the activities
 * in that city summerized."
 *
 * Grouping on `location.city` instead is right for every day in the current
 * seed, because the seed files a travel stop under the city it travels TO — so
 * the arriving city already owns the whole travel day. When M18 lands, the
 * transit rule refines *this function* and the cards do not change shape.
 *
 * Consecutive grouping, not distinct: a day that returns to a city it left
 * earlier gets three groups, which is what happened rather than a tidier lie.
 */
export function calendarCityCards(
  day: TripDetail["days"][number],
  activities: TripDetail["activities"],
): CityCard[] {
  const groups: { city: string | null; stops: ActivityView[] }[] = [];

  for (const activityId of day.activityIds) {
    const activity = activities[activityId];
    if (activity === undefined) continue;
    // Same city-else-name fallback DayChips.cityFor documents: `location.city`
    // is the geocoder's own structured city, and `name` is the stand-in for a
    // location that predates that field or has no city-level component.
    const city = activity.location ? (activity.location.city ?? activity.location.name) : null;
    const last = groups[groups.length - 1];

    // Only a located stop naming a DIFFERENT city splits the day. A stop with
    // no location tells us nothing about having moved, so it joins the group in
    // progress rather than opening one of its own — otherwise a day of three
    // Rome stops where the flight home has no location renders as "Rome" plus a
    // nameless card, and the nameless one wins the day (caught by
    // CalendarLens.test.tsx's own fixture, which has exactly that shape).
    if (last === undefined) {
      groups.push({ city, stops: [activity] });
    } else if (city === null || city === last.city) {
      last.stops.push(activity);
    } else if (last.city === null) {
      // The day opened with unlocated stops; the first city we learn about is
      // theirs too, since nothing in between said we went anywhere.
      last.city = city;
      last.stops.push(activity);
    } else {
      groups.push({ city, stops: [activity] });
    }
  }

  return groups.map(({ city, stops }) => {
    const windows = stops
      .map((s) => s.timeWindow)
      .filter((w): w is { start: string; end: string } => w !== null && w !== undefined);

    const costs = stops.map((s) => s.cost?.amountMinor).filter((c): c is number => c !== undefined);

    const window =
      windows.length === 0
        ? null
        : {
            start: windows.reduce((a, w) => (toMinutes(w.start) < toMinutes(a) ? w.start : a), windows[0]!.start),
            end: windows.reduce((a, w) => (toMinutes(w.end) > toMinutes(a) ? w.end : a), windows[0]!.end),
          };

    const clamp = (min: number) =>
      Math.min(1, Math.max(0, (min - SPAN_TRACK_START_MIN) / (SPAN_TRACK_END_MIN - SPAN_TRACK_START_MIN)));

    return {
      city,
      stops: stops.length,
      costMinor: costs.length === 0 ? null : costs.reduce((a, c) => a + c, 0),
      window,
      span: window === null ? null : { from: clamp(toMinutes(window.start)), to: clamp(toMinutes(window.end)) },
      firstStart: window?.start ?? null,
    };
  });
}
