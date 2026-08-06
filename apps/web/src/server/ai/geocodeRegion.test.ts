import { describe, expect, it } from "vitest";
import {
  boundingBoxAround,
  distanceKm,
  plausibleCoords,
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
