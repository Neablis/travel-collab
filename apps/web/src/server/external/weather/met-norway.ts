import { pointText, type RoundedPoint } from "../roundedPoint";
import { UpstreamError, type CacheValidators, type Fetched, type Forecast, type ForecastSeries, type ForecastStep } from "./ports";

// MET Norway Locationforecast 2.0, `complete` (ADR-052's sources table, verified
// 2026-09-24 against https://api.met.no/doc/TermsOfService). Their conditions,
// and where each is kept:
//
// - an identifying `User-Agent` with a contact — built by `index.ts` from
//   `EXTERNAL_DATA_CONTACT`, and a browser cannot set one, which is the whole
//   reason this is a server call (decision 1);
// - honour `Expires`, and revalidate with `If-Modified-Since` — the cache
//   (`../cache.ts`) keeps both and hands `Last-Modified` back here as `prior`;
// - at most four decimals — `RoundedPoint` has two, by construction;
// - a 403 means OUR request is wrong (no User-Agent, too many decimals), so it
//   is logged as an error and not retried; a 203 means the product is
//   deprecated and is logged as a warning, and the body is still good.
//
// The response shape is MET's documented GeoJSON (`properties.meta.updated_at`,
// `properties.timeseries[].data.{instant,next_1_hours,next_6_hours}`);
// `fixtures/met-complete.json` is a trimmed recording of it.
//
// **`complete`, not `compact`** (M14 PART 3 review, finding 4): `compact`'s
// `next_6_hours` carries only rain, so past ~2.5 days a day's high and low
// came from four UTC instants and missed the afternoon peak. `complete`'s
// `next_6_hours.details` adds `air_temperature_max` / `air_temperature_min`.
// **TO VERIFY** — that field pair is taken from MET's documented data model
// (docs.api.met.no, Locationforecast "complete"), and the fixture is written
// to it; no live `complete` response has been read yet (the sandbox that made
// this change could not reach api.met.no). If they are absent, a six-hour
// step simply has no extremes and the day falls back to its instants.

const ENDPOINT = "https://api.met.no/weatherapi/locationforecast/2.0/complete";
// ADR-052 decision 8: a slow source never holds the notebook.
const TIMEOUT_MS = 4000;
// When MET sends no `Expires` (it always has), an hour: shorter than a model
// run's cadence, so it cannot keep a stale forecast for long.
const FALLBACK_TTL_MS = 60 * 60 * 1000;
// When a 429 names no `Retry-After`, ten minutes.
const FALLBACK_BACKOFF_MS = 10 * 60 * 1000;

type Window = {
  summary?: { symbol_code?: string };
  details?: { precipitation_amount?: number; air_temperature_max?: number; air_temperature_min?: number };
};
interface CompleteBody {
  properties?: {
    meta?: { updated_at?: string };
    timeseries?: Array<{
      time: string;
      data: { instant: { details: { air_temperature?: number } }; next_1_hours?: Window; next_6_hours?: Window };
    }>;
  };
}

function httpDate(value: string | null): Date | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms) : null;
}

/** `Retry-After` is seconds or an HTTP date. */
function retryAfterOf(value: string | null, now: Date): Date {
  if (value && /^\d+$/.test(value.trim())) return new Date(now.getTime() + Number(value) * 1000);
  return httpDate(value) ?? new Date(now.getTime() + FALLBACK_BACKOFF_MS);
}

/**
 * MET's series, normalized. A step's window is its next hour when MET gives
 * one (the first ~2.5 days) and its next six hours after that; the last step
 * has neither and describes an instant. Steps without a temperature are
 * dropped — there is nothing to say about them.
 *
 * Only a six-hourly step takes its window's extremes: an hourly step's
 * instants already are the extremes, and the six-hour window MET also gives
 * it runs past the hour it describes.
 */
export function parseComplete(body: CompleteBody, lastModified: Date | null, now: Date): ForecastSeries {
  const steps: ForecastStep[] = [];
  for (const entry of body.properties?.timeseries ?? []) {
    const tempC = entry.data.instant.details.air_temperature;
    if (typeof tempC !== "number") continue;
    const hourly = entry.data.next_1_hours;
    const sixHourly = entry.data.next_6_hours;
    const window = hourly ?? sixHourly;
    const extremes = hourly ? undefined : sixHourly?.details;
    steps.push({
      at: new Date(entry.time).toISOString(),
      tempC,
      symbol: window?.summary?.symbol_code ?? null,
      precipitationMm: Math.max(0, window?.details?.precipitation_amount ?? 0),
      windowHours: hourly ? 1 : sixHourly ? 6 : 0,
      ...(typeof extremes?.air_temperature_max === "number" ? { maxC: extremes.air_temperature_max } : {}),
      ...(typeof extremes?.air_temperature_min === "number" ? { minC: extremes.air_temperature_min } : {}),
    });
  }
  // The as-of is the model run, not our fetch (decision 7), falling back to
  // `Last-Modified` and only then to now.
  const updatedAt = httpDate(body.properties?.meta?.updated_at ?? null) ?? lastModified ?? now;
  return { updatedAt: updatedAt.toISOString(), steps };
}

/** A `Forecast` backed by MET Norway's complete product, sending `userAgent`; `now` is injected for tests. */
export function createMetNorwayForecast(options: { userAgent: string; now?: () => Date }): Forecast {
  const now = options.now ?? (() => new Date());
  return {
    async forecast(at: RoundedPoint, prior?: CacheValidators): Promise<Fetched<ForecastSeries>> {
      const { lat, lng } = pointText(at);
      const url = new URL(ENDPOINT);
      url.searchParams.set("lat", lat);
      url.searchParams.set("lon", lng);
      const headers: Record<string, string> = { "User-Agent": options.userAgent, Accept: "application/json" };
      if (prior) headers["If-Modified-Since"] = prior.lastModified;
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
      const asked = now();
      const expiresAt = httpDate(res.headers.get("Expires")) ?? new Date(asked.getTime() + FALLBACK_TTL_MS);
      const lastModified = res.headers.get("Last-Modified");

      if (res.status === 304) return { kind: "not-modified", expiresAt, lastModified };
      if (res.status === 429) {
        throw new UpstreamError("MET Norway: 429", 429, retryAfterOf(res.headers.get("Retry-After"), asked));
      }
      if (res.status === 403) {
        console.error("[external] MET Norway refused the request (403): check the User-Agent and the decimals");
        throw new UpstreamError("MET Norway: 403", 403);
      }
      if (res.status === 203) console.warn("[external] MET Norway: 203, locationforecast/2.0/complete is deprecated");
      if (!res.ok) throw new UpstreamError(`MET Norway: ${res.status}`, res.status);

      const series = parseComplete((await res.json()) as CompleteBody, httpDate(lastModified), asked);
      if (series.steps.length === 0) throw new UpstreamError("MET Norway: an empty series");
      return {
        kind: "fresh", value: series, expiresAt, lastModified,
        sourceUpdatedAt: new Date(series.updatedAt),
      };
    },
  };
}
