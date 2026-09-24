import { citiesOfDay } from "@tc/domain";
import type { ForecastDay, TripDetail, TripWeather, TripWeatherPoint, TypicalMonth } from "@tc/contracts";
import { readThrough, type CacheStore } from "../cache";
import { pointText, roundForExport, type RoundedPoint } from "../roundedPoint";
import { timeZoneAt } from "../../timeZones";
import { ForecastSeries, MonthlyNormals, type Climate, type Forecast } from "./ports";

// A trip's weather, as `GET /api/trips/[tripId]/weather` answers it (ADR-052
// decision 3). **The points are derived here, from the trip, never sent by the
// client**: for each dated day, for each city of that day, the first stop in
// time order in that city with coordinates — rounded before anything else
// sees it. The server does not choose a mode; the reader's date does, on the
// client (`day.weather`'s resolver).
//
// What this module decides instead is what is TRUE of the data: which local
// days MET's series fully covers (so the horizon is read from the data, not
// guessed), and what a day's high, low, rain and hours are — cut in the
// place's own time zone.

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
// Decision 8: at most four calls at once, so one page load stays far under
// MET's 20 req/s, and each gets four seconds.
const CONCURRENCY = 4;
export const CALL_TIMEOUT_MS = 4000;

export interface WeatherDeps {
  /** `null` when the source is not configured: its calls are not made, so not charged (review finding 3). */
  forecast: Forecast | null;
  climate: Climate;
  store: CacheStore;
  /** Charges one upstream call to our own quota; `false` is a refusal. Called only on a cache miss. */
  charge: () => Promise<boolean>;
  now: Date;
  /**
   * `true` once the request has spent its budget: a call not yet started is
   * not made, and its point is served from the cache or not at all — the
   * route answers with what has arrived rather than holding the notebook.
   */
  outOfTime: () => boolean;
}

/** One (day, city) and where it is. `zone` is the place's own, from the unrounded stop. */
export interface PlannedPoint {
  date: string;
  city: string | null;
  point: RoundedPoint;
  zone: string | null;
}

type Located = { lat: number; lng: number; city: string | null };

/** A day's stops in time order — timed by start, then untimed in stored order — the walk `citiesOfDay` makes. */
function locatedInTimeOrder(detail: TripDetail, activityIds: readonly string[]): Located[] {
  const timed: { start: string; stop: Located }[] = [];
  const untimed: Located[] = [];
  for (const id of activityIds) {
    const location = detail.activities[id]?.location;
    if (location?.lat === undefined || location.lng === undefined) continue;
    const stop = { lat: location.lat, lng: location.lng, city: location.city ?? null };
    const start = detail.activities[id]!.timeWindow?.start;
    if (start) timed.push({ start, stop });
    else untimed.push(stop);
  }
  timed.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  return [...timed.map((t) => t.stop), ...untimed];
}

/**
 * The trip's points. A day with no located stop has none — the widget says
 * "no place on this day", which the author can fix. A day whose located stops
 * name no city gets one point, at its first, with no city.
 */
export function weatherPointsOf(detail: TripDetail): PlannedPoint[] {
  const points: PlannedPoint[] = [];
  detail.days.forEach((day, index) => {
    if (day.date === null) return;
    const stops = locatedInTimeOrder(detail, day.activityIds);
    if (stops.length === 0) return;
    const planned = (stop: Located, city: string | null): PlannedPoint => ({
      date: day.date!, city, point: roundForExport(stop.lat, stop.lng), zone: timeZoneAt(stop.lat, stop.lng),
    });
    const byCity = citiesOfDay(detail, index).flatMap((city) => {
      const first = stops.find((stop) => stop.city === city);
      return first ? [planned(first, city)] : [];
    });
    points.push(...(byCity.length > 0 ? byCity : [planned(stops[0]!, null)]));
  });
  return points;
}

const keyOf = (kind: "met:forecast" | "power:normals", point: RoundedPoint) => {
  const { lat, lng } = pointText(point);
  return `${kind}:${lat},${lng}`;
};

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

const localFormats = new Map<string, Intl.DateTimeFormat>();
/** An instant's calendar date and hour in `zone` (UTC when the place has none). */
function localOf(zone: string | null, ms: number): { date: string; hour: number } {
  const name = zone ?? "UTC";
  let format = localFormats.get(name);
  if (!format) {
    format = new Intl.DateTimeFormat("en-CA", {
      timeZone: name, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
    });
    localFormats.set(name, format);
  }
  const parts = Object.fromEntries(format.formatToParts(ms).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

/**
 * One local day cut from a series, or `null` when the series does not cover
 * it to its end — that day is past the horizon, and the reader sees typical.
 *
 * The first local day of a series starts part-way (MET's series starts at the
 * current hour), and is kept: it is "today" at the place. Steps already over
 * at `now` are left out, so for today the hours are "now and the rest of the
 * day", and a day entirely gone is `null`.
 *
 * A six-hour window is counted to the day it starts on, even when the place's
 * offset makes it straddle midnight: MET gives the window's rain as one number.
 */
export function forecastDayOf(
  series: ForecastSeries, date: string, zone: string | null, now: Date,
): ForecastDay | null {
  const steps = series.steps.map((step) => ({ ...step, ms: Date.parse(step.at) }));
  const coveredThrough = Math.max(...steps.map((s) => s.ms + s.windowHours * HOUR_MS));
  if (!Number.isFinite(coveredThrough) || localOf(zone, coveredThrough).date <= date) return null;
  const inDay = steps.filter(
    (s) => localOf(zone, s.ms).date === date && s.ms + Math.max(s.windowHours, 1) * HOUR_MS > now.getTime(),
  );
  if (inDay.length === 0) return null;
  const temps = inDay.map((s) => s.tempC);
  // A six-hour window's own extremes, where the source gave them: four
  // instants a day miss the afternoon peak (review finding 4).
  const highs = [...temps, ...inDay.flatMap((s) => (s.maxC === undefined ? [] : [s.maxC]))];
  const lows = [...temps, ...inDay.flatMap((s) => (s.minC === undefined ? [] : [s.minC]))];
  // The day's sky is the one nearest local noon.
  const noonmost = inDay.reduce((best, s) =>
    Math.abs(localOf(zone, s.ms).hour - 12) < Math.abs(localOf(zone, best.ms).hour - 12) ? s : best,
  );
  return {
    source: "met-norway",
    asOf: series.updatedAt,
    highC: Math.max(...highs),
    lowC: Math.min(...lows),
    precipitationMm: Math.round(inDay.reduce((sum, s) => sum + s.precipitationMm, 0) * 10) / 10,
    symbol: noonmost.symbol,
    hours: inDay.map((s) => ({ at: s.at, tempC: s.tempC, precipitationMm: s.precipitationMm, symbol: s.symbol })),
  };
}

function typicalOf(normals: MonthlyNormals, date: string): TypicalMonth | null {
  const month = Number(date.slice(5, 7));
  const found = normals.months.find((m) => m.month === month);
  return found ? { source: "nasa-power", ...found, period: normals.period } : null;
}

/** Runs `work` over `items`, at most `limit` at once. */
async function pool<T>(items: readonly T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const lane = async () => {
    while (next < items.length) await work(items[next++]!);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
}

/**
 * The trip's weather. Calls are deduped by rounded point, so a hotel and the
 * museum next door, or one city across five days, are one call each. A
 * forecast is asked for only when the date is within `[UTC today − 1, UTC
 * today + 11]` — the horizon with a day's slack either side for time zones;
 * normals are asked for every point.
 */
export async function buildTripWeather(detail: TripDetail, deps: WeatherDeps): Promise<TripWeather> {
  const planned = weatherPointsOf(detail);
  const today = deps.now.getTime();
  const [earliest, latest] = [isoDay(today - DAY_MS), isoDay(today + 11 * DAY_MS)];
  const inHorizon = (date: string) => date >= earliest && date <= latest;

  const series = new Map<string, ForecastSeries | null>();
  const normals = new Map<string, MonthlyNormals | null>();
  const jobs = new Map<string, () => Promise<void>>();
  const charge = () => (deps.outOfTime() ? Promise.resolve(false) : deps.charge());
  const source = deps.forecast;
  for (const { date, point } of planned) {
    const forecastKey = keyOf("met:forecast", point);
    // No source, no job: its points are `unavailable: "source"` below, and
    // nothing is charged for a call that could never be made.
    if (source && inHorizon(date) && !jobs.has(forecastKey)) {
      jobs.set(forecastKey, async () => {
        const got = await readThrough({
          key: forecastKey, schema: ForecastSeries, store: deps.store, now: deps.now, charge,
          timeoutMs: CALL_TIMEOUT_MS, call: (prior) => source.forecast(point, prior),
        });
        series.set(forecastKey, got?.value ?? null);
      });
    }
    const normalsKey = keyOf("power:normals", point);
    if (!jobs.has(normalsKey)) {
      jobs.set(normalsKey, async () => {
        const got = await readThrough({
          key: normalsKey, schema: MonthlyNormals, store: deps.store, now: deps.now, charge,
          timeoutMs: CALL_TIMEOUT_MS, call: () => deps.climate.normals(point),
        });
        normals.set(normalsKey, got?.value ?? null);
      });
    }
  }
  await pool([...jobs.values()], CONCURRENCY, (job) => job());

  const points: TripWeatherPoint[] = planned.map(({ date, city, point, zone }) => {
    const forecastSeries = series.get(keyOf("met:forecast", point));
    const monthly = normals.get(keyOf("power:normals", point));
    let forecast: TripWeatherPoint["forecast"];
    if (!inHorizon(date)) forecast = { unavailable: "not-in-horizon" };
    else if (!forecastSeries) forecast = { unavailable: "source" };
    else forecast = forecastDayOf(forecastSeries, date, zone, deps.now) ?? { unavailable: "not-in-horizon" };
    const typical = monthly ? typicalOf(monthly, date) : null;
    return { date, city, forecast, typical: typical ?? { unavailable: "source" } };
  });
  return { points };
}
