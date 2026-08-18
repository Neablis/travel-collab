import { describe, expect, it } from "vitest";
import { SPARKLINE_PALETTE, sparklineColorsFor } from "./sparklineColor";

describe("sparklineColorsFor", () => {
  // The whole reason this replaced a per-city hash: independent hashes
  // collided within a single trip (a real 14-day Japan trip drew Tokyo,
  // Hakone and Kyoto in one identical orange). Order assignment makes that
  // impossible up to the palette's size.
  it("gives every distinct city in a trip its own color, up to the palette's 8 slots", () => {
    const cities = ["Tokyo", "Nikkō", "Hakone", "Kyoto", "Osaka", "Naoshima", "Hiroshima", "Kanazawa"];
    const colors = sparklineColorsFor(cities);
    expect(new Set(colors.values()).size).toBe(8);
  });

  it("assigns slots in first-appearance order, not alphabetically or by name", () => {
    const colors = sparklineColorsFor(["Osaka", "Tokyo"]);
    expect(colors.get("Osaka")).toBe(SPARKLINE_PALETTE[0]);
    expect(colors.get("Tokyo")).toBe(SPARKLINE_PALETTE[1]);
  });

  // A return leg is the same city, so it keeps the color it was given the
  // first time rather than consuming a second slot.
  it("keeps one color for a city revisited later in the trip", () => {
    const colors = sparklineColorsFor(["Tokyo", "Kyoto", "Tokyo"]);
    expect(colors.size).toBe(2);
    expect(colors.get("Tokyo")).toBe(SPARKLINE_PALETTE[0]);
    expect(colors.get("Kyoto")).toBe(SPARKLINE_PALETTE[1]);
  });

  it("skips days with no known city rather than assigning them a slot", () => {
    const colors = sparklineColorsFor([null, "Tokyo", null]);
    expect(colors.size).toBe(1);
    expect(colors.get("Tokyo")).toBe(SPARKLINE_PALETTE[0]);
  });

  // Beyond 8 cities the palette has nothing left to give — wrapping is the
  // honest outcome, not an invented 9th hue that would fail the CVD floors
  // the palette was validated against.
  it("wraps to the start of the palette past its 8 slots", () => {
    const cities = Array.from({ length: 9 }, (_, i) => `City ${i}`);
    const colors = sparklineColorsFor(cities);
    expect(colors.get("City 8")).toBe(colors.get("City 0"));
  });

  it("only ever returns a hex from the validated 8-hue palette", () => {
    const VALID = new Set<string>(SPARKLINE_PALETTE);
    for (const color of sparklineColorsFor(["Tokyo", "Kyoto", "Osaka", "Nikkō"]).values()) {
      expect(VALID).toContain(color);
    }
  });
});
