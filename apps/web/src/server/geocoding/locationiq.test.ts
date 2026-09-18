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

  // LocationIQ's structured lookup is a SEPARATE ENDPOINT (/v1/search/structured),
  // not structured params on /v1/search — confirmed against its published
  // OpenAPI spec on 2026-09-18. A structured query cannot be mixed with `q`.
  it("geocodes an address on the structured endpoint with structured params, never `q`, restricted to its country", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request) =>
      new Response(
        JSON.stringify([
          {
            lat: "49.41",
            lon: "8.69",
            display_name: "Hauptstraße 5, Heidelberg",
            address: { country_code: "de", city: "Heidelberg" },
          },
        ]),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const results = await createLocationIQGeocoder("K").forwardAddress(
      {
        countryCode: "DE",
        lines: ["Hauptstraße 5"],
        dependentLocality: "Altstadt",
        locality: "Heidelberg",
        administrativeArea: "Baden-Württemberg",
        postalCode: "69117",
      },
      { limit: 1 },
    );

    expect(results[0]).toMatchObject({ lat: 49.41, lng: 8.69, countryCode: "DE", city: "Heidelberg" });
    const url = new URL(fetchMock.mock.calls[0]![0] as string);
    expect(url.pathname).toBe("/v1/search/structured");
    expect(url.searchParams.get("q")).toBeNull();
    expect(url.searchParams.get("street")).toBe("Hauptstraße 5");
    expect(url.searchParams.get("city")).toBe("Heidelberg");
    expect(url.searchParams.get("state")).toBe("Baden-Württemberg");
    expect(url.searchParams.get("postalcode")).toBe("69117");
    // `countrycodes` (ISO alpha-2), not the structured endpoint's `country`,
    // which takes a country NAME — we hold the code.
    expect(url.searchParams.get("countrycodes")).toBe("de");
    expect(url.searchParams.get("limit")).toBe("1");
    expect(url.searchParams.get("accept-language")).toBe("en");
  });

  it("joins multiple address lines into one street param, in the caller's order", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request) => new Response("[]", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await createLocationIQGeocoder("K").forwardAddress({ countryCode: "GB", lines: ["Flat 4", "221B Baker Street"] });
    const url = new URL(fetchMock.mock.calls[0]![0] as string);
    expect(url.searchParams.get("street")).toBe("Flat 4, 221B Baker Street");
  });

  it("restricts a free-text lookup to a country when asked, and keeps it on the free-text endpoint", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request) => new Response("[]", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await createLocationIQGeocoder("K").forward("Blue Bottle", { countryCode: "JP" });
    const url = new URL(fetchMock.mock.calls[0]![0] as string);
    expect(url.pathname).toBe("/v1/search");
    expect(url.searchParams.get("q")).toBe("Blue Bottle");
    expect(url.searchParams.get("countrycodes")).toBe("jp");
  });

  // LocationIQ answers a miss with HTTP 404 {"error":"Unable to geocode"}
  // (confirmed against its docs, 2026-09-18). It must surface as [] so a caller
  // can tell `no-match` from `unavailable`; every other non-OK status still throws.
  it("treats LocationIQ's 404 'Unable to geocode' as no results, not an error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "Unable to geocode" }), { status: 404 })),
    );
    await expect(createLocationIQGeocoder("K").forward("zzzz")).resolves.toEqual([]);
  });
});
