import { describe, expect, it } from "vitest";
import { displayPlace, shortPlace } from "./place";

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

describe("displayPlace", () => {
  const geocoded = {
    name: "National Museum of Play at The Strong, Rochester, Monroe County, New York, 14607, USA",
    city: "Rochester",
    countryCode: "US",
    area: "Upper Monroe",
  };

  it("keeps venue, city and country and drops the county, state and postcode", () => {
    expect(displayPlace(geocoded)).toBe("National Museum of Play at The Strong, Rochester, United States");
  });

  // The distinction from shortPlace(), which answers "whereabouts in the trip"
  // with a single token and prefers `area` over everything.
  it("is not shortPlace: it names the place, not the neighbourhood", () => {
    expect(shortPlace(geocoded)).toBe("Upper Monroe");
  });

  it("renders the country name, not its code", () => {
    expect(displayPlace({ name: "Kinkaku-ji, Kyoto, Japan", city: "Kyoto", countryCode: "JP" })).toBe(
      "Kinkaku-ji, Kyoto, Japan",
    );
  });

  it("does not repeat the venue when the place IS its city", () => {
    expect(displayPlace({ name: "Kyoto, Japan", city: "Kyoto", countryCode: "JP" })).toBe("Kyoto, Japan");
  });

  it("falls back through the parts a manually-entered location lacks", () => {
    expect(displayPlace({ name: "Grandma's house" })).toBe("Grandma's house");
    expect(displayPlace({ name: "Grandma's house", countryCode: "US" })).toBe("Grandma's house, United States");
  });

  it("is null only for no location", () => {
    expect(displayPlace(null)).toBeNull();
    expect(displayPlace(undefined)).toBeNull();
  });
});
