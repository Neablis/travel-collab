import { z } from "zod";
import type { FilterDimension } from "@tc/contracts";
import type { MacroDef, WidgetContext } from "../../registry-types";
import { chip, inlineOf, text } from "../../registry-types";
import { ok, empty, needsTrip, type MacroResult } from "../../result";
import { filterInputs, filterParams } from "../../filters";
import { costOfStops, narrow } from "../../select";
import { formatMoney, formatDate } from "../../format";

// The `single` primitives (ADR-039 decision 1): a shape that **collapses** its
// selection to one value — a sum, a span, a count, a joined list.
//
// Each is `entity + filters + shape` and nothing else. What used to be two
// widgets is one here with a filter set or not: `cost.trip` and `cost.day`
// differ only by whether the day filter is bound, which is ADR-039's opening
// table read out loud.
//
// **Every value is formatted in `resolve` and rendered as a chip**, matching the
// widgets already in the registry: `cost.day` resolves to `"$45.00"` and
// `day.window` to `"09:00 – 21:30"`. The one that does not is `city` below, and
// it is the same exception `day.city` already makes — a LIST whose members each
// carry the trip's own colour cannot be one string, because one string can only
// wear one colour.

const COST_FILTERS = ["day", "city", "tag", "kind", "person", "dates"] as const satisfies readonly FilterDimension[];
const CostParams = filterParams(COST_FILTERS);
type CostParams = z.infer<typeof CostParams>;

/**
 * `cost` — what a selection of stops adds up to.
 *
 * Wide it is the trip's total, the backlog included, which is `cost.trip`
 * exactly; bound to a day it is that day's subtotal, which is `cost.day`
 * exactly. Not a coincidence and not a reimplementation: `costOfStops` sums the
 * same stops `rollupCosts` sums in `@tc/domain`, so there is one number and one
 * implementation of it (ADR-039's *"no second answer that can drift from the
 * board's"*), proved in `select.test.ts` against totals the domain computed.
 */
export const cost: MacroDef<CostParams, string> = {
  name: "cost", title: "What it costs", shape: "single",
  params: CostParams, inputs: filterInputs(COST_FILTERS),
  selection: { entity: "stop", filters: COST_FILTERS },
  description:
    "What a selection of stops costs. Unfiltered it is the whole trip's total, including unscheduled stops; filter it to a day, a city, a tag or a kind for the sum of what matches.",
  emptyText: "no costs yet",
  preview: "the running total of what you selected",
  resolve: ({ trip, globals }: WidgetContext, params): MacroResult<string> => {
    if (!trip) return needsTrip();
    const selection = narrow(trip, globals, params);
    if (selection.status !== "ok") return selection;
    const total = costOfStops(selection.value.stops);
    // Zero is `empty()` rather than "$0.00", which is what `cost.trip` and
    // `cost.day` both already answer: a trip nobody has priced yet has no
    // total, and printing a currency-formatted zero into a sentence reads as a
    // priced answer.
    return total === 0 ? empty() : ok(formatMoney(total, trip.currency));
  },
  render: (value) => inlineOf(chip("value", value)),
};

// The spec's entity column for `count` reads "stop / day / city", and this is
// the param that carries it. It is NOT a filter dimension: `of` chooses what is
// being counted rather than narrowing a set, so it gets no row in the legality
// matrix and no control from `filterInputs` — the same treatment `attribute`'s
// `field` gets in spec §8 step 2.
//
// `count` therefore declares the STOP row of the matrix, which is a superset of
// the day and city rows (`filters.test.ts` asserts the containment). That is
// what lets one primitive count three things under one declaration instead of
// being three primitives.
//
// `.optional()` with an absent value meaning "stop", rather than
// `.default("stop")`: a Zod default makes the schema's INPUT type differ from
// its output, and `MacroDef.params` is `z.ZodType<P>` — one type for both sides
// of the parse. Reading the absence in the resolver keeps `{}` the one spelling
// of an unset param, which is the same rule `withBinding` follows when it
// deletes a key rather than writing a null.
const CountOf = z.enum(["stop", "day", "city"]);
type CountOf = z.infer<typeof CountOf>;
const COUNTS_STOPS: CountOf = "stop";
const COUNT_FILTERS = ["day", "city", "tag", "kind", "person", "dates"] as const satisfies readonly FilterDimension[];
const CountParams = filterParams(COUNT_FILTERS, { of: CountOf.optional() });
type CountParams = z.infer<typeof CountParams>;

// English, for three nouns. A count reads as a phrase in a sentence — "we have
// 3 stops booked" — and a bare "3" would leave the sentence to say what of,
// which is the author's job made harder by the widget.
const PLURAL: Record<CountOf, [one: string, many: string]> = {
  stop: ["stop", "stops"],
  day: ["day", "days"],
  city: ["city", "cities"],
};

/**
 * `count` — how many members the selection holds.
 *
 * **Zero is an answer, not an absence**, which is why this is the one primitive
 * that never resolves to `empty()` against a loaded trip. "0 booked" is exactly
 * what somebody asks a notebook, and `emptyText` would replace the fact with a
 * shrug. Contrast `cost`, where a zero total means nothing has been priced.
 */
export const count: MacroDef<CountParams, string> = {
  name: "count", title: "How many", shape: "single",
  params: CountParams, inputs: filterInputs(COUNT_FILTERS),
  selection: { entity: "stop", filters: COUNT_FILTERS },
  description:
    "How many stops, days or cities a selection holds. Unfiltered it counts everything; filter it for how many match.",
  emptyText: "nothing to count",
  preview: "how many there are",
  resolve: ({ trip, globals }: WidgetContext, params): MacroResult<string> => {
    if (!trip) return needsTrip();
    const selection = narrow(trip, globals, params);
    if (selection.status !== "ok") return selection;
    const { days, stops, cities } = selection.value;
    const of = params.of ?? COUNTS_STOPS;
    const n = of === "day" ? days.length : of === "city" ? cities.length : stops.length;
    const [one, many] = PLURAL[of];
    return ok(`${n} ${n === 1 ? one : many}`);
  },
  render: (value) => inlineOf(chip("value", value)),
};

const DATES_FILTERS = ["day", "city", "dates"] as const satisfies readonly FilterDimension[];
const DatesParams = filterParams(DATES_FILTERS);
type DatesParams = z.infer<typeof DatesParams>;

/**
 * `dates` — the span the selected days cover.
 *
 * Wide it is the trip's range, first dated day to last dated day, which is
 * `trip.dates`; bound to one day it is that day's date, which is `day.date`.
 * The third row of ADR-039's table of widgets written twice.
 *
 * The extremes are taken from the days that HAVE dates rather than from the
 * ends of the list. A trip can be dated at the front and open-ended at the back,
 * and reading the last day's date blindly printed "Aug 1, 2026 – —" — an em dash
 * presented as the end of a range, which reads as a date rather than as its
 * absence (CodeRabbit, PR 139). A selection with no dated day at all is
 * `empty()`.
 */
export const dates: MacroDef<DatesParams, string> = {
  name: "dates", title: "The dates", shape: "single",
  params: DatesParams, inputs: filterInputs(DATES_FILTERS),
  selection: { entity: "day", filters: DATES_FILTERS },
  description:
    "The dates a selection of days covers. Unfiltered it is the trip's whole range; filter it to a day for that day's date.",
  emptyText: "no dates set",
  preview: "Fri 25 Sep – Sun 4 Oct",
  resolve: ({ trip, globals }: WidgetContext, params): MacroResult<string> => {
    if (!trip) return needsTrip();
    const selection = narrow(trip, globals, params);
    if (selection.status !== "ok") return selection;
    const dated = selection.value.days
      .map((index) => trip.days[index]!.date)
      .filter((date): date is string => date !== null);
    if (dated.length === 0) return empty();
    // ISO dates sort as strings; no `Date`, no timezone, no clock (Invariant 4).
    const first = dated.reduce((a, b) => (b < a ? b : a));
    const last = dated.reduce((a, b) => (b > a ? b : a));
    return ok(first === last ? formatDate(first) : `${formatDate(first)} – ${formatDate(last)}`);
  },
  render: (value) => inlineOf(chip("value", value)),
};

const HOURS_FILTERS = ["day", "city", "tag", "kind", "dates"] as const satisfies readonly FilterDimension[];
const HoursParams = filterParams(HOURS_FILTERS);
type HoursParams = z.infer<typeof HoursParams>;

/**
 * `hours` — the earliest start and the latest end among the selected stops.
 *
 * Bound to a day this is `day.window`. Its rule is inherited whole: the extremes
 * of the TIMES, not the first and last stop in the column — stored order is the
 * board's order and a day can hold a 09:00 stop after a 14:00 one until somebody
 * tidies it. Untimed stops are skipped rather than counted as 00:00, and a
 * selection of nothing but untimed stops has no window at all and says so.
 *
 * `HH:mm` is zero-padded and 24-hour, so string comparison IS time comparison —
 * the property `TimeWindow`'s own `start < end` refinement already relies on.
 *
 * No `person` dimension: this is stop-level, and `LEGAL_FILTERS.stop` permits it,
 * but a window over "whose stops" is a question no field can answer yet and
 * declaring it would put a dimension in the picker that only ever refuses.
 */
export const hours: MacroDef<HoursParams, string> = {
  name: "hours", title: "First and last", shape: "single",
  params: HoursParams, inputs: filterInputs(HOURS_FILTERS),
  selection: { entity: "stop", filters: HOURS_FILTERS },
  description:
    "When a selection of stops starts and ends, from their times. Unfiltered it spans the whole trip; filter it to a day for that day's window.",
  emptyText: "no times set",
  preview: "09:00 – 21:30",
  resolve: ({ trip, globals }: WidgetContext, params): MacroResult<string> => {
    if (!trip) return needsTrip();
    const selection = narrow(trip, globals, params);
    if (selection.status !== "ok") return selection;
    let first: string | null = null;
    let last: string | null = null;
    for (const { activity } of selection.value.stops) {
      const window = activity.timeWindow;
      if (!window) continue;
      if (first === null || window.start < first) first = window.start;
      if (last === null || window.end > last) last = window.end;
    }
    return first === null || last === null ? empty() : ok(`${first} – ${last}`);
  },
  render: (value) => inlineOf(chip("value", value)),
};

const CITY_FILTERS = ["day", "dates"] as const satisfies readonly FilterDimension[];
const CityParams = filterParams(CITY_FILTERS);
type CityParams = z.infer<typeof CityParams>;

/**
 * `city` — the cities a selection of days touches, in arrival order.
 *
 * Bound to a day this is `day.city`; wide it is every city on the trip. It
 * declares no `city` dimension of its own — filtering the cities to one city and
 * then printing it is the author typing the city name, which is not a widget
 * (ADR-039 decision 5's curation, applied to the primitive itself).
 *
 * **It resolves to the cities and joins them in `render`**, and that is the one
 * place the `single` primitives break their format-in-resolve habit. Each city
 * carries the trip's own colour for it, and a single `"Tokyo – Kyoto"` value can
 * only wear one — so joining early quietly decides that a travel day has a
 * single city. `apps/web` decides what the colour is; this says only that the
 * word is a city (ADR-037 decision 1).
 *
 * `globals: null` renders the same as "no located stops": both are inert and
 * neither guesses.
 */
export const city: MacroDef<CityParams, readonly string[]> = {
  name: "city", title: "The cities", shape: "single",
  params: CityParams, inputs: filterInputs(CITY_FILTERS),
  selection: { entity: "city", filters: CITY_FILTERS },
  description:
    "The city or cities a selection of days touches, in arrival order. Unfiltered it is every city on the trip.",
  emptyText: "no cities yet",
  preview: "Tokyo – Kyoto",
  resolve: ({ trip, globals }: WidgetContext, params): MacroResult<readonly string[]> => {
    if (!trip) return needsTrip();
    const selection = narrow(trip, globals, params);
    if (selection.status !== "ok") return selection;
    const names = selection.value.cities.map((entry) => entry.name);
    return names.length === 0 ? empty() : ok(names);
  },
  render: (names) =>
    inlineOf(...names.flatMap((name, i) => (i === 0 ? [chip("city", name)] : [text(" – "), chip("city", name)]))),
};
