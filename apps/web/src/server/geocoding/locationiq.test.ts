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
