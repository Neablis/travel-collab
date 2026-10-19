import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TripSummary } from "@tc/contracts";
import { tripSummaryFactory, uuidFrom } from "@tc/factories";
import { orderHomeTrips, tripHasEnded } from "./homeTripOrder";

// KI-034: Home's hero is `orderHomeTrips(...)[0]`. Each list below is given in
// the server's order (newest-created first), which is the tie-break.
let sequence = 0;
/** A trip summary with a fresh id, named and dated; the end defaults to the start. */
function trip(name: string, startDate: string | null, endDate: string | null = startDate): TripSummary {
  return tripSummaryFactory.build({ tripId: uuidFrom(++sequence), name, startDate, endDate });
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

describe("tripHasEnded", () => {
  // The reader's own calendar, so the zone is pinned to one west of UTC: in
  // UTC a local date and a UTC date agree and the edge below proves nothing.
  const zone = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = "America/Los_Angeles";
  });
  afterAll(() => {
    process.env.TZ = zone;
  });

  it("is over from the day after the last day, not on it", () => {
    const ending = trip("ending", "2026-09-20", TODAY);
    expect(tripHasEnded(ending, new Date(2026, 8, 24, 12))).toBe(false);
    expect(tripHasEnded(ending, new Date(2026, 8, 25, 0, 1))).toBe(true);
  });

  it("reads the reader's date, not UTC's, late on the last day", () => {
    // 20:00 on the 24th in Los Angeles is already the 25th in UTC.
    const ending = trip("ending", "2026-09-20", TODAY);
    expect(tripHasEnded(ending, new Date("2026-09-25T03:00:00Z"))).toBe(false);
  });

  it("never ends a trip with no last day", () => {
    expect(tripHasEnded(trip("undated", null), new Date(2030, 0, 1))).toBe(false);
    expect(tripHasEnded(trip("dated, no days", "2020-01-01", null), new Date(2030, 0, 1))).toBe(false);
  });
});
