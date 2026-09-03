import { z } from "zod";
import type { TripDetail } from "@tc/contracts";
import type { MacroDef, ItineraryDayPayload, ItineraryTripPayload, CostsTablePayload } from "../registry-types";
import { ok, empty, unbound, type MacroResult } from "../result";
import { formatMoney } from "../format";
import { DAY_INPUT, DayParams, resolveDayIndex } from "./inline";

const NoParams = z.object({}).strip();
type NoParams = z.infer<typeof NoParams>;

function dayPayload(detail: TripDetail, idx: number): ItineraryDayPayload {
  const day = detail.days[idx]!;
  return {
    dayId: day.dayId, date: day.date,
    activities: day.activityIds.map((id) => {
      const a = detail.activities[id]!;
      return {
        title: a.title,
        timeWindow: a.timeWindow ? `${a.timeWindow.start}–${a.timeWindow.end}` : null,
        cost: a.cost ? formatMoney(a.cost.amountMinor, detail.currency) : null,
      };
    }),
  };
}

export const itineraryDay: MacroDef<DayParams, ItineraryDayPayload> = {
  name: "itinerary.day", kind: "block", params: DayParams, inputs: DAY_INPUT,
  description: "The activity list for one day of the trip.", emptyText: "No activities on this day yet",
  resolve: (d, _ctx, params): MacroResult<ItineraryDayPayload> => {
    const idx = resolveDayIndex(d, params);
    if (idx === null) return unbound("day");
    if (d.days[idx]!.activityIds.length === 0) return empty();
    return ok(dayPayload(d, idx));
  },
};

export const itineraryTrip: MacroDef<NoParams, ItineraryTripPayload> = {
  name: "itinerary.trip", kind: "block", params: NoParams, inputs: [],
  description: "The full itinerary — every day and its activities.", emptyText: "No days planned yet",
  resolve: (d): MacroResult<ItineraryTripPayload> => {
    if (d.days.length === 0) return empty();
    return ok({ days: d.days.map((_, i) => dayPayload(d, i)) });
  },
};

export const costsTable: MacroDef<NoParams, CostsTablePayload> = {
  name: "costs.table", kind: "block", params: NoParams, inputs: [],
  description: "A cost breakdown by day plus unscheduled, with a trip total.", emptyText: "no costs yet",
  resolve: (d): MacroResult<CostsTablePayload> => {
    if (d.tripCostTotal === 0) return empty();
    const rows = d.days
      .map((day, i) => ({ label: day.date ? `Day ${i + 1} · ${day.date}` : `Day ${i + 1}`, minor: day.costSubtotal }))
      .filter((r) => r.minor > 0)
      .map((r) => ({ label: r.label, amount: formatMoney(r.minor, d.currency) }));
    if (d.unscheduledCostSubtotal > 0) rows.push({ label: "Unscheduled", amount: formatMoney(d.unscheduledCostSubtotal, d.currency) });
    return ok({ rows, total: formatMoney(d.tripCostTotal, d.currency) });
  },
};
