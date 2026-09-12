import { describe, expect, it } from "vitest";
import type { ActivityKind, Location, TripDetail } from "@tc/contracts";
import { mapDays, markerGroups, routeLegs } from "./mapRailData";

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

// One marker per place the day claims. A `city` coordinate is a city centroid,
// so the stops that share one are all at the identical point — grouping is what
// keeps them from stacking into one invisible pile of teardrops.
describe("markerGroups", () => {
  // `precision` rides on the location, so this builds the same shape `at` does
  // rather than growing `at` a sixth positional argument every existing call
  // would have to skip past. The type comes from the contract — never a
  // hand-written copy of its union (AGENTS.md invariant 5).
  const atPrecision = (name: string, lat: number, lng: number, precision: Location["precision"]) => ({
    ...at(name, lat, lng),
    location: { name, lat, lng, city: "Rochester", precision },
  });

  const dayOf = (activities: Record<string, unknown>) =>
    mapDays(detailWith([{ dayId: "d1", date: null, activityIds: Object.keys(activities) }], activities))[0]!;

  it("collapses city-level stops that share a coordinate into one group, at the first member's place in stop order", () => {
    const day = dayOf({
      v: atPrecision("v", 43.15, -77.6, "venue"),
      c1: atPrecision("c1", 43.2, -77.5, "city"),
      c2: atPrecision("c2", 43.2, -77.5, "city"),
      c3: atPrecision("c3", 44.0, -76.0, "city"),
    });

    expect(markerGroups(day).map((g) => g.stops.map((s) => s.activityId))).toEqual([["v"], ["c1", "c2"], ["c3"]]);
    expect(markerGroups(day).map((g) => g.cityLevel)).toEqual([false, true, true]);
    // The group sits where its members do — one point, and the one MapLens
    // hands maplibre.
    expect(markerGroups(day)[1]).toMatchObject({ lat: 43.2, lng: -77.5 });
  });

  // The half that keeps the grouping honest: merging two stops that each claim
  // a venue would be this function inventing a claim neither made.
  it("keeps stops of any other precision 1:1, even on an identical coordinate", () => {
    const day = dayOf({
      v1: atPrecision("v1", 43.15, -77.6, "venue"),
      v2: atPrecision("v2", 43.15, -77.6, "venue"),
      a1: atPrecision("a1", 43.15, -77.6, "area"),
      // Absent precision means UNKNOWN, not `venue` — and it does not group.
      u1: at("u1", 43.15, -77.6),
    });

    expect(markerGroups(day).map((g) => g.stops.map((s) => s.activityId))).toEqual([["v1"], ["v2"], ["a1"], ["u1"]]);
    expect(markerGroups(day).every((g) => g.cityLevel === false)).toBe(true);
  });

  it("gives a lone city-level stop its own group, still marked city-level", () => {
    const day = dayOf({ c1: atPrecision("c1", 43.2, -77.5, "city") });
    expect(markerGroups(day)).toEqual([{ lat: 43.2, lng: -77.5, cityLevel: true, stops: day.stops }]);
  });

  it("does not group two city-level stops at different centroids", () => {
    const day = dayOf({
      c1: atPrecision("c1", 43.2, -77.5, "city"),
      c2: atPrecision("c2", 43.2, -77.51, "city"),
    });
    expect(markerGroups(day)).toHaveLength(2);
  });
});
