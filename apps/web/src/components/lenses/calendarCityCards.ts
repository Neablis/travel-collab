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
  // Cities only. `location.name` is a display label — "Gonpachi Nishiazabu" —
  // and it used to stand in for a missing `city`, which meant a restaurant
  // opened a city group and split the day as if you had travelled to it
  // (Mitchell, walking the #71 preview). A name is never an identity here.
  //
  // Everything with no city goes in ONE untitled bucket rather than each
  // opening its own, so a day never fragments into several anonymous places.
  const cityGroups: { city: string; stops: ActivityView[] }[] = [];
  const unplaced: ActivityView[] = [];

  for (const activityId of day.activityIds) {
    const activity = activities[activityId];
    if (activity === undefined) continue;
    const city = activity.location?.city ?? null;
    if (city === null) {
      unplaced.push(activity);
      continue;
    }
    const last = cityGroups[cityGroups.length - 1];
    // Consecutive stops in the same city are one group; a different city opens
    // the next one. Returning to a city later in the day is a new group again,
    // which is right — you went back.
    if (last !== undefined && last.city === city) last.stops.push(activity);
    else cityGroups.push({ city, stops: [activity] });
  }

  // City-less stops FOLD INTO the day's last city rather than forming a group
  // of their own (Mitchell, walking the #71 preview: "Whats with the time above
  // the card?"). They used to be appended as a `city: null` group, and
  // CalendarLens renders every group except the arriving one as a one-line
  // strip of "<city> <time>" — so a nameless group rendered an empty label and
  // a bare timestamp hanging above the card, which says nothing to anyone.
  //
  // Folding is better than dropping the strip: those stops really did happen
  // that day, so their count, cost and time still belong in the day's numbers.
  // They join the LAST city group because that is the day's arriving card —
  // where the day ends up, and the card that carries the day's totals.
  //
  // A day with no city ANYWHERE still yields one untitled group, which is the
  // honest "we don't know where this was" and keeps the day's numbers visible.
  const groups: { city: string | null; stops: ActivityView[] }[] = [...cityGroups];
  if (unplaced.length > 0) {
    const arriving = groups[groups.length - 1];
    if (arriving === undefined) groups.push({ city: null, stops: unplaced });
    else arriving.stops = [...arriving.stops, ...unplaced];
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
