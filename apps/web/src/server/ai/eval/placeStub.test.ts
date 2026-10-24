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

  // Models sentence-case a query, so a capital letter alone does not make a
  // name: "Tea house" answered with a place called "Tea house" is the same
  // "one place called coffee" that read as nothing found.
  it("answers a capitalised kind of place with invented names, never the query itself", () => {
    for (const query of ["Tea house", "Café", "Coffee"]) {
      const names = stubPlaceSearch({ queries: [query], region: box })[0]!.places.map((place) => place.name);
      expect(names).toHaveLength(PLACE_CANDIDATES_PER_QUERY);
      expect(new Set(names).size).toBe(names.length);
      expect(names.map((name) => name.toLowerCase())).not.toContain(query.toLowerCase());
    }
  });

  // Live run on 7d8e09f, 2026-10-24: "garden" came back as "Garden Park House"
  // and "Japanese Garden Room", and the model refused to swap in "vague, generic
  // names" it could not confirm were real gardens. A kind of place, known or
  // not, gets names shaped like a business, not the query with a suffix.
  it("answers a kind of place with business-like names, never the query plus a suffix", () => {
    for (const query of ["garden", "park", "shrine", "temple", "museum", "ramen", "sushi", "izakaya", "bar", "bakery", "tea", "market", "onsen"]) {
      const names = stubPlaceSearch({ queries: [query], region: box })[0]!.places.map((place) => place.name);
      expect(names, query).toHaveLength(PLACE_CANDIDATES_PER_QUERY);
      expect(new Set(names).size, query).toBe(names.length);
      for (const name of names) {
        expect(name, query).not.toMatch(/house|room|on the corner/i);
        expect(name.toLowerCase(), query).not.toBe(query);
        expect(name.toLowerCase(), query).not.toMatch(new RegExp(`^(the )?${query} `));
      }
    }
  });

  it("answers an accented café the way it answers coffee", () => {
    const namesOf = (query: string) => stubPlaceSearch({ queries: [query], region: box })[0]!.places.map((place) => place.name);
    expect(namesOf("café")).toEqual(namesOf("coffee"));
  });

  it("finds a place someone named under its own name first", () => {
    const [shrine] = stubPlaceSearch({ queries: ["Fushimi Inari Shrine"], region: box });
    expect(shrine!.places[0]!.name).toBe("Fushimi Inari Shrine");
  });

  // "near X" is where the model says to look, not part of what it looks for.
  it("builds names from the query without the near the model types", () => {
    const [ramen] = stubPlaceSearch({ queries: ["ramen near Shibuya Station"], region: box });
    for (const place of ramen!.places) {
      expect(place.name).toMatch(/ramen/i);
      expect(place.name).not.toMatch(/near|shibuya/i);
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
