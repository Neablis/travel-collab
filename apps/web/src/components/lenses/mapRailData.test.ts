import { describe, expect, it } from "vitest";
import { ActivityMode, type ActivityKind, type Location, type TripDetail } from "@tc/contracts";
import { dayHighlights, legVariant, mapArrivalDay, mapDays, markerGroups, monthEdges, routeLegs } from "./mapRailData";
import { activityFactory, locationFactory } from "@tc/factories";
import { haversineKm } from "@/lib/geo";

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

// A transit stop that knows both ends (M24's `endLocation`), and a one-day trip
// built from activities in key order.
const leg = (name: string, lat: number, lng: number, end: [number, number] | null, mode: ActivityMode | null) => ({
  ...at(name, lat, lng, "transit"),
  mode,
  endLocation: end === null ? null : { name: `${name} end`, lat: end[0], lng: end[1] },
});
const dayOf = (activities: Record<string, unknown>) =>
  mapDays(detailWith([{ dayId: "d1", date: null, activityIds: Object.keys(activities) }], activities))[0]!;

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

// M24 link 3: a transit stop that knows both ends draws the leg it IS, instead
// of the map guessing one from its neighbours.
describe("routeLegs — a transit stop with a destination", () => {
  it("draws origin → destination as one leg in its mode's style, and the hops either side of it as ordinary legs", () => {
    const day = dayOf({
      a: at("a", 43.10, -77.60),
      t: leg("t", 43.20, -77.70, [44.00, -76.00], "train"),
      b: at("b", 44.10, -76.10),
    });
    // The route runs a → origin, origin → destination, destination → b: it
    // stays continuous, and nothing is drawn from origin straight to b.
    expect(routeLegs(day)).toEqual({
      rest: [
        [[-77.60, 43.10], [-77.70, 43.20]],
        [[-76.00, 44.00], [-76.10, 44.10]],
      ],
      travel: [[[-77.70, 43.20], [-76.00, 44.00]]],
    });
  });

  it("draws a real leg even when the transit stop is the day's only stop", () => {
    const day = dayOf({ t: leg("t", 43.20, -77.70, [44.00, -76.00], "walk") });
    expect(routeLegs(day)).toEqual({ rest: [[[-77.70, 43.20], [-76.00, 44.00]]], travel: [] });
  });

  // Found walking the Japan fixture's day 4 (Asakusa → Nikkō and back): two
  // dashed lines on one path, dashed from opposite ends, fill each other's gaps
  // and read as the solid "on foot" line.
  it("draws a leg that retraces an earlier one in the same style only once", () => {
    const day = dayOf({
      out: leg("out", 43.20, -77.70, [44.00, -76.00], "train"),
      x: at("x", 44.10, -76.10),
      back: leg("back", 44.00, -76.00, [43.20, -77.70], "train"),
    });
    expect(routeLegs(day).travel).toEqual([[[-77.70, 43.20], [-76.00, 44.00]]]);
  });

  // The contract refuses this on a command; a stored row is never refused, so
  // the map must not draw a leg for a stop that is not travel.
  it("draws no leg for a destination left on a stop that is not transit", () => {
    const day = dayOf({ p: { ...leg("p", 43.20, -77.70, [44.00, -76.00], "train"), kind: "planned" } });
    expect(routeLegs(day)).toEqual({ rest: [], travel: [] });
  });

  // Most transit stops have no destination, and for them nothing moves — not
  // even when they carry a mode, because a mode with no second place has no
  // line of its own to style.
  it("leaves a transit stop with no destination on the adjacency rule, whatever its mode", () => {
    const day = dayOf({
      a: at("a", 43.10, -77.60),
      t: leg("t", 43.20, -77.70, null, "walk"),
      b: at("b", 43.30, -77.80),
    });
    expect(routeLegs(day)).toEqual({
      rest: [],
      travel: [
        [[-77.60, 43.10], [-77.70, 43.20]],
        [[-77.70, 43.20], [-77.80, 43.30]],
      ],
    });
  });
});

// The rail's numbers describe the route the map DRAWS. They used to pair
// consecutive stops' origins, so a day whose one stop was a real leg drew a
// ~290 km line beside "A single anchor. Nothing to travel between.", and the
// hop after a leg was measured from where the train left, not where it arrived.
describe("mapDays distances — the same route routeLegs draws", () => {
  const ODAWARA = { lat: 35.256, lng: 139.155 };
  const KYOTO = { lat: 34.985, lng: 135.758 };

  it("measures a day whose only stop is a leg as that leg", () => {
    const day = dayOf({
      s: leg("Shinkansen Odawara → Kyoto", ODAWARA.lat, ODAWARA.lng, [KYOTO.lat, KYOTO.lng], "train"),
    });
    const km = haversineKm(ODAWARA, KYOTO);
    expect(km).toBeGreaterThan(250);
    expect(day.totalKm).toBeCloseTo(km, 6);
    expect(day.bars).toEqual([{ grow: 1, color: day.accent }]);
  });

  it("measures the hop after a leg from its destination, not its origin", () => {
    const P = { lat: 35.25, lng: 139.15 };
    const N = { lat: 34.99, lng: 135.76 };
    // Three hops, not two: origin-pairing measured P → A → N, which drops the
    // leg and measures the last hop from Odawara. N sits beside Kyoto, so the
    // last hop is short beside the train.
    const day = dayOf({
      p: at("Hotel", P.lat, P.lng),
      t: leg("Shinkansen Odawara → Kyoto", ODAWARA.lat, ODAWARA.lng, [KYOTO.lat, KYOTO.lng], "train"),
      n: at("Temple", N.lat, N.lng),
    });
    const hops = [haversineKm(P, ODAWARA), haversineKm(ODAWARA, KYOTO), haversineKm(KYOTO, N)];
    const total = hops.reduce((sum, km) => sum + km, 0);
    expect(day.totalKm).toBeCloseTo(total, 6);
    expect(day.bars.map((b) => b.grow)).toEqual(hops.map((km) => km / total));
  });

  // Regression pin: a day with no destination-bearing stop — including a
  // transit stop without one, and a non-transit stop carrying a stray
  // endLocation the map ignores — is measured exactly as before, consecutive
  // pair by consecutive pair, to the bit.
  it("leaves a day with no real leg exactly as consecutive stop pairs", () => {
    const pts = [
      { lat: 43.10, lng: -77.60 },
      { lat: 43.20, lng: -77.70 },
      { lat: 43.25, lng: -77.90 },
      { lat: 43.26, lng: -77.91 },
    ];
    const day = dayOf({
      a: at("a", pts[0]!.lat, pts[0]!.lng),
      t: leg("t", pts[1]!.lat, pts[1]!.lng, null, "train"),
      p: { ...leg("p", pts[2]!.lat, pts[2]!.lng, [44.0, -76.0], "train"), kind: "planned" },
      b: at("b", pts[3]!.lat, pts[3]!.lng),
    });
    const kms = [haversineKm(pts[0]!, pts[1]!), haversineKm(pts[1]!, pts[2]!), haversineKm(pts[2]!, pts[3]!)];
    const total = kms.reduce((sum, km) => sum + km, 0);
    expect(day.totalKm).toBe(total);
    expect(day.bars).toEqual(kms.map((km) => ({ grow: km / total, color: day.accent })));
  });
});

// Mitchell, 2026-09-30 (option "B"): a leg's destination is named on the
// cards, not left to the line on the map.
describe("mapDays legs", () => {
  const odawara = locationFactory.build({ name: "Odawara Station, Odawara, Japan", city: "Odawara", area: "Odawara" });
  const kyoto = locationFactory.build({ name: "Kyoto Station, Shimogyō, Kyoto, Japan", city: "Kyoto", area: "Shimogyō" });

  it("labels each leg with a destination by its mode and both ends, in day order", () => {
    const day = dayOf({
      museum: activityFactory.build({ activityId: "museum", kind: "planned", location: kyoto }),
      out: activityFactory.build({ activityId: "out", kind: "transit", mode: "train", location: odawara, endLocation: kyoto }),
      // Unlocated at the origin: the label needs no coordinate, so it still counts.
      back: activityFactory.build({ activityId: "back", kind: "transit", mode: null, location: null, endLocation: odawara }),
      noEnd: activityFactory.build({ activityId: "noEnd", kind: "transit", mode: "bus", location: kyoto, endLocation: null }),
      stray: activityFactory.build({ activityId: "stray", kind: "planned", location: kyoto, endLocation: odawara }),
    });
    expect(day.legs).toEqual(["Train · Odawara → Kyoto", "Travel · → Odawara"]);
  });
});

describe("legVariant", () => {
  // Every value of the contract's enum, so a mode added there without a
  // decision here fails this as well as the compile.
  it("draws walk and bike solid, and every other mode dashed", () => {
    const byVariant = Object.fromEntries(ActivityMode.options.map((mode) => [mode, legVariant(mode)]));
    expect(byVariant).toEqual({
      walk: "rest", bike: "rest",
      bus: "travel", train: "travel", flight: "travel", ferry: "travel", car: "travel",
    });
  });

  it("draws a leg of unknown mode dashed — it is travel, by means nobody said", () => {
    expect(legVariant(null)).toBe("travel");
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

// M26 link 5b. The bar row is a picture of the day's TRAVEL, and travel happens
// between stops — so N located stops make N-1 bars. It used to make N, giving
// the first stop a bar with no leg under it: a phantom taking `1/stops.length`
// of the width, worst on a two-stop day where one real leg was drawn as two.
describe("mapDays bars — one per leg, never per stop", () => {
  it("draws one bar per leg, not one per stop", () => {
    const d = detailWith([{ dayId: "d1", date: null, activityIds: ["a", "b", "c"] }], {
      a: at("a", 43.15, -77.6), b: at("b", 43.16, -77.62), c: at("c", 43.17, -77.64),
    });
    const [day] = mapDays(d);
    expect(day!.stops).toHaveLength(3);
    expect(day!.bars).toHaveLength(2);
  });

  it("draws ONE bar for a two-stop day — the phantom first bar is gone", () => {
    const d = detailWith([{ dayId: "d1", date: null, activityIds: ["a", "b"] }], {
      a: at("a", 43.15, -77.6), b: at("b", 43.2, -77.7),
    });
    expect(mapDays(d)[0]!.bars).toHaveLength(1);
  });

  it("draws nothing for a single located stop — nothing was travelled", () => {
    const d = detailWith([{ dayId: "d1", date: null, activityIds: ["a"] }], { a: at("a", 43.15, -77.6) });
    expect(mapDays(d)[0]!.bars).toEqual([]);
  });

  it("shares the width by distance, so the bars sum to the whole row", () => {
    const d = detailWith([{ dayId: "d1", date: null, activityIds: ["a", "b", "c"] }], {
      // A long first leg and a short second one, so an even split would be
      // visibly wrong rather than coincidentally right.
      a: at("a", 43.0, -77.6), b: at("b", 44.0, -77.6), c: at("c", 44.02, -77.6),
    });
    const bars = mapDays(d)[0]!.bars;
    expect(bars).toHaveLength(2);
    expect(bars[0]!.grow).toBeGreaterThan(bars[1]!.grow);
    expect(bars.reduce((sum, b) => sum + b.grow, 0)).toBeCloseTo(1, 5);
  });
});

// M26 link 5b. "Sep" repeated down every row of a September trip is noise; the
// month informs only where it changes.
describe("monthEdges", () => {
  it("prints the month on the first dated row and at each boundary", () => {
    expect(
      monthEdges([
        { date: "2026-09-29" },
        { date: "2026-09-30" },
        { date: "2026-10-01" },
        { date: "2026-10-02" },
      ]),
    ).toEqual([true, false, true, false]);
  });

  it("treats a new YEAR's January as a boundary, not a repeat of last January", () => {
    expect(monthEdges([{ date: "2026-01-31" }, { date: "2027-01-01" }])).toEqual([true, true]);
  });

  // An undated day is not a boundary, and must not break the run: the next
  // dated row still compares against the last month actually seen.
  it("skips undated rows without resetting the run", () => {
    expect(
      monthEdges([{ date: "2026-09-29" }, { date: null }, { date: "2026-09-30" }]),
    ).toEqual([true, false, false]);
  });

  it("is empty for no days at all", () => {
    expect(monthEdges([])).toEqual([]);
  });
});

// Mitchell, desktop Map: "When we go to the map page and a day isn't
// selected, select the first day to start there." The rail he clicked had day
// 15 ringed — set by scrolling Plan's columns to their end, not by a pick —
// and a day nobody chose is not a selected day. So the map starts on day 1
// unless somebody PICKED one, and a pick always wins.
describe("mapArrivalDay", () => {
  it("starts on the first day when nothing is selected", () => {
    expect(mapArrivalDay(null, "explicit", 15)).toBe(0);
  });

  it("starts on the first day when the day was only scrolled past", () => {
    expect(mapArrivalDay(14, "scroll", 15)).toBe(0);
  });

  it("keeps a day somebody picked", () => {
    expect(mapArrivalDay(4, "explicit", 15)).toBeNull();
  });

  it("starts on the first day when the selection names no day the map has", () => {
    // A suggested day the trip does not hold yet is picked as `days.length + k`.
    expect(mapArrivalDay(15, "explicit", 15)).toBe(0);
  });

  it("has nothing to select on a trip with no days", () => {
    expect(mapArrivalDay(null, "explicit", 0)).toBeNull();
  });
});

// Mitchell, desktop Map, of the hover card's "Longest hop" note: "Is there
// something better we can put in the hover information? Show something truly
// unique about that day, or something else that we won't need AI to pull off."
// So the note says what sets the day apart from the trip's other days, read
// straight off the plan: the places only it visits, else a trip-wide record it
// holds outright, else where it starts and ends.
describe("dayHighlights", () => {
  type Stop = { title: string; area?: string; city?: string; start?: string; end?: string; kind?: ActivityKind };
  const trip = (...days: Stop[][]) => {
    const activities: Record<string, unknown> = {};
    const dayRows = days.map((stops, d) => ({
      dayId: `d${d}`,
      date: null,
      activityIds: stops.map((s, i) => {
        const id = `d${d}s${i}`;
        activities[id] = {
          activityId: id, title: s.title, notes: null, anchors: [], cost: null, kind: s.kind ?? "planned",
          timeWindow: s.start && s.end ? { start: s.start, end: s.end } : null,
          location: s.area || s.city ? { name: s.title, lat: 35, lng: 135, area: s.area, city: s.city } : null,
        };
        return id;
      }),
    }));
    return dayHighlights(detailWith(dayRows, activities));
  };

  it("names the places only this day goes to", () => {
    const [first, second] = trip(
      [{ title: "Fushimi Inari", area: "Fushimi" }, { title: "Nishiki", area: "Nakagyō" }],
      [{ title: "Kinkaku-ji", area: "Kita" }, { title: "Pontocho", area: "Nakagyō" }],
    );
    // Nakagyō is on both days, so it sets neither apart.
    expect(first).toEqual({ kind: "only-here", places: ["Fushimi"] });
    expect(second).toEqual({ kind: "only-here", places: ["Kita"] });
  });

  it("falls back to the city when a stop has no neighbourhood", () => {
    const [first] = trip([{ title: "Art House", city: "Naoshima" }], [{ title: "Shibuya Sky", city: "Tokyo" }]);
    expect(first).toEqual({ kind: "only-here", places: ["Naoshima"] });
  });

  it("does not count where a train leaves from as a place the day visits", () => {
    const [first] = trip(
      [{ title: "Shinkansen", area: "Shinagawa", kind: "transit" }, { title: "Temple", area: "Kita" }],
      [{ title: "Lunch", area: "Kita" }],
    );
    expect(first).not.toEqual(expect.objectContaining({ places: expect.arrayContaining(["Shinagawa"]) }));
  });

  it("names the day with outright the most stops when no place sets it apart", () => {
    const [busy, quiet] = trip(
      [{ title: "A", area: "X" }, { title: "B", area: "X" }, { title: "C", area: "X" }],
      [{ title: "D", area: "X" }, { title: "E", area: "X" }],
    );
    expect(busy).toEqual({ kind: "most-stops", stops: 3 });
    expect(quiet).not.toEqual(expect.objectContaining({ kind: "most-stops" }));
  });

  it("names the trip's earliest start and its latest finish", () => {
    const [early, late] = trip(
      [{ title: "Market", area: "X", start: "06:30", end: "08:00" }, { title: "Lunch", area: "X", start: "12:00", end: "13:00" }],
      [{ title: "Show", area: "X", start: "19:00", end: "22:30" }, { title: "Lunch", area: "X", start: "12:00", end: "13:00" }],
    );
    expect(early).toEqual({ kind: "earliest", time: "06:30" });
    expect(late).toEqual({ kind: "latest", time: "22:30" });
  });

  it("holds no record it shares with another day", () => {
    const days = trip(
      [{ title: "A", area: "X", start: "09:00", end: "10:00" }, { title: "B", area: "X" }],
      [{ title: "C", area: "X", start: "09:00", end: "10:00" }, { title: "D", area: "X" }],
    );
    expect(days[0]).toEqual({ kind: "bookends", first: "A", last: "B" });
    expect(days[1]).toEqual({ kind: "bookends", first: "C", last: "D" });
  });

  it("names a one-stop day's stop, and has nothing for an empty day", () => {
    const [one, none] = trip([{ title: "Onsen", area: "X" }], [], [{ title: "Ryokan", area: "X" }, { title: "Bath", area: "X" }]);
    expect(one).toEqual({ kind: "single", title: "Onsen" });
    expect(none).toBeNull();
  });

  it("says nothing about uniqueness on a one-day trip, where every place is the trip's only", () => {
    const [only] = trip([{ title: "A", area: "X" }, { title: "B", area: "Y" }]);
    expect(only).toEqual({ kind: "bookends", first: "A", last: "B" });
  });
});
