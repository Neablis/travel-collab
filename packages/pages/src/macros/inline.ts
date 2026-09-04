import { z } from "zod";
import { DayRef, type TripDetail } from "@tc/contracts";
import type { MacroDef, WidgetContext, WidgetInput } from "../registry-types";
import { inlineOf, text } from "../registry-types";
import { ok, empty, unbound, needsTrip, type MacroResult } from "../result";
import { formatMoney, formatDate } from "../format";

const NoParams = z.object({}).strip();
type NoParams = z.infer<typeof NoParams>;

// A widget that reads ONE day takes that day as its own input (ADR-035
// decision 3): the day lives in this macro node's params, not on the page.
// Optional, because a widget can exist before it is pointed anywhere — that is
// the `unbound` state, and it renders as a chip rather than an error.
export const DayParams = z.object({ dayRef: DayRef.optional() }).strip();
export type DayParams = z.infer<typeof DayParams>;

// The declared input for the two widgets that read one day (ADR-035 decision 2).
// Shared rather than written twice so the input's `name` and `DayParams`' key
// cannot drift apart across two files — they MUST match, and a registry-wide
// test in registry.test.ts enforces that for every widget, not just these.
export const DAY_INPUT: readonly WidgetInput[] = [{ name: "dayRef", type: "day", label: "Day" }];

// Resolve this widget's bound day to an index into TripDetail.days, or null if
// it is bound to nothing or to a day that no longer exists. A stale binding is
// silently no binding, never a guessed one — writing about day 1 because day 100
// was deleted is a confident wrong answer.
export function resolveDayIndex(detail: TripDetail, params: DayParams): number | null {
  const ref = params.dayRef;
  if (!ref) return null;
  if (ref.kind === "index") return ref.index < detail.days.length ? ref.index : null;
  const idx = detail.days.findIndex((d) => d.dayId === ref.dayId);
  return idx === -1 ? null : idx;
}

// The four inline widgets each render a single text segment — the faithful
// translation of `InlinePayload = string`, and deliberately not more. A widget
// that wants chips inside prose (the design's `w-person`) now CAN emit them;
// none of these four has anything to chip.
export const tripName: MacroDef<NoParams, string> = {
  name: "trip.name", title: "The trip's name", shape: "single", params: NoParams, inputs: [],
  description: "The trip's name.", emptyText: "untitled trip",
  preview: "Japan, spring",
  resolve: ({ trip }): MacroResult<string> =>
    !trip ? needsTrip() : trip.name.trim() === "" ? empty() : ok(trip.name),
  render: (value) => inlineOf(text(value)),
};

export const tripDates: MacroDef<NoParams, string> = {
  name: "trip.dates", title: "The trip's dates", shape: "single", params: NoParams, inputs: [],
  description: "The trip's date range (start date and number of days).", emptyText: "no dates set",
  preview: "Fri 25 Sep – Sun 4 Oct",
  resolve: ({ trip }): MacroResult<string> => {
    if (!trip) return needsTrip();
    if (trip.startDate === null) return empty();
    const last = trip.days.length > 0 ? trip.days[trip.days.length - 1]!.date : trip.startDate;
    return ok(trip.days.length <= 1 ? formatDate(trip.startDate) : `${formatDate(trip.startDate)} – ${formatDate(last)}`);
  },
  render: (value) => inlineOf(text(value)),
};

export const costTrip: MacroDef<NoParams, string> = {
  name: "cost.trip", title: "What the trip costs", shape: "single", params: NoParams, inputs: [],
  description: "Total cost of the whole trip.", emptyText: "no costs yet",
  preview: "the trip's running total",
  resolve: ({ trip }): MacroResult<string> =>
    !trip ? needsTrip() : trip.tripCostTotal === 0 ? empty() : ok(formatMoney(trip.tripCostTotal, trip.currency)),
  render: (value) => inlineOf(text(value)),
};

export const costDay: MacroDef<DayParams, string> = {
  name: "cost.day", title: "What a day costs", shape: "single", params: DayParams, inputs: DAY_INPUT,
  description: "Total cost of one day of the trip.", emptyText: "no costs on this day",
  preview: "what that day comes to",
  resolve: ({ trip }: WidgetContext, params): MacroResult<string> => {
    if (!trip) return needsTrip();
    const idx = resolveDayIndex(trip, params);
    if (idx === null) return unbound("day");
    const sub = trip.days[idx]!.costSubtotal;
    return sub === 0 ? empty() : ok(formatMoney(sub, trip.currency));
  },
  render: (value) => inlineOf(text(value)),
};
