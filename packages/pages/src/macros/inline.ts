import { z } from "zod";
import type { TripDetail, PageContext } from "@tc/contracts";
import type { MacroDef } from "../registry-types";
import { ok, empty, unbound, type MacroResult } from "../result";
import { formatMoney, formatDate } from "../format";

const NoParams = z.object({}).strip();
type NoParams = z.infer<typeof NoParams>;

// Resolve the bound day's index into TripDetail.days, or null if no/invalid binding.
export function resolveDayIndex(detail: TripDetail, ctx: PageContext): number | null {
  const ref = ctx.dayRef;
  if (!ref) return null;
  if (ref.kind === "index") return ref.index < detail.days.length ? ref.index : null;
  const idx = detail.days.findIndex((d) => d.dayId === ref.dayId);
  return idx === -1 ? null : idx;
}

export const tripName: MacroDef<NoParams, string> = {
  name: "trip.name", kind: "inline", params: NoParams,
  description: "The trip's name.", emptyText: "untitled trip",
  resolve: (d): MacroResult<string> => (d.name.trim() === "" ? empty() : ok(d.name)),
};

export const tripDates: MacroDef<NoParams, string> = {
  name: "trip.dates", kind: "inline", params: NoParams,
  description: "The trip's date range (start date and number of days).", emptyText: "no dates set",
  resolve: (d): MacroResult<string> => {
    if (d.startDate === null) return empty();
    const last = d.days.length > 0 ? d.days[d.days.length - 1]!.date : d.startDate;
    return ok(d.days.length <= 1 ? formatDate(d.startDate) : `${formatDate(d.startDate)} – ${formatDate(last)}`);
  },
};

export const costTrip: MacroDef<NoParams, string> = {
  name: "cost.trip", kind: "inline", params: NoParams,
  description: "Total cost of the whole trip.", emptyText: "no costs yet",
  resolve: (d): MacroResult<string> => (d.tripCostTotal === 0 ? empty() : ok(formatMoney(d.tripCostTotal, d.currency))),
};

export const costDay: MacroDef<NoParams, string> = {
  name: "cost.day", kind: "inline", params: NoParams,
  description: "Total cost of the day this page is pointed at.", emptyText: "no costs on this day",
  resolve: (d, ctx): MacroResult<string> => {
    const idx = resolveDayIndex(d, ctx);
    if (idx === null) return unbound("day");
    const sub = d.days[idx]!.costSubtotal;
    return sub === 0 ? empty() : ok(formatMoney(sub, d.currency));
  },
};
