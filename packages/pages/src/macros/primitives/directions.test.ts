import { describe, expect, it } from "vitest";
import { renderMacro } from "../../registry";
import type { WidgetContext } from "../../registry-types";
import { clockContext, dayTrip, stopId, wallAt } from "../../test-support/dayTrip";

// `stop.directions`, *Directions* (M52 decisions 15, 16): the bound stop, or
// under a page's Today scope the next place still to go to. The URL itself is
// `apps/web`'s `directionsUrl`; what is pinned here is WHICH stop, and the leg
// that says how to get there.

const LISBON = "Europe/Lisbon";
const cafe = { name: "Café A Brasileira", lat: 38.7107, lng: -9.1424, city: "Lisbon" };
const museum = { name: "Gulbenkian Museum", lat: 38.7372, lng: -9.1543, city: "Lisbon" };
const tasca = { name: "Tasca do Chico", lat: 38.7116, lng: -9.1446, city: "Lisbon" };
const trip = dayTrip([
  {
    date: "2026-06-10", zone: LISBON, city: "Lisbon",
    stops: [
      { title: "Coffee", timeWindow: { start: "09:00", end: "10:00" }, location: cafe },
      { title: "Metro", kind: "transit", mode: "train", timeWindow: { start: "10:00", end: "10:30" } },
      { title: "Museum", timeWindow: { start: "10:30", end: "12:30" }, location: museum },
      { title: "Dinner", timeWindow: { start: "19:00", end: "21:00" }, location: tasca },
    ],
  },
  { date: "2026-06-11", zone: LISBON, city: "Lisbon", stops: [{ title: "Notes to self" }] },
]);
const at = (date: string, time: string) => wallAt(LISBON, date, time);
const today = (instant: number): WidgetContext => ({ ...clockContext(trip, instant), page: { tripId: trip.trip.tripId, dateScope: "today" } });

function payloadOf(outcome: ReturnType<typeof renderMacro>) {
  if (outcome.status !== "ok" || outcome.rendered.kind !== "block" || outcome.rendered.block.kind !== "stop-directions") {
    throw new Error(`expected a stop-directions block, got ${JSON.stringify(outcome)}`);
  }
  return outcome.rendered.block;
}

describe("stop.directions", () => {
  it("goes to the stop its line is bound to, with the leg leading in", () => {
    const outcome = renderMacro(clockContext(trip, null), "stop.directions", {}, { kind: "stop", activityId: stopId(0, 2), dayIndex: 0 });
    expect(payloadOf(outcome)).toEqual({
      kind: "stop-directions", activityId: stopId(0, 2), title: "Museum", time: "10:30 – 12:30", place: museum, mode: "train",
    });
  });

  it("goes to the next place still ahead today under the Today scope", () => {
    // The museum is under way at 11:00, so it is still somewhere to go.
    expect(payloadOf(renderMacro(today(at("2026-06-10", "11:00")), "stop.directions", {}))).toMatchObject({ title: "Museum" });
    expect(payloadOf(renderMacro(today(at("2026-06-10", "13:00")), "stop.directions", {}))).toMatchObject({ title: "Dinner", mode: null });
  });

  it("says Nothing planned today off the trip's dates", () => {
    expect(renderMacro(today(at("2026-06-08", "12:00")), "stop.directions", {})).toEqual({ status: "empty", because: "Nothing planned today" });
  });

  it("says Nothing more planned today once today's places are behind", () => {
    expect(renderMacro(today(at("2026-06-10", "22:00")), "stop.directions", {})).toEqual({
      status: "empty", because: "Nothing more planned today",
    });
  });

  it("asks for a place when today's stops have none", () => {
    expect(renderMacro(today(at("2026-06-11", "08:00")), "stop.directions", {})).toEqual({
      status: "empty", because: "add a place to a stop to see this",
    });
  });

  it("leaves an untimed stop behind once a stop after it has ended", () => {
    const hotel = { name: "Hotel Avenida", lat: 38.7167, lng: -9.1424, city: "Lisbon" };
    const day = dayTrip([
      {
        date: "2026-06-10", zone: LISBON, city: "Lisbon",
        stops: [
          { title: "Hotel", location: hotel },
          { title: "Coffee", timeWindow: { start: "09:00", end: "10:00" }, location: cafe },
          { title: "Dinner", timeWindow: { start: "19:00", end: "21:00" }, location: tasca },
        ],
      },
    ]);
    const ctx: WidgetContext = { ...clockContext(day, at("2026-06-10", "13:00")), page: { tripId: day.trip.tripId, dateScope: "today" } };
    expect(payloadOf(renderMacro(ctx, "stop.directions", {}))).toMatchObject({ title: "Dinner" });
  });

  it("passes over a place that is only a typed name, as the stop sheet does", () => {
    const day = dayTrip([
      { date: "2026-06-10", zone: LISBON, city: "Lisbon", stops: [{ title: "Dinner w/ Ana", timeWindow: { start: "19:00", end: "21:00" }, location: { name: "Dinner w/ Ana" } }] },
    ]);
    const ctx: WidgetContext = { ...clockContext(day, at("2026-06-10", "08:00")), page: { tripId: day.trip.tripId, dateScope: "today" } };
    expect(renderMacro(ctx, "stop.directions", {})).toEqual({ status: "empty", because: "add a place to a stop to see this" });
  });
});
