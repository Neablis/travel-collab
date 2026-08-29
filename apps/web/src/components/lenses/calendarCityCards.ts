import type { ActivityView, TripDetail } from "@tc/contracts";
import { needsBooking } from "@/lib/needsBooking";
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
  /** The group's first start time. A strip falls back to this when it has no `departsAt`. */
  firstStart: string | null;
  /**
   * Stops in this group whose kind is neither `booked` nor `transit` — SPEC
   * §12's `N to book`. Always a number; `CalendarLens` renders the flag only
   * when it is > 0, so "nothing to book" is 0 rather than null.
   */
  toBook: number;
  /**
   * The departure: the **start** of the transit stop that closed this group,
   * which is what SPEC §12 puts on a departing strip. Null when this group was
   * not closed by a transit stop.
   *
   * This is deliberately not `firstStart`. A Tokyo morning with breakfast at
   * 07:00 and a shinkansen at 08:20 has `firstStart: "07:00"` and
   * `departsAt: "08:20"` — the first is when the day started, the second is
   * when you left, and the strip wants the second.
   */
  departsAt: string | null;
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
  // SPEC §12's travel-day rule, ahead of the consecutive-city path below: a day
  // carrying a transit stop splits at the LAST one — everything up to and
  // including it belongs to the city you leave, everything after to the city
  // you arrive in. Binary on purpose. A Tokyo → Nagoya → Kyoto day is two
  // cards, not three, which is what keeps cell heights even across a week
  // instead of doubling on exactly the days that already carry the most.
  const split = transitSplit(day, activities);
  if (split !== null) return split;

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

  return groups.map((g) => summarise(g.city, g.stops, null));
}

/** SPEC §12: "every stop whose kind is neither `booked` nor `transit`". */
function unbookedCount(stops: ActivityView[]): number {
  return stops.filter((s) => needsBooking(s.kind)).length;
}

/**
 * One group of a day's stops, reduced to the card `CalendarLens` draws.
 *
 * `departsAt` is passed in rather than derived: only the transit split knows
 * which stop closed a group, and it is the one thing about a card that cannot
 * be read off the group's own stops.
 */
function summarise(city: string | null, stops: ActivityView[], departsAt: string | null): CityCard {
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
    toBook: unbookedCount(stops),
    departsAt,
  };
}

/**
 * The travel-day split, or null when this day is not one.
 *
 * Returns null — deferring to consecutive-city grouping — in two cases:
 *
 * 1. **No transit stop.** An ordinary day; nothing to split at.
 * 2. **The departing side has no nameable non-transit stop.** The departing
 *    city cannot be read off the transit stop itself: the fixture files a
 *    travel stop under the city it travels TO (see the note above), so the
 *    shinkansen's own `location.city` is where you are going, not where you
 *    left. Leaving first thing, with nothing before the train, therefore leaves
 *    the departing city genuinely unknowable from this day alone. Splitting
 *    anyway would render exactly the empty label and bare timestamp that
 *    folding city-less stops was introduced to kill. A split we cannot label is
 *    worse than no split.
 */
function transitSplit(
  day: TripDetail["days"][number],
  activities: TripDetail["activities"],
): CityCard[] | null {
  const stops = day.activityIds.map((id) => activities[id]).filter((a): a is ActivityView => a !== undefined);

  const lastTransit = stops.map((s) => s.kind).lastIndexOf("transit");
  if (lastTransit === -1) return null;

  const departing = stops.slice(0, lastTransit + 1);
  const arriving = stops.slice(lastTransit + 1);

  // The last non-transit stop that names a city is where you left from. Reading
  // it from the END matters on a multi-leg day: Tokyo → Nagoya → Kyoto splits at
  // the second train, and the city you depart from on that leg is Nagoya.
  const departingCity =
    departing
      .filter((s) => s.kind !== "transit")
      .map((s) => s.location?.city ?? null)
      .filter((c): c is string => c !== null)
      .pop() ?? null;
  if (departingCity === null) return null;

  const arrivingCity = arriving.map((s) => s.location?.city ?? null).find((c): c is string => c !== null) ?? null;

  // The transit stop's START is the departure — SPEC §12 is explicit that this,
  // not the departing group's first stop, is what the strip shows.
  const departsAt = stops[lastTransit]!.timeWindow?.start ?? null;

  const cards = [summarise(departingCity, departing, departsAt)];
  // Everything after the last transit stop is the arriving card. A day whose
  // transit stop is its final stop leaves nothing on the arriving side; the
  // departing card then stands alone and still carries the day's numbers.
  if (arriving.length > 0) cards.push(summarise(arrivingCity, arriving, null));
  return cards;
}
