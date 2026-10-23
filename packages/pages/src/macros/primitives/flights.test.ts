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

/** The arrival the widget shows for `days`' only flight, read at `at`. */
function arrivalAt(days: ReturnType<typeof dayTrip>, at: number): string | null {
  const outcome = renderMacro(clockContext(days, at), "trip.flights", {});
  if (outcome.status !== "ok" || outcome.rendered.kind !== "block" || outcome.rendered.block.kind !== "trip-flights") {
    throw new Error(`expected a trip-flights block, got ${JSON.stringify(outcome)}`);
  }
  return outcome.rendered.block.flights[0]!.arrives;
}

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

  it("names the clock an arrival is on when no later day is in the city it lands in", () => {
    // Haneda geocodes to Ota City, so no day's city matches; the next day's zone is where it lands.
    const ota = { ...flight, endLocation: { name: "Haneda Airport", city: "Ota City" } };
    const shibuya = dayTrip([
      { date: "2026-06-10", zone: LISBON, city: "Lisbon", stops: [ota] },
      { date: "2026-06-11", zone: TOKYO, city: "Shibuya", stops: [] },
    ]);
    expect(arrivalAt(shibuya, wallAt(LISBON, "2026-06-10", "08:00"))).toBe("07:00 Jun 11 (Tokyo time)");
  });

  it("puts the flight home on the home clock, and says which clock it is on when there is none", () => {
    // 10:00 to 14:00 on Tokyo's clock, which is 06:00 the same morning in Lisbon.
    const home = { ...flight, title: "Flight home", timeWindow: { start: "10:00", end: "14:00" }, location: { name: "Haneda Airport", city: "Tokyo" }, endLocation: { name: "Lisbon Airport", city: "Lisbon" } };
    const lastDay = dayTrip([{ date: "2026-06-10", zone: TOKYO, city: "Tokyo", stops: [home] }]);
    const morning = wallAt(TOKYO, "2026-06-10", "08:00");
    expect(arrivalAt({ ...lastDay, globals: { ...lastDay.globals, homeTimeZone: LISBON } }, morning)).toBe("06:00 (Lisbon time)");
    expect(arrivalAt(lastDay, morning)).toBe("14:00 (Tokyo time)");
  });

  it("shows an untimed flight before the trip as the next one, with no countdown", () => {
    const untimed = dayTrip([{ date: "2026-06-10", zone: LISBON, city: "Lisbon", stops: [{ ...flight, timeWindow: null }] }]);
    expect(renderMacro(clockContext(untimed, wallAt(LISBON, "2026-06-08", "08:00")), "trip.flights", {})).toMatchObject({
      status: "ok",
      rendered: { block: { heading: "next", flights: [{ activityId: stopId(0, 0), departs: null, arrives: null, startsAt: null }] } },
    });
  });

  it("waits for the reader's clock, which the server and the assistant do not have", () => {
    expect(renderMacro(clockContext(trip, null), "trip.flights", {})).toEqual({ status: "empty" });
  });
});
