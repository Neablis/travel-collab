import { z } from "zod";
import type { ActivityView, Location, TripDetail } from "@tc/contracts";
import type { FlightLine, MacroDef, TripFlightsPayload, WidgetContext } from "../../registry-types";
import { blockOf } from "../../registry-types";
import { ok, empty, needsTrip, type MacroResult } from "../../result";
import { nextFlight, timedStops, tripNow, type TripNowStop } from "../../now";
import { readerClock, toClockLabel } from "../../clockLabel";

// `trip.flights` — *Your flights* (M52 decision 15): today's flights, or the
// next one, with its flight number, where it goes, its departure, and the
// countdown, which the block keeps on the page's minute clock from `startsAt`.
// No arrival: a stop's window ends the day it starts, so its end is not when
// the flight lands (KI-2026-10-23-b). A trip with no flight at all gets *Add
// your flight*, which opens the stop editor prefilled as a flight on `dayId`. Confirmation codes are
// M44's `booking` (decision 5, as amended), so none is shown.
//
// A registered widget, not a primitive, for `trip.now`'s reason: which flight
// is the clock's choice, not a filter's.

const FlightsParams = z.object({});
type FlightsParams = z.infer<typeof FlightsParams>;

/** What it says when the trip's flights are all behind it, and none is today. */
export const NO_FLIGHT_TODAY = "No flight today";

const isFlight = (a: Pick<ActivityView, "kind" | "mode"> | undefined) => a?.kind === "transit" && a.mode === "flight";
const placeName = (location: Location | null) => location?.city ?? location?.name ?? null;

/** A flight's line, its departure on its own day's clock (ADR-080 decision 1). */
function lineOf(trip: TripDetail, timed: ReadonlyMap<string, TripNowStop>, format: ReturnType<typeof readerClock>, activityId: string): FlightLine {
  const activity = trip.activities[activityId]!;
  const window = activity.timeWindow;
  return {
    activityId, title: activity.title, flightNumber: activity.flightNumber,
    from: placeName(activity.location), to: placeName(activity.endLocation),
    departs: window ? toClockLabel(window.start, format) : null,
    startsAt: timed.get(activityId)?.start ?? null,
  };
}

export const tripFlights: MacroDef<FlightsParams, TripFlightsPayload> = {
  name: "trip.flights", title: "Your flights", shape: "block",
  params: FlightsParams, inputs: [], selection: undefined,
  description:
    "The trip's flights for today, or the next one: flight number, where from and to, its departure time, and a countdown to departure. With no flight on the trip it offers to add one.",
  emptyText: "shows your flights once the time is known",
  preview: "your next flight, with a countdown to departure",
  resolve: ({ trip, globals, now, user }: WidgetContext): MacroResult<TripFlightsPayload> => {
    if (!trip) return needsTrip();
    // No reader's clock (the server, the assistant): neither today nor next.
    if (now == null) return empty();
    const where = tripNow(trip, globals, now);
    const flights = trip.days.flatMap((day) => day.activityIds.filter((id) => isFlight(trip.activities[id])).map((id) => ({ id, dayId: day.dayId })));
    if (flights.length === 0) {
      return ok({ kind: "trip-flights", heading: "none", flights: [], dayId: where.dayId ?? trip.days[0]?.dayId ?? null });
    }
    const timed = new Map(timedStops(trip, globals, now.deviceZone).map((s) => [s.activityId, s]));
    const line = (id: string) => lineOf(trip, timed, readerClock(user), id);
    const today = flights.filter((f) => where.phase === "underway" && f.dayId === where.dayId);
    if (today.length > 0) return ok({ kind: "trip-flights", heading: "today", flights: today.map((f) => line(f.id)), dayId: where.dayId });
    // A flight with no time yet has no instant to be next by, so the first
    // one on a day still to come is next when no timed flight comes on an
    // earlier day, with no countdown: the *soon* window is when the outbound
    // flight is wanted (decision 11), even with the flight home timed.
    const dateOf = (dayId: string) => trip.days.find((day) => day.dayId === dayId)?.date ?? null;
    const timedNext = nextFlight(trip, globals, now);
    const fromDate = where.phase === "underway" ? dateOf(where.dayId!) : where.firstDayToday;
    const untimed = fromDate === null ? undefined : flights.find((f) => {
      const date = dateOf(f.dayId);
      return date !== null && date >= fromDate && trip.activities[f.id]!.timeWindow == null;
    });
    const next = untimed && (timedNext === null || dateOf(untimed.dayId)! < dateOf(timedNext.dayId)!)
      ? { activityId: untimed.id, dayId: untimed.dayId }
      : timedNext;
    if (next) return ok({ kind: "trip-flights", heading: "next", flights: [line(next.activityId)], dayId: next.dayId });
    return empty(NO_FLIGHT_TODAY);
  },
  render: blockOf,
};
