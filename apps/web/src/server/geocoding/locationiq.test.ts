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
});
