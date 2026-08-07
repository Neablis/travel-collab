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
