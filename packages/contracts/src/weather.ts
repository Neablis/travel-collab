import { z } from "zod";
import { isCalendarDate } from "./trip.ts";

// A trip's weather, as `GET /api/trips/[tripId]/weather` answers it (ADR-052
// decision 3). **Normalized, never a vendor payload** — the adapters behind the
// route (MET Norway for forecasts, NASA POWER for normals) map their own
// responses into these shapes, so swapping a vendor is zero migration here
// (ADR-007's rule, which ADR-052 decision 1 copies).
//
// The route derives the points from the trip itself and the client sends only
// the trip id, so nothing in here was chosen by the reader. It does NOT choose a
// mode (forecast / today / typical): that depends on the reader's calendar day,
// which only the client knows, and the resolver picks it from `ctx.today`.

const IsoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected a YYYY-MM-DD date")
  .refine(isCalendarDate, { message: "not a date that exists on the calendar" });

// An instant as the source reported it. `offset: true` because MET's
// `meta.updated_at` and `Last-Modified` are not guaranteed to be `Z`-suffixed.
const Instant = z.string().datetime({ offset: true });

/** Which outside service a value came from — the block maps it to credit text (ADR-052 decision 5). */
export const WeatherSource = z.enum(["met-norway", "nasa-power"]);
export type WeatherSource = z.infer<typeof WeatherSource>;

/** One hour of a forecast, for the "today" mode's "now and the rest of the day". */
export const ForecastHour = z.object({
  at: Instant,
  tempC: z.number(),
  precipitationMm: z.number().nonnegative(),
  // MET's `symbol_code` (`"clearsky_day"`, `"rain"`, …). Nullable because MET
  // omits the next-hour summary at the far end of the series.
  symbol: z.string().nullable(),
});
export type ForecastHour = z.infer<typeof ForecastHour>;

/** One local day of a forecast at one rounded point. */
export const ForecastDay = z.object({
  source: z.literal("met-norway"),
  // The model run, not our fetch time (ADR-052 decision 7). A stale row served
  // after a failed revalidation carries its own older value, which is what
  // makes serving it honest.
  asOf: Instant,
  highC: z.number(),
  lowC: z.number(),
  precipitationMm: z.number().nonnegative(),
  symbol: z.string().nullable(),
  hours: z.array(ForecastHour),
});
export type ForecastDay = z.infer<typeof ForecastDay>;

/**
 * A month's normals at one rounded point. Rainfall is an AMOUNT per day, not a
 * chance: POWER's climatology is monthly means (ADR-052 review point 5).
 */
export const TypicalMonth = z.object({
  source: z.literal("nasa-power"),
  month: z.number().int().min(1).max(12),
  highC: z.number(),
  lowC: z.number(),
  precipitationMmPerDay: z.number().nonnegative(),
  // The averaging period, printed as "2001–2020 averages" (decision 7).
  period: z.object({ fromYear: z.number().int(), throughYear: z.number().int() }),
});
export type TypicalMonth = z.infer<typeof TypicalMonth>;

/**
 * One (day, city) of the trip. A day with no located stop has no point at all —
 * that is trip data missing, which the widget reports as `empty`, not as the
 * source failing.
 *
 * `not-in-horizon` is the server declining to ask (the date is outside
 * `[UTC today − 1, UTC today + 11]`), not MET failing; `source` is MET or POWER
 * not answering, a quota refusal, or a timeout (decision 8).
 */
export const TripWeatherPoint = z.object({
  date: IsoDate,
  city: z.string().nullable(),
  forecast: z.union([ForecastDay, z.object({ unavailable: z.enum(["source", "not-in-horizon"]) })]),
  typical: z.union([TypicalMonth, z.object({ unavailable: z.literal("source") })]),
});
export type TripWeatherPoint = z.infer<typeof TripWeatherPoint>;

export const TripWeather = z.object({ points: z.array(TripWeatherPoint) });
export type TripWeather = z.infer<typeof TripWeather>;

/** The route's body: `{ weather }`, the same envelope `globals` uses. */
export const TripWeatherResponse = z.object({ weather: TripWeather });
export type TripWeatherResponse = z.infer<typeof TripWeatherResponse>;
