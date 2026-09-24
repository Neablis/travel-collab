import { afterEach, describe, expect, it, vi } from "vitest";
import { roundForExport } from "../roundedPoint";
import metCompact from "./fixtures/met-compact.json";
import powerClimatology from "./fixtures/power-climatology.json";
import { createMetNorwayForecast } from "./met-norway";
import { createNasaPowerClimate } from "./nasa-power";
import { UpstreamError } from "./ports";

// The two adapters against their vendors' documented response shapes, with
// `fetch` stubbed (`locationiq.test.ts`' pattern) — no test reaches a real host
// (ADR-052 decision 9). The fixtures are written to the documented shapes;
// POWER's is marked TO VERIFY in `nasa-power.ts`.

afterEach(() => vi.unstubAllGlobals());

const NOW = new Date("2026-09-24T09:30:00Z");
const OSLO = roundForExport(59.913868, 10.752245);
const UA = "travel-collab/0.0.1 +https://caesura.today ops@example.com";

function stubFetch(response: () => Response) {
  const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => response());
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
const requestOf = (fetchMock: ReturnType<typeof stubFetch>) => {
  const [input, init] = fetchMock.mock.calls[0]!;
  return { url: new URL(String(input)), headers: new Headers(init?.headers) };
};

describe("MET Norway Locationforecast adapter", () => {
  const met = () => createMetNorwayForecast({ userAgent: UA, now: () => NOW });
  const ok = (status = 200) =>
    new Response(JSON.stringify(metCompact), {
      status,
      headers: { Expires: "Thu, 24 Sep 2026 10:05:12 GMT", "Last-Modified": "Thu, 24 Sep 2026 09:10:44 GMT" },
    });

  it("asks with an identifying User-Agent and a two-decimal point, and nothing else", async () => {
    const fetchMock = stubFetch(() => ok());
    await met().forecast(OSLO);
    const { url, headers } = requestOf(fetchMock);
    expect(url.origin + url.pathname).toBe("https://api.met.no/weatherapi/locationforecast/2.0/compact");
    expect([...url.searchParams.keys()].sort()).toEqual(["lat", "lon"]);
    expect(url.searchParams.get("lat")).toBe("59.91");
    expect(url.searchParams.get("lon")).toBe("10.75");
    expect(headers.get("User-Agent")).toBe(UA);
    expect(headers.get("If-Modified-Since")).toBeNull();
  });

  it("normalizes the series: hourly windows first, six-hourly after, the last an instant", async () => {
    stubFetch(() => ok());
    const fetched = await met().forecast(OSLO);
    if (fetched.kind !== "fresh") throw new Error("expected fresh");
    expect(fetched.value.updatedAt).toBe("2026-09-24T09:10:44.000Z");
    expect(fetched.value.steps[0]).toEqual({
      at: "2026-09-24T10:00:00.000Z", tempC: 12.3, symbol: "cloudy", precipitationMm: 0, windowHours: 1,
    });
    expect(fetched.value.steps[3]).toEqual({
      at: "2026-09-27T12:00:00.000Z", tempC: 16.8, symbol: "clearsky_day", precipitationMm: 0, windowHours: 6,
    });
    expect(fetched.value.steps.at(-1)).toMatchObject({ windowHours: 0, symbol: null, precipitationMm: 0 });
    // Honours `Expires` as the row's lifetime, and keeps `Last-Modified` to revalidate with.
    expect(fetched.expiresAt.toISOString()).toBe("2026-09-24T10:05:12.000Z");
    expect(fetched.lastModified).toBe("Thu, 24 Sep 2026 09:10:44 GMT");
    expect(fetched.sourceUpdatedAt?.toISOString()).toBe("2026-09-24T09:10:44.000Z");
  });

  it("revalidates with If-Modified-Since, and a 304 keeps the payload with the new Expires", async () => {
    const fetchMock = stubFetch(() => new Response(null, { status: 304, headers: { Expires: "Thu, 24 Sep 2026 11:00:00 GMT" } }));
    const fetched = await met().forecast(OSLO, { lastModified: "Thu, 24 Sep 2026 09:10:44 GMT" });
    expect(requestOf(fetchMock).headers.get("If-Modified-Since")).toBe("Thu, 24 Sep 2026 09:10:44 GMT");
    expect(fetched).toEqual({
      kind: "not-modified", expiresAt: new Date("2026-09-24T11:00:00Z"), lastModified: null,
    });
  });

  it("a 429 throws with when to come back; a 403 throws and says our request is wrong", async () => {
    stubFetch(() => new Response("", { status: 429, headers: { "Retry-After": "120" } }));
    const refused = await met().forecast(OSLO).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(UpstreamError);
    expect((refused as UpstreamError).retryAfter?.toISOString()).toBe("2026-09-24T09:32:00.000Z");

    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    stubFetch(() => new Response("", { status: 403 }));
    await expect(met().forecast(OSLO)).rejects.toMatchObject({ status: 403 });
    expect(error).toHaveBeenCalledOnce();
    error.mockRestore();
  });

  it("a 203 is a deprecation warning, and the body is still used", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    stubFetch(() => ok(203));
    expect((await met().forecast(OSLO)).kind).toBe("fresh");
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});

describe("NASA POWER climatology adapter", () => {
  const power = () => createNasaPowerClimate({ userAgent: UA, now: () => NOW });

  it("asks for the three parameters at a two-decimal point", async () => {
    const fetchMock = stubFetch(() => new Response(JSON.stringify(powerClimatology)));
    await power().normals(OSLO);
    const { url } = requestOf(fetchMock);
    expect(url.origin + url.pathname).toBe("https://power.larc.nasa.gov/api/temporal/climatology/point");
    expect(url.searchParams.get("parameters")).toBe("T2M_MAX,T2M_MIN,PRECTOTCORR");
    expect(url.searchParams.get("latitude")).toBe("59.91");
    expect(url.searchParams.get("longitude")).toBe("10.75");
  });

  it("normalizes to months, leaves out a month with a fill value, and reads the period", async () => {
    stubFetch(() => new Response(JSON.stringify(powerClimatology)));
    const fetched = await power().normals(OSLO);
    if (fetched.kind !== "fresh") throw new Error("expected fresh");
    expect(fetched.value.period).toEqual({ fromYear: 2001, throughYear: 2020 });
    expect(fetched.value.months[0]).toEqual({ month: 1, highC: -0.71, lowC: -6.83, precipitationMmPerDay: 1.98 });
    // November's rainfall is POWER's -999 fill value: no guess, no month.
    expect(fetched.value.months.map((m) => m.month)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12]);
    // Normals are kept a month (ADR-052 decision 2).
    expect(fetched.expiresAt.toISOString()).toBe("2026-10-24T09:30:00.000Z");
  });

  it("throws on a failure, so the cache can serve what it has", async () => {
    stubFetch(() => new Response("", { status: 503 }));
    await expect(power().normals(OSLO)).rejects.toBeInstanceOf(UpstreamError);
  });
});
