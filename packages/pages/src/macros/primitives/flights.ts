import { z } from "zod";
import type { ActivityView, Location, TripDetail, TripGlobals } from "@tc/contracts";
import type { FlightLine, MacroDef, TripFlightsPayload, WidgetContext } from "../../registry-types";
import { blockOf } from "../../registry-types";
import { ok, empty, needsTrip, type MacroResult } from "../../result";
import { nextFlight, timedStops, tripNow, type TripNowStop } from "../../now";
import { clockIn, isKnownZone } from "../../clock";
import { readerClock, toClockLabel } from "../../clockLabel";
import { formatShortDate } from "../../format";

// `trip.flights` — *Your flights* (M52 decision 15): today's flights, or the
// next one, with its flight number, each end's time on that end's clock, and
// the countdown, which the block keeps on its own minute clock from
// `startsAt`. A trip with no flight at all gets *Add your flight*, which opens
// the stop editor prefilled as a flight on `dayId`. Confirmation codes are
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

/**
 * The zone a flight lands in: the first day from its own on whose place is
 * the city it lands in. `null` when no day says, and the stored time is read
 * as it was entered, on the departure day's clock (ADR-080 decision 1).
 */
function arrivalZone(globals: TripGlobals | null, fromIndex: number, city: string | null): string | null {
  if (city === null) return null;
  const day = globals?.days.find((d) => d.index >= fromIndex && d.place?.city === city && d.timeZone !== null);
  return day?.timeZone != null && isKnownZone(day.timeZone) ? day.timeZone : null;
}

function lineOf(
  trip: TripDetail,
  globals: TripGlobals | null,
  timed: ReadonlyMap<string, TripNowStop>,
  format: ReturnType<typeof readerClock>,
  activityId: string,
): FlightLine {
  const activity = trip.activities[activityId]!;
  const placed = timed.get(activityId);
  const window = activity.timeWindow;
  const to = placeName(activity.endLocation);
  let arrives: string | null = null;
  if (window && placed) {
    const dayIndex = trip.days.findIndex((day) => day.dayId === placed.dayId);
    const zone = arrivalZone(globals, dayIndex, activity.endLocation?.city ?? null);
    if (zone === null) arrives = toClockLabel(window.end, format);
    else {
      const landing = clockIn(zone, placed.end);
      const date = landing.date === trip.days[dayIndex]!.date ? "" : ` ${formatShortDate(landing.date)}`;
      arrives = `${toClockLabel(landing.time, format)}${date}`;
    }
  }
  return {
    activityId, title: activity.title, flightNumber: activity.flightNumber,
    from: placeName(activity.location), to,
    departs: window ? toClockLabel(window.start, format) : null,
    arrives,
    startsAt: placed?.start ?? null,
  };
}

export const tripFlights: MacroDef<FlightsParams, TripFlightsPayload> = {
  name: "trip.flights", title: "Your flights", shape: "block",
  params: FlightsParams, inputs: [], selection: undefined,
  description:
    "The trip's flights for today, or the next one: flight number, where from and to, departure and arrival each in its own local time, and a countdown to departure. With no flight on the trip it offers to add one.",
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
    const line = (id: string) => lineOf(trip, globals, timed, readerClock(user), id);
    const today = flights.filter((f) => where.phase === "underway" && f.dayId === where.dayId);
    if (today.length > 0) return ok({ kind: "trip-flights", heading: "today", flights: today.map((f) => line(f.id)), dayId: where.dayId });
    const next = nextFlight(trip, globals, now);
    if (next) return ok({ kind: "trip-flights", heading: "next", flights: [line(next.activityId)], dayId: next.dayId });
    return empty(NO_FLIGHT_TODAY);
  },
  render: blockOf,
};
