import { describe, expect, it } from "vitest";
import { SPARKLINE_PALETTE, sparklineColorFor } from "./sparklineColor";

describe("sparklineColorFor", () => {
  it("is deterministic per city", () => {
    expect(sparklineColorFor("Tokyo")).toEqual(sparklineColorFor("Tokyo"));
  });
  it("gives a stable fallback for empty/nullish city", () => {
    expect(sparklineColorFor(null)).toEqual(sparklineColorFor(undefined));
    expect(sparklineColorFor(null)).toEqual(sparklineColorFor(""));
  });
  it("spreads distinct cities across more than one color", () => {
    // Only 8 slots, so any single pair can legitimately collide — assert
    // spread across a handful of cities instead of one hardcoded pair.
    const cities = ["Tokyo", "Kyoto", "Osaka", "Nikkō", "Hakone", "Naoshima", "Rochester", "Rome"];
    const colors = new Set(cities.map((c) => sparklineColorFor(c)));
    expect(colors.size).toBeGreaterThan(1);
  });
  it("only ever returns a hex from the validated 8-hue palette", () => {
    const VALID = new Set(SPARKLINE_PALETTE);
    for (const city of ["Tokyo", "Kyoto", "Osaka", "Nikkō", "Hakone", "Naoshima", "", null, undefined]) {
      expect(VALID).toContain(sparklineColorFor(city));
    }
  });
});
