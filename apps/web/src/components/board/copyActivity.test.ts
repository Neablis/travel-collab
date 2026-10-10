import { describe, expect, it } from "vitest";
import { activityFactory, tripDetailFixture } from "@tc/factories";
import { copyActivityCommand } from "./copyActivity";

const DAY = "11111111-1111-4111-8111-111111111111";
const NEW_ID = "99999999-9999-4999-8999-999999999999";
const stop = activityFactory.build({
  title: "Tea ceremony",
  timeWindow: { start: "10:00", end: "11:00" },
  tags: ["ticketed"],
  cost: { amountMinor: 4500, currency: "USD" },
});
const trip = tripDetailFixture({ activities: { [stop.activityId]: stop } });

// M41 D7: an Option/Alt-drag drops a copy. A copy that lost a field would be a
// different stop, so the whole stop is what it carries.
describe("copyActivityCommand", () => {
  it("adds a new stop with every field of the original, on the day it was dropped on", () => {
    expect(copyActivityCommand(trip, stop.activityId, NEW_ID, { dayId: DAY })).toEqual(
      expect.objectContaining({
        type: "AddActivity",
        activityId: NEW_ID,
        dayId: DAY,
        title: "Tea ceremony",
        timeWindow: { start: "10:00", end: "11:00" },
        tags: ["ticketed"],
        cost: { amountMinor: 4500, currency: "USD" },
      }),
    );
  });

  it("takes the time the drop named, and none on the rack", () => {
    expect(copyActivityCommand(trip, stop.activityId, NEW_ID, { dayId: DAY, timeWindow: { start: "14:00", end: "15:00" } })?.timeWindow).toEqual({
      start: "14:00",
      end: "15:00",
    });
    expect(copyActivityCommand(trip, stop.activityId, NEW_ID, { dayId: null, timeWindow: null })).toEqual(
      expect.objectContaining({ dayId: undefined, timeWindow: undefined }),
    );
  });
});
