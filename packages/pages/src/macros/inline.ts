import { z } from "zod";
import { DayRef, type TripDetail } from "@tc/contracts";
import type { MacroDef, WidgetInput } from "../registry-types";
import { ok, empty, unbound, type MacroResult } from "../result";
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

export const tripName: MacroDef<NoParams, string> = {
  name: "trip.name", kind: "inline", params: NoParams, inputs: [],
  description: "The trip's name.", emptyText: "untitled trip",
  resolve: (d): MacroResult<string> => (d.name.trim() === "" ? empty() : ok(d.name)),
};

export const tripDates: MacroDef<NoParams, string> = {
  name: "trip.dates", kind: "inline", params: NoParams, inputs: [],
  description: "The trip's date range (start date and number of days).", emptyText: "no dates set",
  resolve: (d): MacroResult<string> => {
    if (d.startDate === null) return empty();
    const last = d.days.length > 0 ? d.days[d.days.length - 1]!.date : d.startDate;
    return ok(d.days.length <= 1 ? formatDate(d.startDate) : `${formatDate(d.startDate)} – ${formatDate(last)}`);
  },
};

export const costTrip: MacroDef<NoParams, string> = {
  name: "cost.trip", kind: "inline", params: NoParams, inputs: [],
  description: "Total cost of the whole trip.", emptyText: "no costs yet",
  resolve: (d): MacroResult<string> => (d.tripCostTotal === 0 ? empty() : ok(formatMoney(d.tripCostTotal, d.currency))),
};

export const costDay: MacroDef<DayParams, string> = {
  name: "cost.day", kind: "inline", params: DayParams, inputs: DAY_INPUT,
  description: "Total cost of one day of the trip.", emptyText: "no costs on this day",
  resolve: (d, _ctx, params): MacroResult<string> => {
    const idx = resolveDayIndex(d, params);
    if (idx === null) return unbound("day");
    const sub = d.days[idx]!.costSubtotal;
    return sub === 0 ? empty() : ok(formatMoney(sub, d.currency));
  },
};
