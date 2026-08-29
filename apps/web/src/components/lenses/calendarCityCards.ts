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
  /** The group's first start time. */
  firstStart: string | null;
  /**
   * Stops in this group whose kind is neither `booked` nor `transit` — SPEC
   * §12's `N to book`. Always a number; `CalendarLens` renders the flag only
   * when it is > 0, so "nothing to book" is 0 rather than null.
   */
  toBook: number;
};

/**
 * A day's stops grouped into one card per city it touches, in the order the day
 * moves through them (SPEC §12, "Calendar stopped competing with Day columns").
 *
 * Every group renders as a full card of equal weight, plus a final bucket for
 * stops with no city. There are no strips and no transit rule here — both were
 * built in M18 and removed the same day, by Mitchell's call on 2026-08-29:
 *
 *   > I kinda always pictured the calendar page a zoomed out trip, what cities
 *   > are on what days of the week, it doesn't really concern itself with the
 *   > day of activities, which is what transit is about. Timeline view and map
 *   > view is how I zoom in and see a specific day, how I get around.
 *
 * So `kind` never reaches the grouping. **`N to book` is the one thing here
 * that reads `kind`**, and it is a count rather than a layout decision.
 *
 * Why SPEC §12's travel-day split is gone, recorded because the design still
 * specifies it: it split a day at the last `transit` stop and labelled the
 * departing card from the stops before it. Walked against the canonical
 * fixture it fired on **one** of seven travel days, and got that one wrong —
 * because five travel days open with the train (nothing before it names an
 * origin) and every stop on a travel day is tagged with the DESTINATION city
 * (KI-59). The rule's output therefore depended on how the fixture happened to
 * tag cities, which is the drift Mitchell objected to. The day-to-day
 * transition it was trying to express is now the *day label's* job
 * (`DayChips.cityFor`), derived from yesterday's and today's last placed
 * activity, and needs no `kind` at all.
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

  // City-less stops get their OWN bucket card, last — Mitchell's standing
  // instruction from the #71 preview, restored 2026-08-29: "Never fall back to
  // name, if you have absolutely no city, then make a new bucket with no city
  // in title."
  //
  // They were folded into the day's last city for a while instead, because
  // CalendarLens used to render every group but the last as a one-line
  // "<city> <time>" strip — so a nameless group showed an empty label above a
  // naked timestamp ("Whats with the time above the card?"). M18 dropped strips
  // and every group is now a full card, which a missing city heading survives.
  //
  // ONE bucket per day, not one per stop, so a day never fragments into several
  // anonymous places — and it does not donate its count, cost or window to a
  // city the stop was never in.
  const groups: { city: string | null; stops: ActivityView[] }[] = [...cityGroups];
  if (unplaced.length > 0) groups.push({ city: null, stops: unplaced });

  return groups.map((g) => summarise(g.city, g.stops));
}

/** SPEC §12: "every stop whose kind is neither `booked` nor `transit`". */
function unbookedCount(stops: ActivityView[]): number {
  return stops.filter((s) => needsBooking(s.kind)).length;
}

/** One group of a day's stops, reduced to the card `CalendarLens` draws. */
function summarise(city: string | null, stops: ActivityView[]): CityCard {
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
  };
}
