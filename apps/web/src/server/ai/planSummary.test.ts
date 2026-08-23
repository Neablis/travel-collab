import { describe, expect, it } from "vitest";
import type { BatchableCommand } from "@tc/contracts";
import { costedTripDetailFixture } from "@tc/factories";
import { summarizeBatch } from "./planSummary";

// costedTripDetailFixture: one day (dayId below) holding "Colosseum tour" and
// "Roman Forum", plus "Flight to Rome" in the backlog.
const DAY_ID = "1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d";
const COLOSSEUM_ID = "2c3d4e5f-6071-4b8c-9d0e-1f2a3b4c5d6e";
const FORUM_ID = "3d4e5f60-7182-4c9d-0e1f-2a3b4c5d6e7f";

describe("summarizeBatch", () => {
  const detail = costedTripDetailFixture();
  const tripId = detail.tripId;

  it("names the moved activity and its target day (the user's 'move X' case)", () => {
    const calls: BatchableCommand[] = [
      { type: "MoveActivity", tripId, activityId: COLOSSEUM_ID, toDayId: DAY_ID, position: 0 },
    ];
    expect(summarizeBatch(calls, detail)).toBe("Done — moved “Colosseum tour” to day 1.");
  });

  it("says 'the backlog' when toDayId is null", () => {
    const calls: BatchableCommand[] = [
      { type: "MoveActivity", tripId, activityId: FORUM_ID, toDayId: null, position: 0 },
    ];
    expect(summarizeBatch(calls, detail)).toBe("Done — moved “Roman Forum” to the backlog.");
  });

  it("joins two commands with 'and' (the user's 'move X then add Y' case)", () => {
    const calls: BatchableCommand[] = [
      { type: "MoveActivity", tripId, activityId: COLOSSEUM_ID, toDayId: DAY_ID, position: 1 },
      { type: "AddActivity", tripId, activityId: "9a9a9a9a-1111-4222-8333-444455556666", title: "Dinner in Oakland" },
    ];
    expect(summarizeBatch(calls, detail)).toBe(
      "Done — moved “Colosseum tour” to day 1 and added “Dinner in Oakland” to the backlog.",
    );
  });

  it("uses an Oxford comma for three or more commands", () => {
    const calls: BatchableCommand[] = [
      { type: "AddDay", tripId, dayId: "aaaaaaaa-1111-4222-8333-444455556666" },
      { type: "RemoveActivity", tripId, activityId: FORUM_ID },
      { type: "SetTripBudget", tripId, budget: null },
    ];
    expect(summarizeBatch(calls, detail)).toBe(
      "Done — added a day, removed “Roman Forum”, and cleared the budget.",
    );
  });

  it("falls back gracefully when an activity id isn't in the trip detail", () => {
    const calls: BatchableCommand[] = [
      { type: "RemoveActivity", tripId, activityId: "00000000-0000-4000-8000-000000000000" },
    ];
    expect(summarizeBatch(calls, detail)).toBe("Done — removed “an activity”.");
  });

  it("names the new trip name (rename)", () => {
    const calls: BatchableCommand[] = [{ type: "SetTripName", tripId, name: "Rome & Florence" }];
    expect(summarizeBatch(calls, detail)).toBe('Done — renamed the trip to "Rome & Florence".');
  });

  it("states the new date range when both dates are set", () => {
    const calls: BatchableCommand[] = [
      { type: "SetTripDates", tripId, startDate: "2027-06-01", endDate: "2027-06-08", newDayIds: [] },
    ];
    expect(summarizeBatch(calls, detail)).toBe("Done — set the trip dates to 2027-06-01 – 2027-06-08.");
  });

  it("falls back to a generic phrase when a date bound is cleared", () => {
    const calls: BatchableCommand[] = [
      { type: "SetTripDates", tripId, startDate: null, endDate: null, newDayIds: [] },
    ];
    expect(summarizeBatch(calls, detail)).toBe("Done — set the trip dates.");
  });
});
