import { describe, expect, it } from "vitest";
import type { TripDetail } from "@tc/contracts";
import { activityPins, unlocatedActivities } from "./mapData";

const A1 = "7d9a1f8e-0000-4000-8000-0000000000a1";
const A2 = "7d9a1f8e-0000-4000-8000-0000000000a2";
const DAY = "7d9a1f8e-0000-4000-8000-00000000000d";
const detail: TripDetail = {
  tripId: "7d9a1f8e-0000-4000-8000-00000000000a", name: "Rome", startDate: null,
  currency: "USD", budget: null,
  members: [{ userId: "u1", role: "owner" }],
  days: [{ dayId: DAY, activityIds: [A1], date: null, costSubtotal: 0 }], backlog: [A2],
  unscheduledCostSubtotal: 0, tripCostTotal: 0, budgetRemaining: null,
  activities: {
    [A1]: { activityId: A1, title: "Colosseum", timeWindow: null, location: { name: "Colosseum", lat: 41.89, lng: 12.49 }, notes: null, anchors: [], kind: "planned" as const, tags: [], cost: null },
    [A2]: { activityId: A2, title: "Idea", timeWindow: null, location: null, notes: null, anchors: [], kind: "planned" as const, tags: [], cost: null },
  },
  conflicts: [], dismissedConflictIds: [], createdAt: "2026-07-09T00:00:00.000Z",
  status: "active",
};

describe("map data", () => {
  it("returns a pin only for located activities, tagged with its day", () => {
    expect(activityPins(detail)).toEqual([{ activityId: A1, title: "Colosseum", lat: 41.89, lng: 12.49, dayId: DAY }]);
  });
  it("excludes a backlog activity even with no location — the map never plots the backlog, located or not", () => {
    expect(unlocatedActivities(detail)).toEqual([]);
  });
  it("lists a day-attached activity that has no location", () => {
    const A3 = "7d9a1f8e-0000-4000-8000-0000000000a3";
    const withDayAttached: TripDetail = {
      ...detail,
      days: [{ dayId: DAY, activityIds: [A1, A3], date: null, costSubtotal: 0 }],
      activities: {
        ...detail.activities,
        [A3]: { activityId: A3, title: "Museum", timeWindow: null, location: null, notes: null, anchors: [], kind: "planned" as const, tags: [], cost: null },
      },
    };
    expect(unlocatedActivities(withDayAttached).map((a) => a.activityId)).toEqual([A3]);
  });
});
