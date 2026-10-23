import { describe, expect, it } from "vitest";
import { renderMacro } from "../../registry";
import { clockContext, dayTrip, stopId, wallAt } from "../../test-support/dayTrip";

// `trip.flights`, *Your flights* (M52 decision 15): today's flights, or the
// next one, each end's time on its own clock; *Add your flight* when the trip
// has none; and *No flight today* when it has some but none today or ahead.

const LISBON = "Europe/Lisbon";
const TOKYO = "Asia/Tokyo";
const flight = {
  title: "Flight to Tokyo", kind: "transit" as const, mode: "flight" as const, flightNumber: "TP 1234",
  // 12:00 to 23:00 on Lisbon's clock, which is 07:00 the next morning in Tokyo.
  timeWindow: { start: "12:00", end: "23:00" },
  location: { name: "Lisbon Airport", city: "Lisbon" }, endLocation: { name: "Haneda Airport", city: "Tokyo" },
};
const trip = dayTrip([
  { date: "2026-06-10", zone: LISBON, city: "Lisbon", stops: [{ title: "Pack" }, flight] },
  { date: "2026-06-11", zone: TOKYO, city: "Tokyo", stops: [{ title: "Ramen", timeWindow: { start: "12:00", end: "13:00" } }] },
]);
const line = {
  activityId: stopId(0, 1), title: "Flight to Tokyo", flightNumber: "TP 1234", from: "Lisbon", to: "Tokyo",
  departs: "12:00", arrives: "07:00 Jun 11", startsAt: wallAt(LISBON, "2026-06-10", "12:00"),
};

describe("trip.flights", () => {
  it("lists today's flights, with each end's time on its own clock", () => {
    expect(renderMacro(clockContext(trip, wallAt(LISBON, "2026-06-10", "08:00")), "trip.flights", {})).toMatchObject({
      status: "ok", rendered: { kind: "block", block: { kind: "trip-flights", heading: "today", flights: [line] } },
    });
  });

  it("shows the next flight before the trip, for the countdown", () => {
    expect(renderMacro(clockContext(trip, wallAt(LISBON, "2026-06-08", "08:00")), "trip.flights", {})).toMatchObject({
      status: "ok", rendered: { kind: "block", block: { kind: "trip-flights", heading: "next", flights: [line] } },
    });
  });

  it("says No flight today when the trip's flights are behind it", () => {
    expect(renderMacro(clockContext(trip, wallAt(TOKYO, "2026-06-11", "12:00")), "trip.flights", {})).toEqual({
      status: "empty", because: "No flight today",
    });
  });

  it("offers Add your flight on a trip with none, on today's day while under way", () => {
    const grounded = dayTrip([
      { date: "2026-06-10", zone: LISBON, stops: [] },
      { date: "2026-06-11", zone: LISBON, stops: [] },
    ]);
    const on = (date: string) => renderMacro(clockContext(grounded, wallAt(LISBON, date, "09:00")), "trip.flights", {});
    expect(on("2026-06-11")).toMatchObject({
      status: "ok", rendered: { block: { kind: "trip-flights", heading: "none", flights: [], dayId: grounded.trip.days[1]!.dayId } },
    });
    expect(on("2026-06-01")).toMatchObject({ rendered: { block: { heading: "none", dayId: grounded.trip.days[0]!.dayId } } });
  });

  it("waits for the reader's clock, which the server and the assistant do not have", () => {
    expect(renderMacro(clockContext(trip, null), "trip.flights", {})).toEqual({ status: "empty" });
  });
});
