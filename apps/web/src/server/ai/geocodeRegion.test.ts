import { describe, expect, it } from "vitest";
import { scenarios, tripDetailFactory } from "@tc/factories";
import {
  boundingBoxAround,
  distanceKm,
  plausibleCoords,
  tripRegionOf,
  TRIP_REGION_MARGIN_KM,
  withinBox,
} from "./geocodeRegion";

describe("plausibleCoords", () => {
  it("accepts a real coordinate pair", () => {
    expect(plausibleCoords({ lat: 43.0866, lng: -79.0628 })).toEqual({ lat: 43.0866, lng: -79.0628 });
  });

  // The model's observed failure mode when it does not know a coordinate
  // (KI-15's predecessor run: lat 0, lng 0). Null Island is not a destination.
  it("rejects null island and its immediate neighborhood", () => {
    expect(plausibleCoords({ lat: 0, lng: 0 })).toBeNull();
    expect(plausibleCoords({ lat: 0.2, lng: -0.3 })).toBeNull();
  });

  it("rejects a partial or absent pair", () => {
    expect(plausibleCoords({ lat: 43.1 })).toBeNull();
    expect(plausibleCoords({ lng: -79.1 })).toBeNull();
    expect(plausibleCoords({})).toBeNull();
  });

  it("rejects non-finite values", () => {
    expect(plausibleCoords({ lat: Number.NaN, lng: 12 })).toBeNull();
    expect(plausibleCoords({ lat: 12, lng: Number.POSITIVE_INFINITY })).toBeNull();
  });
});

describe("distanceKm", () => {
  it("is zero for the same point", () => {
    expect(distanceKm({ lat: 43.09, lng: -79.06 }, { lat: 43.09, lng: -79.06 })).toBe(0);
  });

  // The exact KI-15 failure: Niagara Falls NY vs. the Shropshire coaching inn.
  it("measures the Niagara-to-Shropshire mismatch in thousands of km", () => {
    const km = distanceKm({ lat: 43.0866, lng: -79.0628 }, { lat: 52.907918, lng: -2.8901 });
    expect(km).toBeGreaterThan(5000);
    expect(km).toBeLessThan(6000);
  });

  it("measures a same-metro refinement in tens of km", () => {
    const km = distanceKm({ lat: 43.0866, lng: -79.0628 }, { lat: 43.1566, lng: -77.6088 });
    expect(km).toBeGreaterThan(100);
    expect(km).toBeLessThan(130);
  });
});

describe("boundingBoxAround", () => {
  it("returns null with no points", () => {
    expect(boundingBoxAround([], 100)).toBeNull();
  });

  it("pads a single point by the margin", () => {
    const box = boundingBoxAround([{ lat: 43, lng: -79 }], 111)!;
    expect(box.minLat).toBeCloseTo(42, 1);
    expect(box.maxLat).toBeCloseTo(44, 1);
    // Longitude degrees shrink with latitude, so the lng margin is wider.
    expect(box.maxLng - box.minLng).toBeGreaterThan(box.maxLat - box.minLat);
  });

  it("spans every point plus the margin", () => {
    const box = boundingBoxAround(
      [
        { lat: 43.09, lng: -79.06 },
        { lat: 43.16, lng: -77.61 },
      ],
      50,
    )!;
    expect(box.minLat).toBeLessThan(43.09);
    expect(box.maxLat).toBeGreaterThan(43.16);
    expect(box.minLng).toBeLessThan(-79.06);
    expect(box.maxLng).toBeGreaterThan(-77.61);
  });

  it("clamps to the poles", () => {
    const box = boundingBoxAround([{ lat: 89.9, lng: 0 }], 500)!;
    expect(box.maxLat).toBe(90);
  });
});

describe("withinBox", () => {
  const box = { minLat: 42, maxLat: 44, minLng: -80, maxLng: -77 };

  it("accepts an interior point", () => {
    expect(withinBox(box, { lat: 43.09, lng: -79.06 })).toBe(true);
  });

  it("rejects an exterior point", () => {
    expect(withinBox(box, { lat: 52.9, lng: -2.89 })).toBe(false);
  });
});

// Behavioural cover for what used to be checked by a regex over the source text
// of the command endpoint and `geocodeEnrichment.ts` (writeTools.test.ts, now
// deleted).
//
// **Scope, stated narrowly on purpose.** What follows covers `tripRegionOf` and
// the geometry helpers and NOTHING ELSE. An earlier version of this comment
// claimed the KI-15 parity — "an approved batch is enriched on exactly the
// command path's terms" — was held here for `commitProposal` and
// `geocodeEnrichment`'s fallback. It is not: neither caller is exercised in
// this file, so both could stop using `tripRegionOf` or re-declare
// `TRIP_REGION_MARGIN_KM` with every test below still green. Flagged in review
// on PR #110, and this repo's own rule (KI-1, KI-14) is that a comment
// asserting an invariant either has a test enforcing it or is a lie with a
// timer on it.
//
// Where the callers ARE covered: `geocodeEnrichment.test.ts` for the
// enrichment behaviour, and the `/ask` route's integration suite for the
// approval path that reaches `commitProposal`. The command path this parity
// was originally written against retired with ADR-033 Decision 4.
describe("tripRegionOf", () => {
  it("is null for a trip with no locations at all", () => {
    expect(tripRegionOf(scenarios.emptyTrip())).toBeNull();
    const unplaced = tripDetailFactory.build({}, { transient: { dayCount: 2, activitiesPerDay: 2 } });
    expect(tripRegionOf(unplaced)).toBeNull();
  });

  it("is null for a trip with named locations that carry no coordinates", () => {
    const named = tripDetailFactory.build({}, { transient: { dayCount: 2, activitiesPerDay: 2, located: "named" } });
    expect(tripRegionOf(named)).toBeNull();
  });

  it("pads the box around the trip's geocoded activities by the shared margin", () => {
    const trip = tripDetailFactory.build(
      {},
      { transient: { dayCount: 1, activitiesPerDay: 1, located: true } },
    );
    const only = Object.values(trip.activities)[0]!.location!;
    const region = tripRegionOf(trip)!;
    expect(region).not.toBeNull();
    // One point, so the box is that point padded — which pins the margin this
    // function applies without restating the number.
    expect(region).toEqual(boundingBoxAround([{ lat: only.lat!, lng: only.lng! }], TRIP_REGION_MARGIN_KM));
    expect(withinBox(region, { lat: only.lat!, lng: only.lng! })).toBe(true);
  });
});
