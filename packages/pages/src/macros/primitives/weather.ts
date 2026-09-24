import { z } from "zod";
import type { FilterDimension, ForecastDay, TripWeatherPoint, TypicalMonth, WeatherSource } from "@tc/contracts";
import type { MacroDef, WidgetContext } from "../../registry-types";
import { blockOf } from "../../registry-types";
import type { WeatherCredit, WeatherMode, WeatherPayload, WeatherRow } from "../../weatherPayload";
import { ok, empty, needsTrip, unavailable, type MacroResult } from "../../result";
import { filterInputs, filterParams } from "../../filters";
import { narrow } from "../../select";
import { readSlot } from "../../external";
import { formatShortDate } from "../../format";

// `day.weather` — "Weather" (M14 link 11), the first widget whose data the trip
// does not hold. ADR-052 is the design; this file is its decisions 3 to 5 and 7.
//
// **The data arrives pre-fetched** in `ctx.external.weather` (decision 3): the
// server fetched it, rounded, cached and normalized, and this resolver stays
// pure and synchronous. **The MODE is chosen here, from `ctx.today`**, because
// the reader's calendar day is only knowable on the client, and a pure choice
// is one a unit test can pin (`weather.test.ts` holds the table row by row,
// `weather.property.test.ts` for every date).
//
// A day primitive with `day.sun`'s filters, so "the weather on day 3" and "the
// weather in Kyoto" are bindings, not widgets.

const WEATHER_FILTERS = ["day", "city", "dates"] as const satisfies readonly FilterDimension[];
const WeatherParams = filterParams(WEATHER_FILTERS);
type WeatherParams = z.infer<typeof WeatherParams>;

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

/**
 * Decision 3's table, for one (day, city) against the reader's date.
 *
 * The horizon is not a constant here: the server marks a date the forecast
 * does not fully cover `not-in-horizon`, so "beyond the last full day" is read
 * from MET's data, not guessed. A date before today is typical even when a
 * forecast is in hand — yesterday's forecast is not what it was either
 * (Mitchell, 2026-09-24). A forecast that FAILED inside the horizon falls back
 * to typical, labelled: a labelled typical is true, and a missing forecast is
 * not a reason to show nothing (review point 4).
 */
export function weatherModeOf(point: TripWeatherPoint, today: string): WeatherMode {
  const hasTypical = !("unavailable" in point.typical);
  if (point.date < today) return hasTypical ? "past" : "unavailable";
  if (!("unavailable" in point.forecast)) return point.date === today ? "today" : "forecast";
  if (!hasTypical) return "unavailable";
  return point.forecast.unavailable === "not-in-horizon" && point.date > today ? "typical" : "no-forecast";
}

/** Decision 5: the credit text is this package's, keyed by the adapter's source id. */
const CREDITS: Record<WeatherSource, WeatherCredit> = {
  "met-norway": {
    source: "met-norway",
    text: "Forecast: The Norwegian Meteorological Institute (MET Norway), CC BY 4.0",
    href: "https://api.met.no/doc/License",
  },
  // A courtesy NASA requests rather than a licence condition — ADR-052's
  // sources table marks the terms as still to verify.
  "nasa-power": { source: "nasa-power", text: "Typical: NASA Langley Research Center POWER Project", href: null },
};

// `Math.round` alone prints "-0°" for -0.4, which reads as a typo.
const degrees = (c: number) => `${Math.round(c) || 0}°`;
const millimetres = (mm: number) => `${mm.toFixed(1)} mm`;

/**
 * MET's `symbol_code` in words: `lightrainshowersandthunder_day` → "Light rain
 * showers and thunder". The code is a closed vocabulary of run-together words
 * with a day/night/polar-twilight suffix; unpicking the joins covers all of it
 * without a table of forty entries to keep in step with MET's.
 */
export function skyInWords(symbol: string | null): string | null {
  if (!symbol) return null;
  const words = symbol
    .replace(/_(day|night|polartwilight)$/, "")
    .replace("clearsky", "clear sky")
    .replace("partlycloudy", "partly cloudy")
    .replace(/^(light|heavy)(?=\S)/, "$1 ")
    .replace(/(rain|sleet|snow)showers/, "$1 showers")
    .replace(/(\S)andthunder$/, "$1 and thunder");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function typicalValues(typical: TypicalMonth) {
  return {
    now: null, high: degrees(typical.highC), low: degrees(typical.lowC),
    rain: `${millimetres(typical.precipitationMmPerDay)} a day`, sky: null,
  };
}

function forecastValues(day: ForecastDay) {
  return {
    now: null, high: degrees(day.highC), low: degrees(day.lowC),
    rain: millimetres(day.precipitationMm), sky: skyInWords(day.symbol),
  };
}

/**
 * Today: now, and the rest of the day. The server cut `hours` to the ones not
 * yet gone when it answered, so the first is "now" and the rest are the rest of
 * the day. With no hours left, the day's own figures stand.
 */
function todayValues(day: ForecastDay) {
  const [first] = day.hours;
  if (first === undefined) return forecastValues(day);
  const temps = day.hours.map((h) => h.tempC);
  return {
    now: degrees(first.tempC), high: degrees(Math.max(...temps)), low: degrees(Math.min(...temps)),
    rain: millimetres(day.hours.reduce((sum, h) => sum + h.precipitationMm, 0)),
    sky: skyInWords(first.symbol ?? day.symbol),
  };
}

function rowOf(point: TripWeatherPoint, mode: WeatherMode, dayIndex: number): WeatherRow {
  const base = {
    key: `${dayIndex}:${point.city ?? ""}`,
    label: `Day ${dayIndex + 1}`,
    date: formatShortDate(point.date) ?? point.date,
    city: point.city,
    mode,
  };
  const typical = "unavailable" in point.typical ? null : point.typical;
  const forecast = "unavailable" in point.forecast ? null : point.forecast;
  const month = MONTHS[(typical?.month ?? Number(point.date.slice(5, 7))) - 1];
  switch (mode) {
    case "forecast":
      return { ...base, modeText: "Forecast", ...forecastValues(forecast!) };
    case "today":
      return { ...base, modeText: "Today", ...todayValues(forecast!) };
    case "typical":
      return { ...base, modeText: `Typical for ${month}`, ...typicalValues(typical!) };
    case "past":
      return { ...base, modeText: `Typical for ${month} — not what it was`, ...typicalValues(typical!) };
    case "no-forecast":
      return { ...base, modeText: `Typical for ${month} — no forecast right now`, ...typicalValues(typical!) };
    case "unavailable":
      return { ...base, modeText: "Weather unavailable", now: null, high: null, low: null, rain: null, sky: null };
    default: {
      const exhaustive: never = mode;
      return exhaustive;
    }
  }
}

const USES_FORECAST: ReadonlySet<WeatherMode> = new Set(["forecast", "today"]);
const USES_TYPICAL: ReadonlySet<WeatherMode> = new Set(["typical", "past", "no-forecast"]);

/**
 * `day.weather` — one row per selected (day, city): the forecast when there is
 * one, what's typical when there isn't, and the mode said in words either way.
 *
 * The order of answers is the ADR's: a trip first, then the slot (`pending` /
 * `failed` are `unavailable`, never `empty` — the world's failure is not the
 * author's), then the reader's date (unknown is `pending`: the mode cannot be
 * chosen yet). Only after all three does trip data speak: a day with no located
 * stop has no point, which is `empty` with the fix, because that one the author
 * CAN fix.
 */
export const dayWeather: MacroDef<WeatherParams, WeatherPayload> = {
  name: "day.weather", title: "Weather", shape: "block",
  params: WeatherParams, inputs: filterInputs(WEATHER_FILTERS),
  selection: { entity: "day", filters: WEATHER_FILTERS },
  needs: ["weather"],
  description:
    "The weather for each selected day at its stops: the forecast when the day is close, what's typical for the month when it is further out or already gone, each labelled. Filter it to a day or a city.",
  emptyText: "no place on this day",
  // Fixed, never computed (ADR-037 decision 5) — the ADR's own wording.
  preview: "The weather for each day — the forecast when there is one, what's typical when there isn't.",
  resolve: ({ trip, globals, today, external }: WidgetContext, params, item): MacroResult<WeatherPayload> => {
    if (!trip) return needsTrip();
    const selection = narrow(trip, globals, params, item);
    if (selection.status !== "ok") return selection;
    const slot = readSlot(external, "weather");
    if (slot.status !== "ok") return slot;
    if (today === null) return unavailable("pending");

    let undated = false;
    const picked: { point: TripWeatherPoint; mode: WeatherMode; index: number }[] = [];
    for (const index of selection.value.days) {
      const date = trip.days[index]!.date;
      if (date === null) {
        undated = true;
        continue;
      }
      for (const point of slot.value.points) {
        if (point.date !== date) continue;
        if (params.city !== undefined && point.city !== params.city) continue;
        picked.push({ point, mode: weatherModeOf(point, today), index });
      }
    }
    if (picked.length === 0) return undated ? empty("set the trip's dates to see this") : empty("no place on this day");
    // Every row empty-handed is the source being down, not a quiet block.
    if (picked.every(({ mode }) => mode === "unavailable")) return unavailable("source");
    const rows = picked.map(({ point, mode, index }) => rowOf(point, mode, index));

    // The OLDEST as-of shown: a stale row served after a failed revalidation
    // is older than its neighbours, and the line must not flatter it.
    const asOfs: string[] = [];
    const periods = new Set<string>();
    for (const { point, mode } of picked) {
      if (USES_FORECAST.has(mode) && !("unavailable" in point.forecast)) asOfs.push(point.forecast.asOf);
      if (USES_TYPICAL.has(mode) && !("unavailable" in point.typical)) {
        periods.add(`${point.typical.period.fromYear}–${point.typical.period.throughYear} averages`);
      }
    }
    asOfs.sort((a, b) => Date.parse(a) - Date.parse(b));
    const credits: WeatherCredit[] = [];
    if (asOfs.length > 0) credits.push(CREDITS["met-norway"]);
    if (periods.size > 0) credits.push(CREDITS["nasa-power"]);

    const shown = rows.filter((row) => row.mode !== "unavailable").length;
    return ok({
      kind: "weather",
      rows,
      forecastAsOf: asOfs[0] ?? null,
      typicalPeriod: [...periods][0] ?? null,
      credits,
      summary: `Weather for ${shown} of ${rows.length} ${rows.length === 1 ? "place-day" : "place-days"}.`,
    });
  },
  render: blockOf,
};
