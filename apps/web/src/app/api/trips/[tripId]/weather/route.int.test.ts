import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TripWeatherResponse, type TripWeather } from "@tc/contracts";
import { clockIn, renderMacro } from "@tc/pages";
import { addDaysIso } from "@/lib/dates";
import { executeTripCommand } from "@/server/commands";
import { db } from "@/server/db/client";
import { externalDataCache, rateLimitCounters } from "@/server/db/schema";
import type { Climate, Forecast } from "@/server/external/weather";
import { getTripDetail } from "@/server/projections";
import { timeZoneAt } from "@/server/timeZones";

// ADR-052's gate: *"a quiet `unavailable` placeholder when the source is down.
// That state is proved with a failing port stub, not by assertion."* This file
// is that proof: the route, against real Postgres and the real cache, with
// ports that REJECT — and the body it answers, fed through the real
// `day.weather` resolver, comes out `unavailable`. `WeatherBlock.test.tsx`
// renders the same body to the Reading placeholder.
//
// No test reaches a real host: the two ports are stubs, swapped where
// `server/external/weather/index.ts` picks the adapters (one line each).

const OWNER = "weather-owner";
let currentUserId = OWNER;
vi.mock("@/server/auth", () => ({
  auth: vi.fn(async () => (currentUserId ? { user: { id: currentUserId } } : null)),
}));

const failing = (what: string) => () => Promise.reject(new Error(`${what}: connect ECONNREFUSED`));
let forecastPort: Forecast = { forecast: failing("MET Norway") };
let climatePort: Climate = { normals: failing("NASA POWER") };
let forecastMissing = false;
vi.mock("@/server/external/weather", () => ({
  getForecast: () => {
    if (forecastMissing) throw new Error("EXTERNAL_DATA_CONTACT is not set");
    return forecastPort;
  },
  getClimate: () => climatePort,
}));

const { GET } = await import("./route");

const OSLO = { name: "Oslo Opera House", lat: 59.907419, lng: 10.753285, city: "Oslo" };
// Oslo's calendar date, not UTC's or the runner's. The block calls a day
// "Today" by the date at the place (`placeToday`, KI-2026-09-27-c), which the
// route reads as `clockIn(zone, now)` in the stop's own zone — so the trip is
// dated the same way. Later days are calendar arithmetic, not `+ n * 24h`: on
// the eve of a spring-forward the next day is 23 hours long, and 24 hours from
// 23:30 lands two dates on.
const OSLO_ZONE = timeZoneAt(OSLO.lat, OSLO.lng)!;
const osloDay = (n: number) => addDaysIso(clockIn(OSLO_ZONE, Date.now()).date, n);

// A pinned clock, so every run sees the same dates. The instant is the one
// this file failed at when it dated the trip by UTC (2026-09-27, 16:41 in
// California): 23:41 UTC, already the 28th in Oslo. `Date` only — Postgres
// I/O keeps real timers.
const NOW = new Date("2026-09-27T23:41:00Z");

/** Two dated days, today and tomorrow in Oslo, with a located stop on each. */
async function seedTrip(): Promise<string> {
  const tripId = randomUUID();
  const days = [randomUUID(), randomUUID()];
  const run = async (command: Parameters<typeof executeTripCommand>[0]) => {
    const result = await executeTripCommand(command, OWNER);
    if (!result.ok) throw new Error(`seed failed: ${JSON.stringify(result)}`);
  };
  await run({ type: "CreateTrip", tripId, name: "Oslo" });
  await run({ type: "SetTripDates", tripId, startDate: osloDay(0), endDate: osloDay(1), newDayIds: days });
  for (const dayId of days) {
    await run({ type: "AddActivity", tripId, activityId: randomUUID(), dayId, title: "Opera", location: OSLO });
  }
  return tripId;
}

async function get(tripId: string) {
  return GET(new Request(`http://test/api/trips/${tripId}/weather`), { params: Promise.resolve({ tripId }) });
}

/** The body, parsed by the contract — the route promises a `TripWeatherResponse`. */
async function weatherOf(tripId: string): Promise<TripWeather> {
  const res = await get(tripId);
  expect(res.status).toBe(200);
  return TripWeatherResponse.parse(await res.json()).weather;
}

/** What the reader's widget makes of that body, on the trip's first day. */
async function widgetOn(tripId: string, weather: TripWeather) {
  const trip = await getTripDetail(tripId);
  return renderMacro(
    { trip: trip!, page: { tripId }, user: null, globals: null, today: osloDay(0), external: { weather: { state: "ready", value: weather } } },
    "day.weather",
    {},
  );
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  currentUserId = OWNER;
  forecastPort = { forecast: failing("MET Norway") };
  climatePort = { normals: failing("NASA POWER") };
  forecastMissing = false;
  // Only these two tables; each run has its own database (with-test-db.mjs).
  await db.delete(externalDataCache);
  await db.delete(rateLimitCounters);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
});

describe("GET /api/trips/:tripId/weather", () => {
  it("401s when unauthenticated and 403s for a non-member, asking no source", async () => {
    const tripId = await seedTrip();
    const port = vi.fn(failing("MET Norway"));
    forecastPort = { forecast: port };
    currentUserId = "";
    expect((await get(tripId)).status).toBe(401);
    currentUserId = "someone-else";
    expect((await get(tripId)).status).toBe(403);
    expect(port).not.toHaveBeenCalled();
  });

  it("with both sources down, answers 200 with every point unavailable — and the widget is the quiet placeholder", async () => {
    const tripId = await seedTrip();
    const weather = await weatherOf(tripId);
    // Today's date in Oslo at NOW, which is what every point says today is
    // there — not the runner's date, nor UTC's 27th (KI-2026-09-27-c).
    const placeToday = "2026-09-28";
    const down = { forecast: { unavailable: "source" }, typical: { unavailable: "source" }, placeToday };
    expect(weather.points).toEqual([
      { date: osloDay(0), city: "Oslo", ...down },
      { date: osloDay(1), city: "Oslo", ...down },
    ]);
    expect(await widgetOn(tripId, weather)).toEqual({ status: "unavailable", reason: "source" });
  });

  it("with only the forecast down, the widget shows typical, labelled, in its place", async () => {
    const tripId = await seedTrip();
    climatePort = {
      normals: async () => ({
        kind: "fresh",
        value: {
          months: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, highC: 12, lowC: 4, precipitationMmPerDay: 2.5 })),
          period: { fromYear: 2001, throughYear: 2020 },
        },
        expiresAt: new Date(Date.now() + 86_400_000), lastModified: null, sourceUpdatedAt: null,
      }),
    };
    const weather = await weatherOf(tripId);
    expect(weather.points.every((p) => "unavailable" in p.forecast && !("unavailable" in p.typical))).toBe(true);
    const outcome = await widgetOn(tripId, weather);
    if (outcome.status !== "ok" || outcome.rendered.kind !== "block" || outcome.rendered.block.kind !== "weather") {
      throw new Error(`expected the weather block, got ${JSON.stringify(outcome)}`);
    }
    expect(outcome.rendered.block.rows[0]!.modeText).toMatch(/^No forecast · \w{3} avg$/);
  });

  it("with no EXTERNAL_DATA_CONTACT, the forecast is down and the route is not", async () => {
    forecastMissing = true;
    const tripId = await seedTrip();
    const weather = await weatherOf(tripId);
    expect(weather.points[0]!.forecast).toEqual({ unavailable: "source" });
  });

  // A forecast that cannot be asked is not asked, and so not CHARGED: with
  // the contact unset, every page load used to spend the reader's weather
  // quota on a call that was never made, until the normals were refused too
  // and "typical" became "Weather unavailable" (M14 PART 3 review, finding 3).
  it("with no EXTERNAL_DATA_CONTACT, the forecast costs no quota — typical still gets it", async () => {
    vi.stubEnv("WEATHER_RATE_LIMIT_PER_USER_DAILY", "1");
    forecastMissing = true;
    const tripId = await seedTrip();
    const normals = vi.fn(async () => ({
      kind: "fresh" as const,
      value: {
        months: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, highC: 12, lowC: 4, precipitationMmPerDay: 2.5 })),
        period: { fromYear: 2001, throughYear: 2020 },
      },
      expiresAt: new Date(Date.now() + 86_400_000), lastModified: null, sourceUpdatedAt: null,
    }));
    climatePort = { normals };
    const weather = await weatherOf(tripId);
    expect(normals).toHaveBeenCalledOnce();
    expect(weather.points.every((p) => !("unavailable" in p.typical))).toBe(true);
    vi.unstubAllEnvs();
  });

  it("caches by rounded point only — one row per source, and nothing that says whose trip asked", async () => {
    const tripId = await seedTrip();
    const series = {
      updatedAt: new Date().toISOString(),
      steps: [{ at: new Date().toISOString(), tempC: 11, symbol: "fair_day", precipitationMm: 0, windowHours: 6 as const }],
    };
    const port = vi.fn(async () => ({
      kind: "fresh" as const, value: series, expiresAt: new Date(Date.now() + 3_600_000),
      lastModified: null, sourceUpdatedAt: null,
    }));
    forecastPort = { forecast: port };
    await weatherOf(tripId);
    // Two days in one place: one call, not one per day.
    expect(port).toHaveBeenCalledOnce();
    const rows = await db.select().from(externalDataCache);
    expect(rows.map((r) => r.key)).toEqual(["met:forecast:59.91,10.75"]);
    expect(JSON.stringify(rows)).not.toContain(tripId);
    expect(JSON.stringify(rows)).not.toContain(OWNER);
  });

  it("stops calling past our own daily ceiling, and answers unavailable rather than 429", async () => {
    vi.stubEnv("WEATHER_RATE_LIMIT_PER_USER_DAILY", "1");
    const tripId = await seedTrip();
    const forecast = vi.fn(failing("MET Norway"));
    const normals = vi.fn(failing("NASA POWER"));
    forecastPort = { forecast };
    climatePort = { normals };
    expect(await weatherOf(tripId)).toMatchObject({ points: [{ typical: { unavailable: "source" } }, {}] });
    expect(forecast.mock.calls.length + normals.mock.calls.length).toBe(1);
    vi.unstubAllEnvs();
  });
});
