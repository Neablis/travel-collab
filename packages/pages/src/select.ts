import type {
  ActivityView,
  CityRef,
  DateRangeRef,
  DayRef,
  KindRef,
  PersonRef,
  TagRef,
  TripDetail,
  TripGlobals,
  TripGlobalsCity,
} from "@tc/contracts";
import { ok, unbound, type MacroResult } from "./result";

// **The selection, in one place.** ADR-039 decision 1 says a widget is a
// selection over one entity plus a shape; every primitive shares the selection
// and differs only in what it does with it, so the selection is written once
// here and eleven resolvers read it.
//
// That is the whole bet of the ADR made concrete: `itinerary.trip`'s bug —
// rendering a list of lists — happened because *"nothing in the model said what
// a block widget does when its selection holds many members, so a widget
// answered it locally, and wrongly"*. A shared `narrow` is the model saying it.

/**
 * A widget's filter bindings, as its params carry them (ADR-039 decision 2).
 *
 * Every member optional, and **absent means every member of the set** — not
 * "unset". The key names are the dimension names, which is what `paramKeyOf`
 * declares and what the spec's preset table writes (`cost{day: N}`).
 */
export interface WidgetFilterValues {
  day?: DayRef;
  city?: CityRef;
  tag?: TagRef;
  kind?: KindRef;
  person?: PersonRef;
  dates?: DateRangeRef;
}

/** One stop that survived the filters, with the day it sits on. */
export interface SelectedStop {
  activityId: string;
  activity: ActivityView;
  /** Index into `trip.days`, or `null` for a backlog (unscheduled) stop. */
  dayIndex: number | null;
}

export interface Narrowed {
  /** The bindings this selection was made with, so a primitive can ask what was set. */
  filters: WidgetFilterValues;
  /** Day indexes that survive the day-selecting dimensions, ascending. */
  days: readonly number[];
  /**
   * Stops that survive every dimension: the selected days' stops in board
   * order, then the backlog. Backlog stops are included ONLY when no
   * day-derived dimension is set — an unscheduled stop is on no day and in no
   * date range, so `cost{day: 3}` must not count it while `cost{}` must.
   */
  stops: readonly SelectedStop[];
  /** Cities that survive the city-selecting dimensions, in arrival order. */
  cities: readonly TripGlobalsCity[];
  /** True when any dimension is bound — "wide" told apart from "narrowed to everything". */
  narrowed: boolean;
  /**
   * True when a dimension that narrows a day's CONTENTS is bound (`city`, `tag`,
   * `kind`). `day.detail{kind: booked}` keeps only days with a booking; unfiltered
   * `day.detail` keeps every day, empty ones included.
   */
  contentNarrowed: boolean;
}

/**
 * Resolve a day binding to an index into `trip.days`, or `null`.
 *
 * `null` covers both shapes of "no day": a ref pointing past the end, and a
 * `dayId` for a day that has been deleted. **A stale binding is never a guessed
 * one** — writing about day 1 because day 100 was removed is a confident wrong
 * answer — and the callers differ in what they do about it, which is why this
 * reports the fact rather than deciding: the named day widgets return
 * `unbound("day")`, and so does `narrow` below.
 */
export function dayIndexOf(trip: TripDetail, ref: DayRef | undefined): number | null {
  if (!ref) return null;
  if (ref.kind === "index") return ref.index < trip.days.length ? ref.index : null;
  const index = trip.days.findIndex((d) => d.dayId === ref.dayId);
  return index === -1 ? null : index;
}

// Whether a day's date falls inside a bound range. ISO dates compare correctly
// as strings, which is what `DateRangeRef` says and what `day.window` already
// relies on for times: no `Date` construction, no timezone, no clock read
// (Invariant 4).
const inRange = (date: string | null, range: DateRangeRef): boolean =>
  date !== null && date >= range.from && date <= range.through;

/**
 * Narrow the trip to what a widget's filters select, or refuse.
 *
 * Two refusals, and they are the only two:
 *
 * - **`unbound("person")`** whenever a person is bound. ADR-039 decision 7: the
 *   dimension is vocabulary, not a capability — `TripMember` carries no display
 *   name and no stop carries a person at all — so a widget asked to narrow by
 *   one answers ADR-037 decision 7's "needs a field" state rather than
 *   filtering against data that does not exist. It is deliberately NOT "ignore
 *   the filter and show everything": a filter that quietly stops filtering is
 *   the worst of the three answers.
 * - **`unbound("day")`** when a day IS bound and resolves to no day. Absent is
 *   every day (decision 2 retires `unbound` for a filter left alone); a ref
 *   aimed at a deleted day is a binding aimed at nothing, and the chrome row is
 *   where it gets fixed.
 *
 * `globals` is optional for the reason every other resolver takes it that way:
 * it is a separate request, and a widget saying it has nothing to show beats a
 * notebook that will not open. Without it there are no cities, so a bound city
 * matches nothing and an unbound one narrows nothing.
 */
export function narrow(
  trip: TripDetail,
  globals: TripGlobals | null,
  filters: WidgetFilterValues,
): MacroResult<Narrowed> {
  if (filters.person !== undefined) return unbound("person");

  const boundDay = filters.day === undefined ? null : dayIndexOf(trip, filters.day);
  if (filters.day !== undefined && boundDay === null) return unbound("day");

  const citiesOfDay = (index: number): readonly string[] => globals?.days[index]?.cities ?? [];

  // Which days survive. `day`, `dates` and `city` all select days; `tag` and
  // `kind` are about a day's contents and are applied to stops below.
  const days: number[] = [];
  for (let index = 0; index < trip.days.length; index++) {
    if (boundDay !== null && index !== boundDay) continue;
    if (filters.dates && !inRange(trip.days[index]!.date, filters.dates)) continue;
    if (filters.city && !citiesOfDay(index).includes(filters.city)) continue;
    days.push(index);
  }
  const daySet = new Set(days);

  // A stop's city is **its own, falling back to its day's**.
  //
  // Neither half alone is right. By the stop's own `location.city` only, an
  // unlocated stop matches no city — so `cost{city: "Tokyo"}` would silently
  // drop the untagged dinner on a Tokyo day and UNDER-REPORT money, which is
  // the one direction a cost widget must not be wrong in. By its day's cities
  // only, the Kyoto hotel booked on the Tokyo→Kyoto travel day counts as Tokyo,
  // because a travel day touches two cities.
  //
  // So: a located stop is where it says it is, and an unlocated one is where its
  // day is. That is also how a person reads the board.
  const stopInCity = (activity: ActivityView, dayIndex: number | null, city: CityRef): boolean => {
    const own = activity.location?.city;
    if (own) return own === city;
    return dayIndex !== null && citiesOfDay(dayIndex).includes(city);
  };

  const stopSelected = (activity: ActivityView, dayIndex: number | null): boolean => {
    if (filters.tag && !activity.tags.includes(filters.tag)) return false;
    if (filters.kind && activity.kind !== filters.kind) return false;
    if (filters.city && !stopInCity(activity, dayIndex, filters.city)) return false;
    return true;
  };

  const stops: SelectedStop[] = [];
  for (const dayIndex of days) {
    for (const activityId of trip.days[dayIndex]!.activityIds) {
      const activity = trip.activities[activityId];
      if (!activity || !stopSelected(activity, dayIndex)) continue;
      stops.push({ activityId, activity, dayIndex });
    }
  }
  // The backlog, and the reason it is conditional is arithmetic rather than
  // taste: ADR-039's table says **`cost` wide equals `cost.trip` exactly**,
  // and `tripCostTotal` is every day plus the unscheduled subtotal. Walking
  // `trip.days` and `trip.backlog` is what `rollupCosts` walks, so a wide
  // selection sums to the board's own number — not a second implementation of
  // it, the same one narrowed. A day or a date range excludes the backlog
  // because an unscheduled stop is on no day and has no date.
  if (filters.day === undefined && filters.dates === undefined) {
    for (const activityId of trip.backlog) {
      const activity = trip.activities[activityId];
      if (!activity || !stopSelected(activity, null)) continue;
      stops.push({ activityId, activity, dayIndex: null });
    }
  }

  // Cities. `globals.cities` is already in arrival order — it is accumulated in
  // day order by `buildTripGlobals` — so this filters rather than re-sorts.
  // A city with no days behind it is a backlog-only city, and a day or date
  // filter therefore excludes it.
  const cities = (globals?.cities ?? []).filter((city) => {
    if (filters.city && city.name !== filters.city) return false;
    if (filters.day !== undefined || filters.dates !== undefined) {
      return city.dayIndexes.some((index) => daySet.has(index));
    }
    return true;
  });

  return ok({
    filters,
    days,
    stops,
    cities,
    narrowed: Object.values(filters).some((v) => v !== undefined),
    contentNarrowed:
      filters.city !== undefined || filters.tag !== undefined || filters.kind !== undefined,
  });
}

/**
 * What a selection of stops costs, in the trip's minor units.
 *
 * The same sum `rollupCosts` performs in `@tc/domain` — `cost?.amountMinor ?? 0`
 * over the stops of the days plus the backlog — which is what makes ADR-039's
 * *"one number, one implementation, no second answer that can drift from the
 * board's"* true rather than aspirational: wide, this equals `tripCostTotal`;
 * narrowed to one day, it equals that day's `costSubtotal`. Both are asserted in
 * `select.test.ts` against a trip whose totals the domain computed.
 *
 * A stop's own `cost.currency` is not converted, exactly as the domain does not
 * convert it. Mixing currencies on one trip produces a number nobody should
 * trust, and it produces the SAME untrustworthy number the board already shows,
 * which is the property that matters here.
 */
export const costOfStops = (stops: readonly SelectedStop[]): number =>
  stops.reduce((sum, stop) => sum + (stop.activity.cost?.amountMinor ?? 0), 0);
