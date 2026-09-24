import { describe, expect, it, vi } from "vitest";
import type { TripDetail } from "@tc/contracts";
import { tripDetailFactory } from "@tc/factories";
import type { CacheRow, CacheStore } from "../cache";
import { pointText } from "../roundedPoint";
import metCompact from "./fixtures/met-compact.json";
import { parseCompact } from "./met-norway";
import { buildTripWeather, forecastDayOf, weatherPointsOf, type WeatherDeps } from "./tripWeather";
import type { Climate, Fetched, Forecast, ForecastSeries, MonthlyNormals } from "./ports";

// The service behind the weather route (ADR-052 decision 3): the points come
// from the trip, the days are cut in the place's zone, the horizon is read
// from the data, and calls are deduped, bounded and optional. The cache here
// is in memory; `cache.int.test.ts` holds the real table to the same path.

const NOW = new Date("2026-09-24T09:30:00Z");
const OSLO = { lat: 59.913868, lng: 10.752245, city: "Oslo" };
const BERGEN = { lat: 60.39299, lng: 5.32415, city: "Bergen" };
const SERIES: ForecastSeries = parseCompact(metCompact as never, null, NOW);

type Stop = { lat?: number; lng?: number; city?: string; start?: string };

/** A trip whose days carry the given dates and stops, from the factory. */
function tripOf(days: { date: string | null; stops: Stop[] }[]): TripDetail {
  const most = Math.max(1, ...days.map((d) => d.stops.length));
  const built = tripDetailFactory.build({}, { transient: { dayCount: days.length, activitiesPerDay: most } });
  const activities = { ...built.activities };
  const outDays = built.days.map((day, i) => {
    const spec = days[i]!;
    const ids = day.activityIds.slice(0, spec.stops.length);
    ids.forEach((id, j) => {
      const stop = spec.stops[j]!;
      activities[id] = {
        ...activities[id]!,
        location: stop.lat === undefined ? null : { name: "a stop", lat: stop.lat, lng: stop.lng, ...(stop.city ? { city: stop.city } : {}) },
        timeWindow: stop.start ? { start: stop.start, end: null } : null,
      } as never;
    });
    return { ...day, date: spec.date, activityIds: ids };
  });
  return { ...built, days: outDays, activities };
}

function memoryStore(): CacheStore & { rows: Map<string, CacheRow> } {
  const rows = new Map<string, CacheRow>();
  return { rows, read: async (key) => rows.get(key) ?? null, write: async (row) => void rows.set(row.key, row) };
}

const NORMALS: MonthlyNormals = {
  months: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, highC: 10 + i, lowC: i, precipitationMmPerDay: 2 })),
  period: { fromYear: 2001, throughYear: 2020 },
};
const fresh = <T,>(value: T): Fetched<T> => ({
  kind: "fresh", value, expiresAt: new Date(NOW.getTime() + 3_600_000), lastModified: null, sourceUpdatedAt: null,
});

function deps(over: Partial<WeatherDeps> = {}) {
  const forecast = { forecast: vi.fn(async () => fresh(SERIES)) } satisfies Forecast;
  const climate = { normals: vi.fn(async () => fresh(NORMALS)) } satisfies Climate;
  const charge = vi.fn(async () => true);
  return {
    forecast, climate, charge,
    deps: { forecast, climate, charge, store: memoryStore(), now: NOW, outOfTime: () => false, ...over } as WeatherDeps,
  };
}

describe("weatherPointsOf — the server derives the points", () => {
  it("gives each dated day a point per city, at that city's first stop in time order, rounded", () => {
    const trip = tripOf([
      // The 10:00 stop is stored first; the 08:00 one is where the day starts.
      { date: "2026-09-24", stops: [{ ...OSLO, lat: 59.95, start: "10:00" }, { ...OSLO, start: "08:00" }] },
      { date: "2026-09-25", stops: [{ ...OSLO, start: "08:00" }, { ...BERGEN, start: "18:00" }] },
    ]);
    const points = weatherPointsOf(trip).map((p) => ({ date: p.date, city: p.city, at: pointText(p.point), zone: p.zone }));
    expect(points).toEqual([
      { date: "2026-09-24", city: "Oslo", at: { lat: "59.91", lng: "10.75" }, zone: "Europe/Oslo" },
      { date: "2026-09-25", city: "Oslo", at: { lat: "59.91", lng: "10.75" }, zone: "Europe/Oslo" },
      { date: "2026-09-25", city: "Bergen", at: { lat: "60.39", lng: "5.32" }, zone: "Europe/Oslo" },
    ]);
  });

  it("gives a located day with no city one point, and a day with no place or no date none", () => {
    const trip = tripOf([
      { date: "2026-09-24", stops: [{ lat: 59.91, lng: 10.75 }] },
      { date: "2026-09-25", stops: [{ city: "Oslo" }] },
      { date: null, stops: [OSLO] },
    ]);
    expect(weatherPointsOf(trip).map((p) => [p.date, p.city])).toEqual([["2026-09-24", null]]);
  });
});

describe("forecastDayOf — a local day cut from MET's series", () => {
  it("cuts today at the place from the hours still to come", () => {
    expect(forecastDayOf(SERIES, "2026-09-24", "Europe/Oslo", NOW)).toEqual({
      source: "met-norway",
      asOf: "2026-09-24T09:10:44.000Z",
      highC: 14.6,
      lowC: 12.3,
      precipitationMm: 0.8,
      // Oslo's local noon is the 10:00 UTC step.
      symbol: "cloudy",
      hours: [
        { at: "2026-09-24T10:00:00.000Z", tempC: 12.3, precipitationMm: 0, symbol: "cloudy" },
        { at: "2026-09-24T11:00:00.000Z", tempC: 13.1, precipitationMm: 0.3, symbol: "lightrain" },
        { at: "2026-09-24T12:00:00.000Z", tempC: 14.6, precipitationMm: 0.5, symbol: "lightrain" },
      ],
    });
  });

  it("drops the hours already gone, keeping the one under way as now", () => {
    const later = new Date("2026-09-24T11:30:00Z");
    expect(forecastDayOf(SERIES, "2026-09-24", "Europe/Oslo", later)?.hours.map((h) => h.tempC)).toEqual([13.1, 14.6]);
    expect(forecastDayOf(SERIES, "2026-09-24", "Europe/Oslo", new Date("2026-09-24T23:00:00Z"))).toBeNull();
  });

  it("reads six-hourly days, and the day's sky from nearest local noon", () => {
    expect(forecastDayOf(SERIES, "2026-09-27", "Europe/Oslo", NOW)).toMatchObject({
      highC: 16.8, lowC: 11.2, precipitationMm: 0, symbol: "clearsky_day",
    });
  });

  it("is null for a day the series does not cover to its end — the horizon, read from the data", () => {
    // The last step is 2026-10-04T00:00Z, 02:00 in Oslo: the 4th has begun and not ended.
    expect(forecastDayOf(SERIES, "2026-10-04", "Europe/Oslo", NOW)).toBeNull();
    expect(forecastDayOf(SERIES, "2026-10-12", "Europe/Oslo", NOW)).toBeNull();
  });
});

describe("buildTripWeather", () => {
  const trip = () =>
    tripOf([
      { date: "2026-09-23", stops: [OSLO] },
      { date: "2026-09-24", stops: [OSLO] },
      { date: "2026-09-27", stops: [OSLO] },
      { date: "2026-10-20", stops: [OSLO] },
    ]);

  it("asks once per rounded point, forecasts only inside the horizon, normals for every point", async () => {
    const { forecast, climate, charge, deps: d } = deps();
    const weather = await buildTripWeather(trip(), d);
    expect(forecast.forecast).toHaveBeenCalledOnce();
    expect(climate.normals).toHaveBeenCalledOnce();
    expect(charge).toHaveBeenCalledTimes(2);
    expect(weather.points.map((p) => [p.date, "unavailable" in p.forecast ? p.forecast.unavailable : "forecast"])).toEqual([
      ["2026-09-23", "not-in-horizon"], // in the asked-for window, but not in the series
      ["2026-09-24", "forecast"],
      ["2026-09-27", "forecast"],
      ["2026-10-20", "not-in-horizon"],
    ]);
    expect(weather.points[3]!.typical).toMatchObject({ source: "nasa-power", month: 10, highC: 19, lowC: 9 });
  });

  it("a second request inside the rows' lifetime calls nothing and charges nothing", async () => {
    const { forecast, charge, deps: d } = deps();
    await buildTripWeather(trip(), d);
    forecast.forecast.mockClear();
    charge.mockClear();
    await buildTripWeather(trip(), d);
    expect(forecast.forecast).not.toHaveBeenCalled();
    expect(charge).not.toHaveBeenCalled();
  });

  it("a failing forecast leaves the horizon's days `source`, with typical still there", async () => {
    const { deps: d } = deps({ forecast: { forecast: () => Promise.reject(new Error("MET Norway: 503")) } });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const weather = await buildTripWeather(trip(), d);
    expect(weather.points[1]).toMatchObject({ forecast: { unavailable: "source" }, typical: { source: "nasa-power", month: 9 } });
    expect(weather.points[3]).toMatchObject({ forecast: { unavailable: "not-in-horizon" } });
  });

  it("out of time, calls nothing and answers with what the cache has", async () => {
    const { forecast, climate, deps: d } = deps({ outOfTime: () => true });
    const weather = await buildTripWeather(trip(), d);
    expect(forecast.forecast).not.toHaveBeenCalled();
    expect(climate.normals).not.toHaveBeenCalled();
    expect(weather.points.every((p) => "unavailable" in p.typical)).toBe(true);
  });

  it("runs at most four calls at once", async () => {
    let inFlight = 0;
    let most = 0;
    const slow = async <T,>(value: T) => {
      inFlight += 1;
      most = Math.max(most, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return fresh(value);
    };
    const many = tripOf(
      Array.from({ length: 8 }, (_, i) => ({ date: "2026-09-24", stops: [{ lat: 40 + i, lng: 10, city: `City ${i}` }] })),
    );
    const { deps: d } = deps({ forecast: { forecast: () => slow(SERIES) }, climate: { normals: () => slow(NORMALS) } });
    const weather = await buildTripWeather(many, d);
    expect(weather.points).toHaveLength(8);
    expect(most).toBe(4);
  });
});
