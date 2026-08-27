import { describe, expect, it } from "vitest";
import { tripDetailFixture } from "@tc/factories";
import type { ActivityView, TripDetail } from "@tc/contracts";
import { stopsForDay } from "./savedStops";

const dayA = "11111111-1111-4111-8111-111111111111";
const dayB = "22222222-2222-4222-8222-222222222222";
const a1 = "aaaaaaaa-1111-4111-8111-111111111111";
const a2 = "aaaaaaaa-2222-4222-8222-222222222222";

const activity = (activityId: string, title: string): ActivityView => ({
  activityId,
  title,
  timeWindow: { start: "09:00", end: "10:00" },
  location: { name: "Kyoto" },
  notes: "bring cash",
  anchors: [],
  kind: "booked",
  tags: ["meal"],
  cost: { amountMinor: 1200, currency: "USD" },
});

function detail(): TripDetail {
  return tripDetailFixture({
    startDate: "2027-06-01",
    days: [
      { dayId: dayA, activityIds: [a2, a1], date: "2027-06-01", costSubtotal: 2400 },
      { dayId: dayB, activityIds: [], date: "2027-06-02", costSubtotal: 0 },
    ],
    activities: { [a1]: activity(a1, "Coffee"), [a2]: activity(a2, "Market") },
  });
}

describe("stopsForDay", () => {
  it("keeps the day's stops in order, with everything that makes them a plan", () => {
    const stops = stopsForDay(detail(), dayA)!;
    expect(stops.map((s) => s.title)).toEqual(["Market", "Coffee"]);
    expect(stops[0]).toEqual({
      title: "Market",
      timeWindow: { start: "09:00", end: "10:00" },
      location: { name: "Kyoto" },
      notes: "bring cash",
      anchors: [],
      kind: "booked",
      tags: ["meal"],
      cost: { amountMinor: 1200, currency: "USD" },
    });
  });

  // An id would tie the fragment to the activity it came from, so inserting
  // the same saved day into two trips would put one id in two streams — the
  // KI-1 hazard, and the same reason cloneTrip remaps ids.
  it("drops activity ids", () => {
    for (const stop of stopsForDay(detail(), dayA)!) {
      expect(Object.keys(stop)).not.toContain("activityId");
    }
  });

  // The feature, not an omission: a date is derived from the trip's start, so
  // it belongs to the trip the day sat in. Keeping it would make a saved day
  // only reusable in June.
  it("carries no date anywhere, even though the source day has one", () => {
    expect(JSON.stringify(stopsForDay(detail(), dayA))).not.toContain("2027-06-01");
  });

  it("returns an empty list for a day with no stops", () => {
    expect(stopsForDay(detail(), dayB)).toEqual([]);
  });

  // A day that is not in this trip is a different situation from a day with
  // no stops, and both have a caller that cares.
  it("returns null for a day that is not in this trip", () => {
    expect(stopsForDay(detail(), "33333333-3333-4333-8333-333333333333")).toBeNull();
  });

  it("skips an activityId with no activity behind it rather than throwing", () => {
    const broken = { ...detail() };
    broken.days = [{ dayId: dayA, activityIds: [a1, "ghost"], date: null, costSubtotal: 0 }];
    expect(stopsForDay(broken, dayA)!.map((s) => s.title)).toEqual(["Coffee"]);
  });
});
