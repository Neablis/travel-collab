import { describe, expect, it } from "vitest";
import type { TripDetail } from "@tc/contracts";
import { activityPins, unlocatedActivities } from "./mapData";

const A1 = "7d9a1f8e-0000-4000-8000-0000000000a1";
const A2 = "7d9a1f8e-0000-4000-8000-0000000000a2";
const DAY = "7d9a1f8e-0000-4000-8000-00000000000d";
const detail: TripDetail = {
  tripId: "7d9a1f8e-0000-4000-8000-00000000000a", name: "Rome", startDate: null,
  members: [{ userId: "u1", role: "owner" }],
  days: [{ dayId: DAY, activityIds: [A1], date: null }], backlog: [A2],
  activities: {
    [A1]: { activityId: A1, title: "Colosseum", timeWindow: null, location: { name: "Colosseum", lat: 41.89, lng: 12.49 }, notes: null, anchors: [] },
    [A2]: { activityId: A2, title: "Idea", timeWindow: null, location: null, notes: null, anchors: [] },
  },
  conflicts: [], dismissedConflictIds: [], createdAt: "2026-07-09T00:00:00.000Z",
};

describe("map data", () => {
  it("returns a pin only for located activities, tagged with its day", () => {
    expect(activityPins(detail)).toEqual([{ activityId: A1, title: "Colosseum", lat: 41.89, lng: 12.49, dayId: DAY }]);
  });
  it("lists located-less activities separately", () => {
    expect(unlocatedActivities(detail).map((a) => a.activityId)).toEqual([A2]);
  });
});
