import { describe, expect, it } from "vitest";
import type { ActivityKind, TripDetail } from "@tc/contracts";
import { mapDays, routeLegs } from "./mapRailData";

function detailWith(days: { dayId: string; date: string | null; activityIds: string[] }[], activities: Record<string, unknown>): TripDetail {
  return {
    tripId: "t", name: "T", status: "active", startDate: null, currency: "USD", budget: null,
    members: [{ userId: "u", role: "owner" }],
    forkedFrom: null,
    days: days.map((d) => ({ ...d, costSubtotal: 0 })),
    backlog: [], activities: activities as TripDetail["activities"],
    conflicts: [], dismissedConflictIds: [], createdAt: "2026-01-01T00:00:00.000Z",
    unscheduledCostSubtotal: 0, tripCostTotal: 0, budgetRemaining: null,
  };
}

const at = (name: string, lat?: number, lng?: number, kind: ActivityKind = "planned") => ({
  activityId: name, title: name, timeWindow: null,
  location: lat === undefined ? { name } : { name, lat, lng, city: "Rochester" },
  notes: null, anchors: [], cost: null, kind,
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

  // Phase 6: an empty day sets `isEmpty` and leaves `flagText` null. The two
  // map surfaces say different things about that state ("Nothing planned yet"
  // in the rail, "No stops yet" in the focus card), so the model carries the
  // fact and each surface renders its own copy — no pre-rendered string here.
  it("marks an empty day as empty, without a flag", () => {
    const d = detailWith([{ dayId: "d1", date: null, activityIds: [] }], {});
    const [day] = mapDays(d);
    expect(day!.isEmpty).toBe(true);
    expect(day!.flagText).toBeNull();
    expect(day!.stops).toEqual([]);
    expect(day!.bars).toEqual([]);
    expect(day!.totalKm).toBeNull();
  });

  it("flags unlocated stops, singular and plural, and does not call the day empty", () => {
    const one = detailWith([{ dayId: "d1", date: null, activityIds: ["a", "b"] }], {
      a: at("a", 43.15, -77.6), b: at("b"),
    });
    expect(mapDays(one)[0]!.flagText).toBe("1 stop has no place yet");
    expect(mapDays(one)[0]!.isEmpty).toBe(false);

    const many = detailWith([{ dayId: "d1", date: null, activityIds: ["a", "b", "c"] }], {
      a: at("a", 43.15, -77.6), b: at("b"), c: at("c"),
    });
    expect(mapDays(many)[0]!.flagText).toBe("2 stops have no place yet");
    expect(mapDays(many)[0]!.isEmpty).toBe(false);
  });

  // Every stop unlocated is still a planned day — the map just can't draw it.
  it("does not call a day empty when all of its stops lack coordinates", () => {
    const d = detailWith([{ dayId: "d1", date: null, activityIds: ["a", "b"] }], { a: at("a"), b: at("b") });
    const [day] = mapDays(d);
    expect(day!.isEmpty).toBe(false);
    expect(day!.flagText).toBe("2 stops have no place yet");
  });

  it("leaves a fully located day with neither an empty mark nor a flag", () => {
    const d = detailWith([{ dayId: "d1", date: null, activityIds: ["a", "b"] }], {
      a: at("a", 43.15, -77.6), b: at("b", 43.16, -77.62),
    });
    expect(mapDays(d)[0]!.isEmpty).toBe(false);
    expect(mapDays(d)[0]!.flagText).toBeNull();
  });

  it("marks every day of an all-empty trip as empty", () => {
    const d = detailWith(
      [
        { dayId: "d1", date: null, activityIds: [] },
        { dayId: "d2", date: null, activityIds: [] },
        { dayId: "d3", date: null, activityIds: [] },
      ],
      {},
    );
    expect(mapDays(d).map((m) => m.isEmpty)).toEqual([true, true, true]);
    expect(mapDays(d).map((m) => m.flagText)).toEqual([null, null, null]);
  });

  it("returns nothing at all for a trip with no days", () => {
    expect(mapDays(detailWith([], {}))).toEqual([]);
  });
});

describe("routeLegs", () => {
  it("returns GeoJSON [lng, lat] leg pairs in stop order", () => {
    const d = detailWith([{ dayId: "d1", date: null, activityIds: ["a", "b"] }], {
      a: at("a", 43.15, -77.60), b: at("b", 43.16, -77.62),
    });
    expect(routeLegs(mapDays(d)[0]!)).toEqual({
      rest: [[[-77.60, 43.15], [-77.62, 43.16]]],
      travel: [],
    });
  });

  it("returns no legs at all for a day with no located stops", () => {
    const d = detailWith([{ dayId: "d1", date: null, activityIds: [] }], {});
    expect(routeLegs(mapDays(d)[0]!)).toEqual({ rest: [], travel: [] });
  });

  it("has no legs for a single stop — a leg needs two ends", () => {
    const d = detailWith([{ dayId: "d1", date: null, activityIds: ["a"] }], { a: at("a", 43.15, -77.6) });
    expect(routeLegs(mapDays(d)[0]!)).toEqual({ rest: [], travel: [] });
  });

  // The rule the dashed line encodes: a transit stop IS the movement, so the
  // hop that reaches it and the hop that leaves it are both travel.
  it("counts a leg as travel when either end is a transit stop", () => {
    const d = detailWith([{ dayId: "d1", date: null, activityIds: ["a", "t", "b"] }], {
      a: at("a", 43.10, -77.60),
      t: at("t", 43.20, -77.70, "transit"),
      b: at("b", 43.30, -77.80),
    });
    const legs = routeLegs(mapDays(d)[0]!);
    expect(legs.travel).toEqual([
      [[-77.60, 43.10], [-77.70, 43.20]],
      [[-77.70, 43.20], [-77.80, 43.30]],
    ]);
    expect(legs.rest).toEqual([]);
  });

  it("keeps non-travel legs solid on a day that also has travel", () => {
    const d = detailWith([{ dayId: "d1", date: null, activityIds: ["a", "b", "t"] }], {
      a: at("a", 43.10, -77.60),
      b: at("b", 43.20, -77.70),
      t: at("t", 43.30, -77.80, "transit"),
    });
    const legs = routeLegs(mapDays(d)[0]!);
    expect(legs.rest).toEqual([[[-77.60, 43.10], [-77.70, 43.20]]]);
    expect(legs.travel).toEqual([[[-77.70, 43.20], [-77.80, 43.30]]]);
  });
});
