import { z } from "zod";
import type { TripDetail } from "@tc/contracts";
import type { MacroDef, WidgetContext, ItineraryDayPayload, ItineraryTripPayload, CostsTablePayload } from "../registry-types";
import { blockOf } from "../registry-types";
import { ok, empty, unbound, needsTrip, type MacroResult } from "../result";
import { formatMoney } from "../format";
import { DAY_INPUT, DayParams, resolveDayIndex } from "./inline";

const NoParams = z.object({}).strip();
type NoParams = z.infer<typeof NoParams>;

function dayPayload(detail: TripDetail, idx: number): ItineraryDayPayload {
  const day = detail.days[idx]!;
  return {
    kind: "itinerary-day", dayId: day.dayId, date: day.date,
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
  name: "itinerary.day", title: "A day's stops", shape: "block", params: DayParams, inputs: DAY_INPUT,
  description: "The activity list for one day of the trip.", emptyText: "No activities on this day yet",
  preview: "every stop on the day you point it at",
  resolve: ({ trip }: WidgetContext, params): MacroResult<ItineraryDayPayload> => {
    if (!trip) return needsTrip();
    const idx = resolveDayIndex(trip, params);
    if (idx === null) return unbound("day");
    if (trip.days[idx]!.activityIds.length === 0) return empty();
    return ok(dayPayload(trip, idx));
  },
  render: blockOf,
};

export const itineraryTrip: MacroDef<NoParams, ItineraryTripPayload> = {
  name: "itinerary.trip", title: "Every day at a glance", shape: "block", params: NoParams, inputs: [],
  description: "The full itinerary — every day and its activities.", emptyText: "No days planned yet",
  preview: "the whole trip, day by day",
  resolve: ({ trip }): MacroResult<ItineraryTripPayload> => {
    if (!trip) return needsTrip();
    if (trip.days.length === 0) return empty();
    return ok({ kind: "itinerary-trip", days: trip.days.map((_, i) => dayPayload(trip, i)) });
  },
  render: blockOf,
};

export const costsTable: MacroDef<NoParams, CostsTablePayload> = {
  name: "costs.table", title: "Costs, broken down", shape: "block", params: NoParams, inputs: [],
  description: "A cost breakdown by day plus unscheduled, with a trip total.", emptyText: "no costs yet",
  preview: "each day's spend, and the total",
  resolve: ({ trip }): MacroResult<CostsTablePayload> => {
    if (!trip) return needsTrip();
    if (trip.tripCostTotal === 0) return empty();
    const rows = trip.days
      .map((day, i) => ({ label: day.date ? `Day ${i + 1} · ${day.date}` : `Day ${i + 1}`, minor: day.costSubtotal }))
      .filter((r) => r.minor > 0)
      .map((r) => ({ label: r.label, amount: formatMoney(r.minor, trip.currency) }));
    if (trip.unscheduledCostSubtotal > 0) {
      rows.push({ label: "Unscheduled", amount: formatMoney(trip.unscheduledCostSubtotal, trip.currency) });
    }
    return ok({ kind: "costs-table", rows, total: formatMoney(trip.tripCostTotal, trip.currency) });
  },
  render: blockOf,
};
