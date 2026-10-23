import { describe, expect, it } from "vitest";
import { renderMacro } from "../../registry";
import type { TripNowPayload, WidgetContext } from "../../registry-types";
import { clockContext, dayTrip, MINUTE, stopId, wallAt } from "../../test-support/dayTrip";
import { nowAndNext } from "./nowNext";

// `trip.now`, *Now and next* (M52 decision 15). The resolver hands the block
// the stops still to finish, as instants, and `nowAndNext` picks the two the
// block shows each minute; so what is pinned is the pick at more than one
// minute from one payload, and the written empty state off the trip's dates.

const LISBON = "Europe/Lisbon";
const cafe = { name: "Café A Brasileira", lat: 38.7107, lng: -9.1424, city: "Lisbon" };
const trip = dayTrip([
  {
    date: "2026-06-10", zone: LISBON, city: "Lisbon",
    stops: [
      { title: "Coffee", timeWindow: { start: "09:00", end: "10:00" }, location: cafe },
      { title: "Tram", kind: "transit", mode: "bus", timeWindow: { start: "10:00", end: "10:30" } },
      { title: "Museum", timeWindow: { start: "10:30", end: "12:30" } },
      { title: "Lunch", timeWindow: { start: "13:00", end: "14:00" } },
    ],
  },
  { date: "2026-06-11", zone: LISBON, city: "Lisbon", stops: [{ title: "Train to Porto", timeWindow: { start: "09:00", end: "11:00" } }] },
]);
const at = (date: string, time: string) => wallAt(LISBON, date, time);

function resolve(ctx: WidgetContext) {
  return renderMacro(ctx, "trip.now", {});
}

function payloadAt(instant: number): TripNowPayload {
  const outcome = resolve(clockContext(trip, instant));
  if (outcome.status !== "ok" || outcome.rendered.kind !== "block" || outcome.rendered.block.kind !== "trip-now") {
    throw new Error(`expected a trip-now block, got ${JSON.stringify(outcome)}`);
  }
  return outcome.rendered.block;
}

describe("trip.now", () => {
  it("shows the stop under way and the next one, with its time in the reader's clock", () => {
    const payload = payloadAt(at("2026-06-10", "11:00"));
    const { current, next } = nowAndNext(payload, at("2026-06-10", "11:00"));
    expect(current).toMatchObject({ activityId: stopId(0, 2), title: "Museum", time: "10:30 – 12:30" });
    expect(next).toMatchObject({ activityId: stopId(0, 3), title: "Lunch", until: "2 h" });
  });

  it("moves on from the one payload as the minutes pass, as the block re-renders", () => {
    const payload = payloadAt(at("2026-06-10", "11:00"));
    const later = nowAndNext(payload, at("2026-06-10", "12:31"));
    expect(later.current).toBeNull();
    expect(later.next).toMatchObject({ title: "Lunch", until: "29 min" });
    // After the day's last stop, the next is tomorrow's first.
    expect(nowAndNext(payload, at("2026-06-10", "15:00")).next).toMatchObject({ title: "Train to Porto", until: "18 h" });
  });

  it("carries a stop's place and the leg leading in, for Directions", () => {
    const payload = payloadAt(at("2026-06-10", "08:00"));
    expect(payload.stops.find((s) => s.title === "Coffee")).toMatchObject({ place: cafe, mode: null });
    expect(payload.stops.find((s) => s.title === "Museum")).toMatchObject({ place: null, mode: "bus" });
  });

  it("says Nothing planned today before the trip and after it", () => {
    for (const day of ["2026-06-08", "2026-06-12"]) {
      expect(resolve(clockContext(trip, at(day, "12:00")))).toEqual({ status: "empty", because: "Nothing planned today" });
    }
  });

  it("says Nothing more planned today once the trip's last stop is over", () => {
    expect(resolve(clockContext(trip, at("2026-06-11", "12:00")))).toEqual({ status: "empty", because: "Nothing more planned today" });
  });

  it("waits for the reader's clock, which the server and the assistant do not have", () => {
    expect(resolve(clockContext(trip, null))).toEqual({ status: "empty" });
  });

  it("picks the later of two overlapping stops as the one under way", () => {
    const overlap = dayTrip([
      {
        date: "2026-06-10", zone: LISBON,
        stops: [{ title: "Walk", timeWindow: { start: "10:00", end: "12:00" } }, { title: "Tour", timeWindow: { start: "11:00", end: "11:30" } }],
      },
    ]);
    const instant = at("2026-06-10", "11:10");
    const outcome = resolve(clockContext(overlap, instant));
    if (outcome.status !== "ok" || outcome.rendered.kind !== "block" || outcome.rendered.block.kind !== "trip-now") throw new Error("expected ok");
    expect(nowAndNext(outcome.rendered.block, instant + MINUTE).current?.title).toBe("Tour");
  });
});
