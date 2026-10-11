import { describe, expect, it } from "vitest";
import { tripDetailFixture } from "@tc/factories";
import { daysAfterEnd, resolveCalendarDrop } from "./calendarDrop";

const DAY_1 = "11111111-1111-4111-8111-111111111111";
const DAY_2 = "22222222-2222-4222-8222-222222222222";
const trip = tripDetailFixture({
  startDate: "2027-06-01",
  days: [
    { dayId: DAY_1, activityIds: ["a"], date: "2027-06-01", costSubtotal: 0 },
    { dayId: DAY_2, activityIds: [], date: "2027-06-02", costSubtotal: 0 },
  ],
});
const card = { kind: "city-card", activityIds: ["a", "b"], fromDayIndex: 0 };

describe("resolveCalendarDrop (M41 D2)", () => {
  it("moves a city card's stops onto another day", () => {
    expect(resolveCalendarDrop(trip, card, { kind: "calendar-day", dayIndex: 1 })).toEqual({
      kind: "stops",
      activityIds: ["a", "b"],
      toDayId: DAY_2,
      newDays: 0,
    });
  });

  it("does nothing for a card dropped back on its own day", () => {
    expect(resolveCalendarDrop(trip, card, { kind: "calendar-day", dayIndex: 0 })).toBeNull();
  });

  it("grows the trip to a date after its end, by the days between", () => {
    expect(resolveCalendarDrop(trip, card, { kind: "calendar-after", date: "2027-06-05" })).toEqual({
      kind: "stops",
      activityIds: ["a", "b"],
      toDayId: null,
      newDays: 3,
    });
  });

  it("places a rack card on a day the way Plan does, and does not grow the trip for one", () => {
    expect(resolveCalendarDrop(trip, { activityId: "p" }, { kind: "calendar-day", dayIndex: 1 })).toEqual({
      kind: "rack",
      activityId: "p",
      toDayId: DAY_2,
    });
    expect(resolveCalendarDrop(trip, { activityId: "p" }, { kind: "calendar-after", date: "2027-06-05" })).toBeNull();
  });

  it("counts no days after the end for a date inside or before the trip", () => {
    expect(daysAfterEnd(trip, "2027-06-02")).toBe(0);
    expect(daysAfterEnd(trip, "2027-05-20")).toBe(0);
  });
});
