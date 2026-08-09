import { describe, expect, it } from "vitest";
import { dayAccentFor, ACCENT_FAMILIES } from "./dayAccent";

describe("dayAccentFor", () => {
  it("is deterministic per city", () => {
    expect(dayAccentFor("Tokyo")).toEqual(dayAccentFor("Tokyo"));
  });
  it("only ever returns on-system families", () => {
    for (const city of ["Tokyo", "Osaka", "Kyoto", "", null, undefined]) {
      expect(ACCENT_FAMILIES).toContain(dayAccentFor(city).tint);
    }
  });
  it("spreads distinct cities across families", () => {
    const a = dayAccentFor("Tokyo").tint;
    const b = dayAccentFor("Toyosu-is-different").tint;
    // not a hard guarantee for all pairs, but these two must differ
    expect(a).not.toEqual(b);
  });
  it("gives a stable fallback for empty city", () => {
    expect(dayAccentFor(null)).toEqual(dayAccentFor(undefined));
  });
});
