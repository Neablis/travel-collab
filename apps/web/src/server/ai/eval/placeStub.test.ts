import { describe, expect, it } from "vitest";
import { PLACE_CANDIDATES_PER_QUERY } from "@/server/assistant/tools/places";
import { stubPlaceSearch } from "./placeStub";

const box = { minLat: 35.6, maxLat: 35.7, minLng: 139.6, maxLng: 139.8 };

describe("the eval's place stub", () => {
  // A stub that answered "coffee" with one place called "coffee" read as no
  // result, and the model searched again: d-coffee-near-now failed its
  // one-call check 3/3 on 2026-10-24. Production prints up to three real names.
  it("answers a search with several distinct places named like what was asked for", () => {
    const [coffee] = stubPlaceSearch({ queries: ["coffee"], region: box });
    const names = coffee!.places.map((place) => place.name);
    expect(names.length).toBeGreaterThanOrEqual(2);
    expect(names.length).toBeLessThanOrEqual(PLACE_CANDIDATES_PER_QUERY);
    expect(new Set(names).size).toBe(names.length);
    expect(names.map((name) => name.toLowerCase())).not.toContain("coffee");
    expect(names.every((name) => /coffee|café|cafe|espresso|roast/i.test(name))).toBe(true);
  });

  // The near-now search suffixes a city when its anchor has no coordinates;
  // a name built from that suffix would name a city the question may not be in.
  it("builds names from the query without the city the near-now search adds", () => {
    const [ramen] = stubPlaceSearch({ queries: ["ramen, Shibuya"], region: null });
    expect(ramen!.query).toBe("ramen, Shibuya");
    for (const place of ramen!.places) {
      expect(place.name).toMatch(/ramen/i);
      expect(place.name).not.toMatch(/shibuya/i);
    }
  });

  it("places every candidate inside the region, and apart from each other", () => {
    const [lookup] = stubPlaceSearch({ queries: ["coffee"], region: box });
    for (const place of lookup!.places) {
      expect(place.lat).toBeGreaterThan(box.minLat);
      expect(place.lat).toBeLessThan(box.maxLat);
      expect(place.lng).toBeGreaterThan(box.minLng);
      expect(place.lng).toBeLessThan(box.maxLng);
    }
    expect(new Set(lookup!.places.map((place) => `${place.lat},${place.lng}`)).size).toBe(lookup!.places.length);
  });

  it("answers the same query the same way every time", () => {
    expect(stubPlaceSearch({ queries: ["coffee", "ramen"], region: box })).toEqual(stubPlaceSearch({ queries: ["coffee", "ramen"], region: box }));
  });
});
