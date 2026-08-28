import { afterEach, describe, expect, it, vi } from "vitest";
import { createLocationIQGeocoder } from "./locationiq";

afterEach(() => vi.unstubAllGlobals());

describe("LocationIQ geocoder adapter", () => {
  it("builds the request and normalizes the response", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request) =>
      new Response(
        JSON.stringify([
          { lat: "41.8902", lon: "12.4922", display_name: "Colosseum, Rome, Italy", address: { country_code: "it" } },
        ]),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const results = await createLocationIQGeocoder("KEY123").forward("Colosseum", { limit: 3 });
    expect(results).toEqual([
      { lat: 41.8902, lng: 12.4922, canonicalName: "Colosseum, Rome, Italy", countryCode: "IT" },
    ]);
    const url = new URL(fetchMock.mock.calls[0]![0] as string);
    expect(url.searchParams.get("key")).toBe("KEY123");
    expect(url.searchParams.get("q")).toBe("Colosseum");
    expect(url.searchParams.get("limit")).toBe("3");
    // Romanised, and fixed rather than per-reader: the name this returns is
    // persisted and then shown to everyone the trip is shared with.
    expect(url.searchParams.get("accept-language")).toBe("en");
  });

  it("extracts city from the address breakdown, falling back through town/village/hamlet", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request) =>
      new Response(
        JSON.stringify([
          {
            lat: "43.1566",
            lon: "-77.6088",
            display_name: "National Museum of Play at The Strong, Rochester, Monroe County, New York, 14607, USA",
            address: { country_code: "us", city: "Rochester" },
          },
          {
            lat: "43.0896",
            lon: "-79.0849",
            display_name: "Niagara Falls, City of Niagara Falls, Niagara County, New York, 14301, USA",
            address: { country_code: "us", town: "Niagara Falls" }, // no `city` key — Nominatim uses `town` for this settlement size
          },
          {
            lat: "1",
            lon: "1",
            display_name: "somewhere with no city-level address component",
            address: { country_code: "us" },
          },
        ]),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const results = await createLocationIQGeocoder("KEY123").forward("Rochester");
    expect(results[0]!.city).toBe("Rochester");
    expect(results[1]!.city).toBe("Niagara Falls");
    expect(results[2]!.city).toBeUndefined();
  });

  // KI-35. `area` is the sub-settlement half of the same address breakdown
  // `city` is read from, and has its own most-to-least-specific fallback
  // chain. It must never collapse into `city`: the two answer different
  // questions and both are read off the same row.
  it("extracts area from the sub-settlement fields, falling back through suburb/neighbourhood/quarter/city_district", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request) =>
      new Response(
        JSON.stringify([
          {
            lat: "35.6564",
            lon: "139.7238",
            display_name: "Gonpachi Nishiazabu, Nishi-Azabu, Minato, Tokyo, Japan",
            address: { country_code: "jp", city: "Tokyo", suburb: "Nishi-Azabu" },
          },
          {
            lat: "43.1566",
            lon: "-77.6088",
            display_name: "Ugly Duck Coffee, Rochester, Monroe County, New York, USA",
            address: { country_code: "us", city: "Rochester", neighbourhood: "South Wedge" }, // no `suburb` key
          },
          {
            lat: "48.8606",
            lon: "2.3376",
            display_name: "Musée du Louvre, Paris, France",
            address: { country_code: "fr", city: "Paris", quarter: "Quartier Saint-Germain-l’Auxerrois" },
          },
          {
            lat: "52.5163",
            lon: "13.3777",
            display_name: "Brandenburger Tor, Berlin, Germany",
            address: { country_code: "de", city: "Berlin", city_district: "Mitte" },
          },
          {
            lat: "1",
            lon: "1",
            display_name: "somewhere with no sub-settlement address component",
            address: { country_code: "us", city: "Rochester" },
          },
        ]),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const results = await createLocationIQGeocoder("KEY123").forward("anything");
    expect(results.map((r) => r.area)).toEqual([
      "Nishi-Azabu",
      "South Wedge",
      "Quartier Saint-Germain-l’Auxerrois",
      "Mitte",
      undefined,
    ]);
    // The settlement read is untouched by any of this.
    expect(results.map((r) => r.city)).toEqual(["Tokyo", "Rochester", "Paris", "Berlin", "Rochester"]);
  });

  it("throws on a non-OK response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 429 })));
    await expect(createLocationIQGeocoder("K").forward("x")).rejects.toThrow(/429/);
  });

  it("sends a viewbox as west,south,east,north and omits it when absent", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request) => new Response("[]", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const geocoder = createLocationIQGeocoder("KEY123");
    await geocoder.forward("Red Coach Inn", {
      limit: 1,
      viewbox: { minLat: 42, maxLat: 44, minLng: -80, maxLng: -77 },
    });
    const withBox = new URL(fetchMock.mock.calls[0]![0] as string);
    expect(withBox.searchParams.get("viewbox")).toBe("-80,42,-77,44");
    // Soft bias only — a hard `bounded=1` would return nothing for a place
    // just outside the box. The acceptance test in geocodeEnrichment guards.
    expect(withBox.searchParams.get("bounded")).toBeNull();

    await geocoder.forward("Red Coach Inn", { limit: 1 });
    const withoutBox = new URL(fetchMock.mock.calls[1]![0] as string);
    expect(withoutBox.searchParams.get("viewbox")).toBeNull();
  });
});
