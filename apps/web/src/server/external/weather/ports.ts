import { z } from "zod";
import type { RoundedPoint } from "../roundedPoint";
import type { CacheValidators, Fetched } from "../upstream";

export { UpstreamError, type CacheValidators, type Fetched } from "../upstream";

// The two weather seams (ADR-052 decision 1), ADR-007's `Geocoder` shape: a
// server-internal interface per CAPABILITY, each adapter hiding its vendor and
// returning normalized data, never a vendor payload — so swapping one (the
// Open-Meteo paid fallback for "typical") is an adapter and a line in
// `index.ts`, and zero migration of what the cache holds.
//
// **Two ports, not one `Weather`**: the sources differ in terms, cache lifetime
// and credit, and the fallback replaces only one of them.
//
// The value shapes are zod schemas because the cache reads them back out of a
// `jsonb` column: a row written by an older build is parsed, and one that no
// longer fits is treated as absent rather than trusted.

/** One step of a forecast series, as the adapter normalized it. */
export const ForecastStep = z.object({
  /** The step's instant, ISO. */
  at: z.string(),
  tempC: z.number(),
  /** The sky over this step's window; `null` where the source gave none. */
  symbol: z.string().nullable(),
  /** Precipitation over the step's window, mm. */
  precipitationMm: z.number().nonnegative(),
  /**
   * How long the window `symbol` and `precipitationMm` describe is: 1 h near
   * the start of MET's series, 6 h further out, 0 on the last step, which
   * has an instant and no window. A day is cut from these windows.
   */
  windowHours: z.union([z.literal(0), z.literal(1), z.literal(6)]),
  /**
   * The window's own highest and lowest temperature, on six-hour steps only:
   * four instants a day miss the afternoon peak, and the window's extremes do
   * not. Optional, so a row cached before these existed still parses.
   */
  maxC: z.number().optional(),
  minC: z.number().optional(),
});
export type ForecastStep = z.infer<typeof ForecastStep>;

export const ForecastSeries = z.object({
  /** The model run the series came from (decision 7's as-of), ISO. */
  updatedAt: z.string(),
  steps: z.array(ForecastStep),
});
export type ForecastSeries = z.infer<typeof ForecastSeries>;

export const MonthlyNormal = z.object({
  month: z.number().int().min(1).max(12),
  highC: z.number(),
  lowC: z.number(),
  precipitationMmPerDay: z.number().nonnegative(),
});
export const MonthlyNormals = z.object({
  /** Twelve, January first — or fewer, when the source had no value for a month. */
  months: z.array(MonthlyNormal),
  period: z.object({ fromYear: z.number().int(), throughYear: z.number().int() }),
});
export type MonthlyNormals = z.infer<typeof MonthlyNormals>;

export interface Forecast {
  forecast(at: RoundedPoint, prior?: CacheValidators): Promise<Fetched<ForecastSeries>>;
}

export interface Climate {
  normals(at: RoundedPoint): Promise<Fetched<MonthlyNormals>>;
}
