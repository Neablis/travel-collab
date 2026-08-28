import { describe, expect, it } from "vitest";
import { shortPlace } from "./place";

describe("shortPlace", () => {
  // KI-35. Most-specific-first: area, then city, then the name's first
  // segment. `area` leading is the whole point of the field — a day inside
  // one city rendered "Tokyo → Tokyo → Tokyo" before it existed.
  it("prefers the structured area over the city", () => {
    expect(
      shortPlace({ name: "Gonpachi Nishiazabu, Nishi-Azabu, Tokyo, Japan", city: "Tokyo", area: "Nishi-Azabu" }),
    ).toBe("Nishi-Azabu");
  });

  it("falls back to the structured city when there is no area", () => {
    expect(shortPlace({ name: "Ugly Duck Coffee, Rochester, NY, USA", city: "Rochester" })).toBe("Rochester");
  });

  it("uses the area when there is no city at all — a venue name no longer stands in for a locality", () => {
    expect(shortPlace({ name: "Kiyomizu-dera, Higashiyama, Japan", area: "Higashiyama" })).toBe("Higashiyama");
  });

  it("falls back to the first segment of the full label when neither structured field is there", () => {
    expect(shortPlace({ name: "Ugly Duck Coffee, Rochester, NY, USA" })).toBe("Ugly Duck Coffee");
  });

  it("is null for no location", () => {
    expect(shortPlace(null)).toBeNull();
    expect(shortPlace(undefined)).toBeNull();
  });
});
