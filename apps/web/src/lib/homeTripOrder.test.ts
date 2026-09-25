import { describe, expect, it } from "vitest";
import type { TripSummary } from "@tc/contracts";
import { uuidFrom } from "@tc/factories";
import { orderHomeTrips } from "./homeTripOrder";

// KI-034: Home's hero is `orderHomeTrips(...)[0]`. Each list below is given in
// the server's order (newest-created first), which is the tie-break.
let sequence = 0;
function trip(name: string, startDate: string | null, endDate: string | null = startDate): TripSummary {
  return {
    tripId: uuidFrom(++sequence),
    name,
    status: "active",
    members: [{ userId: "dev-alice", role: "owner" }],
    createdAt: "2026-07-08T12:00:00.000Z",
    startDate,
    endDate,
  };
}

const TODAY = "2026-09-24";
const names = (trips: TripSummary[]) => trips.map((t) => t.name);

describe("orderHomeTrips", () => {
  it("puts upcoming trips first, soonest first, then undated, then past most-recent first", () => {
    const list = [
      trip("undated-new", null),
      trip("past-old", "2025-01-10"),
      trip("upcoming-late", "2027-03-01"),
      trip("undated-old", null),
      trip("past-recent", "2026-09-20"),
      trip("upcoming-soon", "2026-10-02"),
    ];
    expect(names(orderHomeTrips(list, TODAY))).toEqual([
      "upcoming-soon",
      "upcoming-late",
      "undated-new",
      "undated-old",
      "past-recent",
      "past-old",
    ]);
  });

  it("counts a trip starting today as upcoming, and yesterday's as past", () => {
    const list = [trip("yesterday", "2026-09-23"), trip("undated", null), trip("today", TODAY)];
    expect(names(orderHomeTrips(list, TODAY))).toEqual(["today", "undated", "yesterday"]);
  });

  // KI-2026-09-24-e: the hero matters most while you are on the trip.
  it("puts a trip that is under way first, ahead of upcoming and undated trips", () => {
    const list = [
      trip("undated", null),
      trip("upcoming", "2026-10-02", "2026-10-05"),
      trip("under-way", "2026-09-23", "2026-10-01"),
      trip("over", "2026-09-20", "2026-09-23"),
    ];
    expect(names(orderHomeTrips(list, TODAY))).toEqual(["under-way", "upcoming", "undated", "over"]);
  });

  it("counts a trip whose last day is today as under way, and one that ended yesterday as past", () => {
    const list = [
      trip("ended-yesterday", "2026-09-20", "2026-09-23"),
      trip("undated", null),
      trip("ends-today", "2026-09-20", TODAY),
    ];
    expect(names(orderHomeTrips(list, TODAY))).toEqual(["ends-today", "undated", "ended-yesterday"]);
  });

  it("puts the most recently started first when two trips are under way", () => {
    const list = [trip("earlier", "2026-09-01", "2026-09-30"), trip("later", "2026-09-22", "2026-09-26")];
    expect(names(orderHomeTrips(list, TODAY))).toEqual(["later", "earlier"]);
  });

  it("keeps the list's own order between trips on the same start date", () => {
    const list = [trip("newer", "2026-10-02"), trip("older", "2026-10-02")];
    expect(names(orderHomeTrips(list, TODAY))).toEqual(["newer", "older"]);
    expect(names(orderHomeTrips([...list].reverse(), TODAY))).toEqual(["older", "newer"]);
  });

  it("treats every dated trip as upcoming before today is known", () => {
    const list = [trip("undated", null), trip("past", "2001-01-01")];
    expect(names(orderHomeTrips(list, null))).toEqual(["past", "undated"]);
  });

  it("does not reorder the list it was given", () => {
    const list = [trip("undated", null), trip("upcoming", "2027-01-01")];
    orderHomeTrips(list, TODAY);
    expect(names(list)).toEqual(["undated", "upcoming"]);
  });
});
