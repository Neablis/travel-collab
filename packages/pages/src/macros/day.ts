import { z } from "zod";
import type { MacroDef, WidgetContext } from "../registry-types";
import { inlineOf, text } from "../registry-types";
import { ok, empty, unbound, needsTrip, type MacroResult } from "../result";
import { formatMoney, formatDate } from "../format";
import { DayParams, DAY_INPUT, resolveDayIndex } from "./inline";

const NoParams = z.object({}).strip();
type NoParams = z.infer<typeof NoParams>;

// The catalogue's `w-daydate`. A day's date is on `TripDetail` already, so this
// costs one object — which is the claim ADR-037 makes about the module contract
// and the first chance to check it against a widget nobody designed the
// framework around.
//
// `startDate` is nullable on a trip, so a day's date is too: an itinerary can be
// planned as "day 1, day 2, day 3" before it is planned as dates. That is
// `empty()`, not a formatted "—" — `formatDate` returns an em dash for null, and
// printing one INTO a sentence a person wrote reads as a value rather than as an
// absence. `emptyText` says what is actually true.
export const dayDate: MacroDef<DayParams, string> = {
  name: "day.date", title: "A day's date", shape: "single", params: DayParams, inputs: DAY_INPUT,
  description: "The date of one day of the trip.", emptyText: "this day has no date yet",
  preview: "Sep 25, 2027",
  resolve: ({ trip }: WidgetContext, params): MacroResult<string> => {
    if (!trip) return needsTrip();
    const idx = resolveDayIndex(trip, params);
    if (idx === null) return unbound("day");
    const date = trip.days[idx]!.date;
    return date === null ? empty() : ok(formatDate(date));
  },
  render: (value) => inlineOf(text(value)),
};

// The catalogue's `w-daycity`, and the first widget to read `globals` for
// anything (item D built the projection; until now only the manifest consumed
// it). A day's cities are NOT on `TripDetail`: they are derived per-activity by
// `citiesOfDay` in `@tc/domain`, which this package may not import — so the
// route is the one item D exists to provide.
//
// A day can touch more than one city; a travel day is the ordinary case rather
// than the exotic one, and `citiesOfDay` returns them in arrival order. Joining
// with an en dash reads as a journey ("Tokyo – Kyoto") where a comma would read
// as a list.
//
// `globals: null` renders the same as "no located stops". Both are inert and
// neither guesses, which is the trade `account.name` already makes for
// `user: null` — and the alternative, distinguishing them, would mean inventing
// a "could not load" state for a widget whose honest answer is that it has
// nothing to show.
export const dayCity: MacroDef<DayParams, string> = {
  name: "day.city", title: "A day's city", shape: "single", params: DayParams, inputs: DAY_INPUT,
  description: "The city or cities one day of the trip touches, in arrival order.",
  emptyText: "no city on this day",
  preview: "Tokyo – Kyoto",
  resolve: ({ trip, globals }: WidgetContext, params): MacroResult<string> => {
    if (!trip) return needsTrip();
    const idx = resolveDayIndex(trip, params);
    if (idx === null) return unbound("day");
    const cities = globals?.days[idx]?.cities ?? [];
    return cities.length === 0 ? empty() : ok(cities.join(" – "));
  },
  render: (value) => inlineOf(text(value)),
};

// The catalogue's `w-dayends`. The earliest start and the latest end among the
// day's stops that have a time — which is not the same as "the first and last
// stop in the column": stored order is the board's order, and a day can hold a
// 09:00 stop after a 14:00 one until someone tidies it. Reading the times and
// taking the extremes answers the question the widget's title asks; reading
// `activityIds[0]` would answer a different one and be wrong exactly when the
// board is untidy.
//
// Untimed stops are skipped rather than counted as 00:00. A day of nothing but
// untimed stops has no window at all, and says so.
export const dayWindow: MacroDef<DayParams, string> = {
  name: "day.window", title: "A day's first and last stop", shape: "single", params: DayParams, inputs: DAY_INPUT,
  description: "When one day of the trip starts and ends, from its stops' times.",
  emptyText: "no times set on this day",
  preview: "09:00 – 21:30",
  resolve: ({ trip }: WidgetContext, params): MacroResult<string> => {
    if (!trip) return needsTrip();
    const idx = resolveDayIndex(trip, params);
    if (idx === null) return unbound("day");
    // HH:mm is zero-padded and 24-hour, so string comparison IS time
    // comparison — the same property `TimeWindow`'s own `start < end`
    // refinement relies on. No Date construction, no timezone.
    let first: string | null = null;
    let last: string | null = null;
    for (const activityId of trip.days[idx]!.activityIds) {
      const window = trip.activities[activityId]?.timeWindow;
      if (!window) continue;
      if (first === null || window.start < first) first = window.start;
      if (last === null || window.end > last) last = window.end;
    }
    return first === null || last === null ? empty() : ok(`${first} – ${last}`);
  },
  render: (value) => inlineOf(text(value)),
};

// The catalogue's `w-left`. `budgetRemaining` is already computed on
// `TripDetail` (budget − total), so this widget deliberately does no arithmetic:
// a second implementation of "what is left" is a second answer that can differ
// from the one the board shows.
//
// **It may be negative, and it renders that.** Over budget is the state a person
// most wants a notebook to say out loud, so clamping at zero would suppress the
// only reading that changes a decision. `formatMoney` handles the sign.
//
// `null` means no budget is set — a different fact from "nothing left", and the
// one case where `empty()` is not a shortfall.
export const budgetRemaining: MacroDef<NoParams, string> = {
  name: "budget.remaining", title: "What's left of the budget", shape: "single", params: NoParams, inputs: [],
  description: "The trip's budget minus what it costs so far. Negative when over budget.",
  emptyText: "no budget set",
  preview: "what's left to spend",
  resolve: ({ trip }: WidgetContext): MacroResult<string> => {
    if (!trip) return needsTrip();
    return trip.budgetRemaining === null ? empty() : ok(formatMoney(trip.budgetRemaining, trip.currency));
  },
  render: (value) => inlineOf(text(value)),
};
