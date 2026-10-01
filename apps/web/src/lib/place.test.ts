import { describe, expect, it } from "vitest";
import type { ActivityView } from "@tc/contracts";
import { activityFactory, locationFactory } from "@tc/factories";
import { displayPlace, legEnd, legRoute, shortPlace } from "./place";

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

describe("legRoute", () => {
  // Stations with the ward the geocoder puts each in, so a label that led with
  // `area` would read the wards instead of the cities.
  const taipei = locationFactory.build({ name: "Taipei Main Station, Zhongzheng, Taipei, Taiwan", city: "Taipei", area: "Zhongzheng" });
  const tainan = locationFactory.build({ name: "THSR Tainan Station, Guiren, Tainan, Taiwan", city: "Tainan", area: "Guiren" });
  const leg = (overrides: Partial<ActivityView>) =>
    activityFactory.build({ kind: "transit", mode: "train", location: taipei, endLocation: tainan, ...overrides });

  it("names each end by its city", () => {
    expect(legRoute(leg({}))).toBe("Taipei → Tainan");
  });

  it("falls back to the areas when both ends are one city", () => {
    const asakusa = locationFactory.build({ name: "Tobu Asakusa Station, Asakusa, Tokyo, Japan", city: "Tokyo", area: "Asakusa" });
    const shibuya = locationFactory.build({ name: "Shibuya Station, Shibuya, Tokyo, Japan", city: "Tokyo", area: "Shibuya" });
    expect(legRoute(leg({ location: asakusa, endLocation: shibuya }))).toBe("Asakusa → Shibuya");
  });

  it("falls back to the venue names when city and area both agree", () => {
    const north = locationFactory.build({ name: "Kyoto Station, Shimogyō, Kyoto, Japan", city: "Kyoto", area: "Shimogyō" });
    const south = locationFactory.build({ name: "Tōji, Shimogyō, Kyoto, Japan", city: "Kyoto", area: "Shimogyō" });
    expect(legRoute(leg({ location: north, endLocation: south }))).toBe("Kyoto Station → Tōji");
  });

  it("takes shortPlace's chain for an end with no city", () => {
    // The factory's base place carries a city, so a manual one clears it.
    const manual = locationFactory.build({ name: "Grandma's house, somewhere", city: undefined, area: undefined });
    expect(legRoute(leg({ endLocation: manual }))).toBe("Taipei → Grandma's house");
  });

  it("keeps the destination when the stop has no origin", () => {
    expect(legRoute(leg({ location: null }))).toBe("→ Tainan");
  });

  it("is null for a transit stop with no destination", () => {
    expect(legRoute(leg({ endLocation: null }))).toBeNull();
  });

  // Stored rows are never refined, so the kind is checked rather than trusted.
  it("is null for a non-transit stop even when it carries an endLocation", () => {
    expect(legRoute(leg({ kind: "planned" }))).toBeNull();
    expect(legEnd(leg({ kind: "pending" }))).toBeNull();
  });
});
