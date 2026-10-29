import { describe, expect, it } from "vitest";
import { countryAtPoint } from "./countryAt";

describe("countryAtPoint", () => {
  it.each([
    ["Deep Dive, Ithaca", "US", { lat: 42.443083, lng: -76.512429 }],
    ["Fushimi Inari, Kyoto", "JP", { lat: 34.9671, lng: 135.7727 }],
    // Territory level: Puerto Rico has its own ISO 3166-1 code.
    ["Old San Juan", "PR", { lat: 18.4655, lng: -66.1057 }],
  ])("%s is in %s", (_name, country, point) => {
    expect(countryAtPoint(point)).toBe(country);
  });

  // The bundled borders reach out over coastal waters, so this is far out.
  it("a point in international waters is in no country", () => {
    expect(countryAtPoint({ lat: 40, lng: -40 })).toBeNull();
  });
});
