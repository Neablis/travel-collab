import { describe, expect, it } from "vitest";
import type { TripDetail } from "@tc/contracts";
import { mapDays, routeLine } from "./mapRailData";

function detailWith(days: { dayId: string; date: string | null; activityIds: string[] }[], activities: Record<string, unknown>): TripDetail {
  return {
    tripId: "t", name: "T", status: "active", startDate: null, currency: "USD", budget: null,
    members: [{ userId: "u", role: "owner" }],
    days: days.map((d) => ({ ...d, costSubtotal: 0 })),
    backlog: [], activities: activities as TripDetail["activities"],
    conflicts: [], dismissedConflictIds: [], createdAt: "2026-01-01T00:00:00.000Z",
    unscheduledCostSubtotal: 0, tripCostTotal: 0, budgetRemaining: null,
  };
}

const at = (name: string, lat?: number, lng?: number) => ({
  activityId: name, title: name, timeWindow: null,
  location: lat === undefined ? { name } : { name, lat, lng, city: "Rochester" },
  notes: null, anchors: [], cost: null,
});

describe("mapDays", () => {
  it("builds one entry per day, in order", () => {
    const d = detailWith(
      [{ dayId: "d1", date: "2026-09-05", activityIds: ["a"] }, { dayId: "d2", date: "2026-09-06", activityIds: [] }],
      { a: at("a", 43.15, -77.6) },
    );
    expect(mapDays(d).map((m) => m.label)).toEqual(["Day 1", "Day 2"]);
    expect(mapDays(d)[0]!.index).toBe(0);
  });

  it("sums straight-line legs across a day's located stops", () => {
    const d = detailWith([{ dayId: "d1", date: null, activityIds: ["a", "b", "c"] }], {
      a: at("a", 43.15, -77.60), b: at("b", 43.16, -77.62), c: at("c", 43.17, -77.64),
    });
    const [day] = mapDays(d);
    expect(day!.stops).toHaveLength(3);
    expect(day!.totalKm).toBeGreaterThan(0);
  });

  it("has no distance with fewer than two located stops", () => {
    const d = detailWith([{ dayId: "d1", date: null, activityIds: ["a"] }], { a: at("a", 43.15, -77.6) });
    expect(mapDays(d)[0]!.totalKm).toBeNull();
  });

  it("excludes unlocated stops from the route but counts them", () => {
    const d = detailWith([{ dayId: "d1", date: null, activityIds: ["a", "b"] }], {
      a: at("a", 43.15, -77.6), b: at("b"),
    });
    const [day] = mapDays(d);
    expect(day!.stops).toHaveLength(1);
    expect(day!.unlocatedCount).toBe(1);
  });

  it("flags an empty day", () => {
    const d = detailWith([{ dayId: "d1", date: null, activityIds: [] }], {});
    expect(mapDays(d)[0]!.flagText).toBe("No stops yet");
  });
});

describe("routeLine", () => {
  it("returns GeoJSON [lng, lat] pairs in stop order", () => {
    const d = detailWith([{ dayId: "d1", date: null, activityIds: ["a", "b"] }], {
      a: at("a", 43.15, -77.60), b: at("b", 43.16, -77.62),
    });
    expect(routeLine(mapDays(d)[0]!)).toEqual([[-77.60, 43.15], [-77.62, 43.16]]);
  });

  it("returns an empty line for a day with no located stops", () => {
    const d = detailWith([{ dayId: "d1", date: null, activityIds: [] }], {});
    expect(routeLine(mapDays(d)[0]!)).toEqual([]);
  });
});
