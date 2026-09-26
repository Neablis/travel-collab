import { z } from "zod";
import type { ActivityView, FilterDimension, TimeFormat, TripDetail } from "@tc/contracts";
import type { ItineraryPayload, ItineraryScheduleDay, ItineraryStop } from "../../itineraryPayload";
import { needsBooking } from "../../needsBooking";
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
import { formatDate, formatLongDate, formatMoney } from "../../format";
import { readerClock, toClockLabel, toClockRange } from "../../clockLabel";

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
/**
 * The clock range a set of stops spans — earliest start, latest end.
 *
 * The rule is `hours`', inherited whole rather than reimplemented differently:
 * the extremes of the TIMES, not the first and last stop in the column, because
 * stored order is the board's order and a day can hold a 09:00 stop after a
 * 14:00 one until somebody tidies it. Untimed stops are skipped rather than
 * counted as midnight, and a day of nothing but untimed stops has no window at
 * all and says so with `null`.
 *
 * `HH:mm` is zero-padded and 24-hour, so string comparison IS time comparison;
 * only the answer is printed, in the reader's format.
 */
function windowOf(stops: readonly SelectedStop[], format: TimeFormat): string | null {
  const windows = stops.map(({ activity }) => activity.timeWindow).filter((w) => w != null);
  if (windows.length === 0) return null;
  const start = windows.reduce((a, w) => (w.start < a ? w.start : a), windows[0]!.start);
  const end = windows.reduce((a, w) => (w.end > a ? w.end : a), windows[0]!.end);
  return toClockRange(start, end, format);
}

function dayCard(
  trip: TripDetail,
  globals: WidgetContext["globals"],
  index: number,
  stops: readonly SelectedStop[],
  format: TimeFormat,
): ItineraryDayPayload {
  const day = trip.days[index]!;
  // Summed from the stops on the card rather than read off `day.costSubtotal`
  // — see `ItineraryDayPayload`. A filtered card and a whole-day total are two
  // different selections, and printing one as the other is the kind of
  // disagreement between two surfaces this repo keeps finding.
  const costMinor = stops.reduce((total, { activity }) => total + (activity.cost?.amountMinor ?? 0), 0);
  return {
    kind: "itinerary-day",
    dayId: day.dayId,
    cities: globals?.days[index]?.cities ?? [],
    window: windowOf(stops, format),
    cost: costMinor === 0 ? null : formatMoney(costMinor, trip.currency),
    // Which day of the TRIP this is, counting from 1 — not its position in the
    // selection. `day.detail{kind: booked}` can leave days 2 and 5, and
    // labelling them "Day 1" and "Day 2" would be the selection's private
    // numbering printed onto the page as a fact about the trip.
    ordinal: index + 1,
    // `formatDate`, not the raw ISO. Mitchell, 2026-09-06, pointing at this
    // exact line on the preview: *"Still have the non human readable timestamp
    // here."* — "still", because `cost.rows` had the same defect that morning
    // and this call site was missed. Everything else in this payload is already
    // display-ready (`timeWindow` is a joined range, `cost` is formatted money);
    // the date was the one field handed over as storage saw it.
    date: day.date === null ? null : formatDate(day.date),
    activities: stops.map(({ activity }) => ({
      title: activity.title,
      timeWindow: activity.timeWindow ? toClockRange(activity.timeWindow.start, activity.timeWindow.end, format) : null,
      cost: activity.cost ? formatMoney(activity.cost.amountMinor, trip.currency) : null,
    })),
  };
}

const DAY_DETAIL_FILTERS = ["day", "city", "tag", "kind", "dates"] as const satisfies readonly FilterDimension[];
const DayDetailParams = filterParams(DAY_DETAIL_FILTERS, {
  // **"schedule" is the printed itinerary** (M30): every stop in time order,
  // where it is and whether it still needs booking, under a dated header per
  // day. Absent is the glance the widget has always drawn, so every stored
  // `day.detail` reads as it did.
  view: z.enum(["glance", "schedule"]).optional(),
});
type DayDetailParams = z.infer<typeof DayDetailParams>;

/**
 * One stop as a line of the printed schedule.
 *
 * `place` is the location's name with its city after it when the name does not
 * already say it ("Fushimi Inari Taisha, Kyoto"), and the city alone for a stop
 * placed only as far as a city. That is how an itinerary writes an address:
 * enough to find it, not the street.
 */
function scheduleStop(activity: ActivityView, format: TimeFormat): ItineraryStop {
  const window = activity.timeWindow;
  const name = activity.location?.name?.trim() || null;
  const city = activity.location?.city?.trim() || null;
  const place = name && city && !name.includes(city) ? `${name}, ${city}` : (name ?? city);
  return {
    time: window ? toClockLabel(window.start, format) : null,
    until: window ? toClockLabel(window.end, format) : null,
    title: activity.title,
    place,
    status: needsBooking(activity) ? "To book" : activity.kind === "transit" ? "Travel" : null,
  };
}

/**
 * The day's stops in the order a person lives them: timed ones by start, then
 * the untimed ones in the order the board keeps them.
 *
 * `stopsInTimeOrder` in `@tc/domain` is the same rule, and this package may not
 * import it (it depends on contracts only). Five lines of sort are cheaper than
 * a new package edge; `block.test.ts` pins the order so the two cannot quietly
 * disagree about what "in time order" means.
 */
function inTimeOrder(stops: readonly SelectedStop[]): SelectedStop[] {
  const timed = stops.filter(({ activity }) => activity.timeWindow);
  const untimed = stops.filter(({ activity }) => !activity.timeWindow);
  timed.sort((a, b) => (a.activity.timeWindow!.start < b.activity.timeWindow!.start ? -1 : a.activity.timeWindow!.start > b.activity.timeWindow!.start ? 1 : 0));
  return [...timed, ...untimed];
}

function scheduleDay(
  trip: TripDetail,
  globals: WidgetContext["globals"],
  index: number,
  stops: readonly SelectedStop[],
  format: TimeFormat,
): ItineraryScheduleDay {
  const day = trip.days[index]!;
  return {
    dayId: day.dayId,
    ordinal: index + 1,
    date: formatLongDate(day.date),
    cities: globals?.days[index]?.cities ?? [],
    stops: inTimeOrder(stops).map(({ activity }) => scheduleStop(activity, format)),
  };
}

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
export const dayDetail: MacroDef<DayDetailParams, ItineraryDayPayload | ItineraryTripPayload | ItineraryPayload> = {
  name: "day.detail", title: "The days in detail", shape: "block",
  params: DayDetailParams,
  inputs: [
    ...filterInputs(DAY_DETAIL_FILTERS),
    {
      name: "view", type: "choice", label: "Layout", default: "glance",
      options: [
        { value: "glance", label: "At a glance" },
        { value: "schedule", label: "Printed itinerary" },
      ],
    },
  ],
  selection: { entity: "day", filters: DAY_DETAIL_FILTERS },
  description:
    "The stops on a selection of days. Unfiltered it is every day at a glance; filter it to a day for that day's card, or to a kind or tag for only the stops that match. Its \"schedule\" layout prints every stop in time order with its place and whether it is still to book, like a printed itinerary.",
  // "no days yet", not "No days to show". This is the first thing a brand-new
  // trip's Overview says under "The trip, day by day", and "to show" is a shrug
  // about the widget where "yet" is a fact about the trip — one of them tells
  // the reader that adding a day is the next thing to do. Lower case to match
  // every other empty state in the registry; this was the one that shouted.
  emptyText: "no days yet",
  preview: "every stop on the days you selected",
  resolve: (
    { trip, globals, user }: WidgetContext,
    params,
    item,
  ): MacroResult<ItineraryDayPayload | ItineraryTripPayload | ItineraryPayload> => {
    if (!trip) return needsTrip();
    const selection = narrow(trip, globals, params, item);
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
    // The printed itinerary is one shape at every arity: a one-day schedule is
    // still a schedule, headed by its day, and an empty day in it says
    // "Nothing planned yet" as the glance's table does rather than vanishing.
    if (params.view === "schedule") {
      const format = readerClock(user);
      return ok({
        kind: "itinerary-schedule",
        days: kept.map((index) => scheduleDay(trip, globals, index, byDay.get(index) ?? [], format)),
      });
    }
    const cards = kept.map((index) => dayCard(trip, globals, index, byDay.get(index) ?? [], readerClock(user)));
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
  resolve: ({ trip, globals }: WidgetContext, params, item): MacroResult<CityDetailPayload> => {
    if (!trip) return needsTrip();
    const selection = narrow(trip, globals, params, item);
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
