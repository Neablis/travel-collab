import { describe, expect, it } from "vitest";
import type { TripDetail } from "@tc/contracts";
import { timelineRows } from "./timelineData";

const A1 = "7d9a1f8e-0000-4000-8000-0000000000a1";
const A2 = "7d9a1f8e-0000-4000-8000-0000000000a2";
const DAY = "7d9a1f8e-0000-4000-8000-00000000000d";
const detail: TripDetail = {
  tripId: "7d9a1f8e-0000-4000-8000-00000000000a", name: "Rome", startDate: "2026-10-12",
  members: [{ userId: "u1", role: "owner" }],
  days: [{ dayId: DAY, activityIds: [A1, A2], date: "2026-10-12" }], backlog: [],
  activities: {
    [A1]: { activityId: A1, title: "Museum", timeWindow: { start: "09:00", end: "11:00" }, location: null, notes: null, anchors: [] },
    [A2]: { activityId: A2, title: "Wander", timeWindow: null, location: null, notes: null, anchors: [] },
  },
  conflicts: [], dismissedConflictIds: [], createdAt: "2026-07-09T00:00:00.000Z",
};

describe("timelineRows", () => {
  it("splits timed (sorted by start) from untimed per day, in day order", () => {
    const [row] = timelineRows(detail);
    expect(row!.ordinal).toBe(1);
    expect(row!.date).toBe("2026-10-12");
    expect(row!.timed).toEqual([{ activityId: A1, title: "Museum", start: "09:00", end: "11:00" }]);
    expect(row!.untimed).toEqual([{ activityId: A2, title: "Wander" }]);
  });
});
