import { z } from "zod";
import type { FilterDimension, TripDetail } from "@tc/contracts";
import type {
  CityDetailPayload,
  ItineraryDayPayload,
  ItineraryTripPayload,
  MacroDef,
  WidgetContext,
} from "../../registry-types";
import { blockOf } from "../../registry-types";
import { ok, empty, needsTrip, type MacroResult } from "../../result";
import { filterInputs, filterParams } from "../../filters";
import { cityDayOrdinals, narrow, stopsInCity, type SelectedStop } from "../../select";
import { formatMoney } from "../../format";

// The `block` primitives (ADR-039 decision 1): a shape that **details** its
// selection — one member renders one card, many render one card per member
// under headers.
//
// **This is the shape the ADR was written about.** `itinerary.trip` rendered by
// stacking a whole `itinerary.day` card per day — a list of lists — because
// *"nothing in the model said what a block widget does when its selection holds
// many members, so a widget answered it locally, and wrongly"*. Here the answer
// is in one place: one selected day is a day card, many are the day table, and
// that is a fact about the arity of the selection rather than about which widget
// somebody inserted.

// One day's card, built from the stops that survived the filters rather than
// from the day's whole `activityIds`. That difference is the whole of
// `day.detail{kind: booked}` — "everything on a day, booked only", the spec's
// own example of a preset no widget covers today.
function dayCard(trip: TripDetail, index: number, stops: readonly SelectedStop[]): ItineraryDayPayload {
  const day = trip.days[index]!;
  return {
    kind: "itinerary-day",
    dayId: day.dayId,
    // Which day of the TRIP this is, counting from 1 — not its position in the
    // selection. `day.detail{kind: booked}` can leave days 2 and 5, and
    // labelling them "Day 1" and "Day 2" would be the selection's private
    // numbering printed onto the page as a fact about the trip.
    ordinal: index + 1,
    date: day.date,
    activities: stops.map(({ activity }) => ({
      title: activity.title,
      timeWindow: activity.timeWindow ? `${activity.timeWindow.start}–${activity.timeWindow.end}` : null,
      cost: activity.cost ? formatMoney(activity.cost.amountMinor, trip.currency) : null,
    })),
  };
}

const DAY_DETAIL_FILTERS = ["day", "city", "tag", "kind", "dates"] as const satisfies readonly FilterDimension[];
const DayDetailParams = filterParams(DAY_DETAIL_FILTERS);
type DayDetailParams = z.infer<typeof DayDetailParams>;

/**
 * `day.detail` — a day's stops, or every day's.
 *
 * Bound to a day this is `itinerary.day`; wide it is `itinerary.trip`. Same
 * primitive, arity decided by the selection — Mitchell's *"all would show you
 * all days, with headers breaking up days"*.
 *
 * Two rules that are decisions rather than conveniences:
 *
 * - **A day with no matching stops is dropped only when a content filter is
 *   set.** Unfiltered, every selected day appears, empty ones included: a day
 *   with nothing on it is a real day and the trip table says "Nothing planned
 *   yet" for it. With `kind: booked` set, days with no booking are dropped
 *   rather than rendered as a wall of empty cards — the reader asked for the
 *   bookings, not for a census of days.
 * - **One selected day renders as one card, not as a one-row table.** That is
 *   what "collapses to one member" means for a block, and it is what keeps
 *   `itinerary.day`'s output identical after the migration.
 *
 * A single day that ends up with no stops is `empty()`, which is the answer
 * `itinerary.day` already gives for a day with nothing on it.
 */
export const dayDetail: MacroDef<DayDetailParams, ItineraryDayPayload | ItineraryTripPayload> = {
  name: "day.detail", title: "The days in detail", shape: "block",
  params: DayDetailParams, inputs: filterInputs(DAY_DETAIL_FILTERS),
  selection: { entity: "day", filters: DAY_DETAIL_FILTERS },
  description:
    "The stops on a selection of days. Unfiltered it is every day at a glance; filter it to a day for that day's card, or to a kind or tag for only the stops that match.",
  emptyText: "No days to show",
  preview: "every stop on the days you selected",
  resolve: (
    { trip, globals }: WidgetContext,
    params,
  ): MacroResult<ItineraryDayPayload | ItineraryTripPayload> => {
    if (!trip) return needsTrip();
    const selection = narrow(trip, globals, params);
    if (selection.status !== "ok") return selection;
    const { days, stops, contentNarrowed } = selection.value;

    const byDay = new Map<number, SelectedStop[]>();
    for (const stop of stops) {
      if (stop.dayIndex === null) continue;
      const bucket = byDay.get(stop.dayIndex);
      if (bucket) bucket.push(stop);
      else byDay.set(stop.dayIndex, [stop]);
    }

    const kept = contentNarrowed ? days.filter((index) => byDay.has(index)) : days;
    if (kept.length === 0) return empty();
    const cards = kept.map((index) => dayCard(trip, index, byDay.get(index) ?? []));
    if (cards.length === 1) {
      const only = cards[0]!;
      return only.activities.length === 0 ? empty() : ok(only);
    }
    return ok({ kind: "itinerary-trip", days: cards });
  },
  render: blockOf,
};

const CITY_DETAIL_FILTERS = ["city", "dates"] as const satisfies readonly FilterDimension[];
const CityDetailParams = filterParams(CITY_DETAIL_FILTERS);
type CityDetailParams = z.infer<typeof CityDetailParams>;

/**
 * `city.detail` — a card per city the trip touches.
 *
 * The city-shaped cell of the cross product that no named widget filled:
 * `city.line` lists cities as lines in a sentence, and this is the same
 * selection as a block. Everything it prints comes from the globals projection,
 * because cities are derived by `citiesOfDay` in `@tc/domain` and this package
 * may not import it — so with no globals there is no city list at all, which is
 * `empty()` rather than an invented one.
 *
 * Day NUMBERS, not indexes: `dayIndexes` counts from 0 because that is how the
 * projection addresses days, and a card saying "Day 0" would be the projection's
 * private convention leaking onto the page.
 */
export const cityDetail: MacroDef<CityDetailParams, CityDetailPayload> = {
  name: "city.detail", title: "The cities in detail", shape: "block",
  params: CityDetailParams, inputs: filterInputs(CITY_DETAIL_FILTERS),
  selection: { entity: "city", filters: CITY_DETAIL_FILTERS },
  description:
    "A card per city the trip touches: which days are there, and how many stops. Unfiltered it is every city.",
  emptyText: "no cities on this trip yet",
  preview: "a card per city, with its days and stops",
  resolve: ({ trip, globals }: WidgetContext, params): MacroResult<CityDetailPayload> => {
    if (!trip) return needsTrip();
    const selection = narrow(trip, globals, params);
    if (selection.status !== "ok") return selection;
    const { cities, days, stops } = selection.value;
    if (cities.length === 0) return empty();
    // **Both fields come from the NARROWED selection, not from the projection's
    // full-trip totals.** `TripGlobalsCity` answers "across this whole trip",
    // so a date-filtered card was listing days its own filter had excluded and
    // counting stops outside the range beside them (CodeRabbit, PR 141). A card
    // whose two numbers describe different selections is worse than either
    // alone, because the reader has no way to tell which one they are reading.
    return ok({
      kind: "city-detail",
      cities: cities.map((entry) => ({
        name: entry.name,
        dayOrdinals: cityDayOrdinals(entry, days),
        activityCount: stopsInCity(stops, entry.name).length,
      })),
    });
  },
  render: blockOf,
};
