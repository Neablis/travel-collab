import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { witness } from "@/test-support/witness";
import { pointText, roundForExport } from "./roundedPoint";

// ADR-052 decision 6: nothing finer than two decimals leaves the building. A
// claim about EVERY coordinate, so a property — and the printed form is what
// actually goes on the wire, so that is what is checked.

describe("roundForExport", () => {
  it("never yields more than two decimals, within a hundredth of the input, on the one meridian", () => {
    const w = witness("roundForExport");
    fc.assert(
      fc.property(
        fc.double({ min: -90, max: 90, noNaN: true }),
        fc.double({ min: -180, max: 180, noNaN: true }),
        (lat, lng) => {
          const point = roundForExport(lat, lng);
          const text = pointText(point);
          w.tick();
          expect(String(point.lat)).toMatch(/^-?\d+(\.\d{1,2})?$/);
          expect(String(point.lng)).toMatch(/^-?\d+(\.\d{1,2})?$/);
          expect(Number(text.lat)).toBe(point.lat);
          expect(Number(text.lng)).toBe(point.lng);
          expect(Math.abs(point.lat - lat)).toBeLessThanOrEqual(0.005 + 1e-9);
          // Across the antimeridian the nearest point is on the other side.
          const dLng = Math.abs(point.lng - lng);
          expect(Math.min(dLng, 360 - dLng)).toBeLessThanOrEqual(0.005 + 1e-9);
          expect(point.lng).toBeGreaterThanOrEqual(-180);
          expect(point.lng).toBeLessThan(180);
        },
      ),
      { numRuns: 1000 },
    );
    // No guard clause: every case asserts.
    w.atLeast(1000);
  });

  it("puts a hotel and the museum next door on one point, and not a building's", () => {
    expect(roundForExport(35.01163, 135.76802)).toEqual(roundForExport(35.00841, 135.77149));
    expect(pointText(roundForExport(59.9139, 10.7522))).toEqual({ lat: "59.91", lng: "10.75" });
    expect(pointText(roundForExport(-0.001, 179.999))).toEqual({ lat: "0.00", lng: "-180.00" });
  });
});
