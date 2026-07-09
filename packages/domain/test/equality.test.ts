import { describe, expect, it } from "vitest";
import { tripStatesEqual, type TripState } from "../src";

const base: TripState = {
  tripId: "7d9a1f8e-0000-4000-8000-00000000000a",
  name: "Rome",
  members: [{ userId: "u1", role: "owner" }],
  startDate: null,
  days: [{ dayId: "7d9a1f8e-0000-4000-8000-00000000000d", activityIds: [] }],
  backlog: ["7d9a1f8e-0000-4000-8000-0000000000a1"],
  activities: {
    "7d9a1f8e-0000-4000-8000-0000000000a1": { title: "Colosseum", timeWindow: null, location: null, notes: null },
  },
  dismissedConflictIds: [],
};

describe("tripStatesEqual", () => {
  it("is true for structurally identical states regardless of activity key order", () => {
    const twoActivities = {
      ...base,
      backlog: [...base.backlog, "7d9a1f8e-0000-4000-8000-0000000000a2"],
      activities: {
        ...base.activities,
        "7d9a1f8e-0000-4000-8000-0000000000a2": { title: "Vatican", timeWindow: null, location: null, notes: null },
      },
    };
    const reversedKeys = {
      ...twoActivities,
      activities: Object.fromEntries(Object.entries(twoActivities.activities).reverse()),
    };
    expect(tripStatesEqual(twoActivities, reversedKeys)).toBe(true);
  });

  it("is false when order-bearing lists differ", () => {
    expect(tripStatesEqual(base, { ...base, backlog: [] })).toBe(false);
    expect(tripStatesEqual(base, { ...base, startDate: "2026-10-12" })).toBe(false);
    expect(tripStatesEqual(base, { ...base, dismissedConflictIds: ["x"] })).toBe(false);
  });
});
