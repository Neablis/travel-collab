import { z } from "zod";
import type {
  FilterDimension, ForecastDay, TripWeatherPoint, TypicalMonth, UserPreferences, WeatherSource,
} from "@tc/contracts";
import type { MacroDef, WidgetContext, WidgetInput } from "../../registry-types";
import { blockOf } from "../../registry-types";
import type { WeatherCredit, WeatherMode, WeatherPayload, WeatherRow } from "../../weatherPayload";
import { ok, empty, needsTrip, unavailable, type MacroResult } from "../../result";
import { filterInputs, filterParams } from "../../filters";
import { narrow, pinnedCity } from "../../select";
import { readSlot } from "../../external";
import { dayLabel, formatShortDate } from "../../format";

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
const WeatherParams = filterParams(WEATHER_FILTERS, {
  // Absent is shown: *"I have no idea what the columns are without a column
  // header"* (Mitchell, #221 preview) — so only turning them OFF is stored.
  headings: z.boolean().optional(),
});
type WeatherParams = z.infer<typeof WeatherParams>;

const WEATHER_INPUTS: readonly WidgetInput[] = [
  ...filterInputs(WEATHER_FILTERS),
  { name: "headings", type: "toggle", label: "Column headings", default: true },
];

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

/**
 * Decision 5: the credit text is this package's, keyed by the adapter's source id.
 *
 * `label` is what the source's data IS on the block, in a reader's words, and
 * `text` is the credit itself. The block prints them as one short line —
 * *"Forecast: Norwegian Meteorological Institute, CC BY 4.0 (updated 9:10 am)
 * · Monthly averages: NASA POWER, 2001–2020"* — because the three stacked
 * lines it replaced ("Forecast as of…", "Typical: 2001–2020 averages",
 * "Typical: NASA Langley…") read as a section of their own (Mitchell, #221
 * preview: *"I dont understand what this section is? Typical lines? are they
 * needed?"*). MET's credit keeps the institute's name and the licence, which
 * CC BY asks for; NASA's is a courtesy (ADR-052's sources table).
 */
const CREDITS: Record<WeatherSource, WeatherCredit> = {
  "met-norway": {
    source: "met-norway",
    label: "Forecast",
    text: "Norwegian Meteorological Institute, CC BY 4.0",
    href: "https://api.met.no/doc/License",
  },
  "nasa-power": { source: "nasa-power", label: "Monthly averages", text: "NASA POWER", href: null },
};

/**
 * How a reader wants temperature and rain, **derived from the account's
 * `distanceUnit`** (ADR-052, amended 2026-09-24): miles is °F and inches, km is
 * °C and mm. There is no temperature setting and this adds none — an account
 * that asked for miles has asked for US units. Unloaded preferences read as
 * metric, the units the sources speak.
 */
type Units = "metric" | "imperial";
const unitsOf = (user: UserPreferences | null): Units => (user?.distanceUnit === "mi" ? "imperial" : "metric");

// `Math.round` alone prints "-0°" for -0.4, which reads as a typo.
const degrees = (c: number, units: Units) => `${Math.round(units === "imperial" ? (c * 9) / 5 + 32 : c) || 0}°`;

// Inches to two places, since a tenth of an inch is 2.5 mm and would print most
// days' rain as 0.0 or 0.1. A trace that rounds to nothing says so, where a
// millimetre figure would have shown it as a number.
function rainAmount(mm: number, units: Units): string {
  if (units === "metric") return `${mm.toFixed(1)} mm`;
  const inches = mm / 25.4;
  return mm > 0 && inches < 0.005 ? "<0.01 in" : `${inches.toFixed(2)} in`;
}

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

function typicalValues(typical: TypicalMonth, units: Units) {
  return {
    now: null, high: degrees(typical.highC, units), low: degrees(typical.lowC, units),
    rain: `${rainAmount(typical.precipitationMmPerDay, units)} a day`, sky: null,
  };
}

function forecastValues(day: ForecastDay, units: Units) {
  return {
    now: null, high: degrees(day.highC, units), low: degrees(day.lowC, units),
    rain: rainAmount(day.precipitationMm, units), sky: skyInWords(day.symbol),
  };
}

/**
 * Today: now, and the rest of the day. The server cut `hours` to the ones not
 * yet gone when it answered, so the first is "now" and the rest are the rest of
 * the day. With no hours left, the day's own figures stand.
 */
function todayValues(day: ForecastDay, units: Units) {
  const [first] = day.hours;
  if (first === undefined) return forecastValues(day, units);
  const temps = day.hours.map((h) => h.tempC);
  return {
    now: degrees(first.tempC, units), high: degrees(Math.max(...temps), units), low: degrees(Math.min(...temps), units),
    rain: rainAmount(day.hours.reduce((sum, h) => sum + h.precipitationMm, 0), units),
    sky: skyInWords(first.symbol ?? day.symbol),
  };
}

function rowOf(point: TripWeatherPoint, mode: WeatherMode, dayIndex: number, units: Units): WeatherRow {
  const base = {
    key: `${dayIndex}:${point.city ?? ""}`,
    label: dayLabel(dayIndex),
    date: formatShortDate(point.date) ?? point.date,
    city: point.city,
    mode,
  };
  const typical = "unavailable" in point.typical ? null : point.typical;
  const forecast = "unavailable" in point.forecast ? null : point.forecast;
  const month = MONTHS[(typical?.month ?? Number(point.date.slice(5, 7))) - 1];
  switch (mode) {
    case "forecast":
      return { ...base, modeText: "Forecast", ...forecastValues(forecast!, units) };
    case "today":
      return { ...base, modeText: "Today", ...todayValues(forecast!, units) };
    case "typical":
      // "November average", not "Typical for November": what the numbers ARE,
      // in words a reader needs no footer for (Mitchell, #221 preview).
      return { ...base, modeText: `${month} average`, ...typicalValues(typical!, units) };
    case "past":
      // Qualifier first and short: the column can be ~48px, and a truncated
      // "November average (pa…" hid the one word that told the rows apart.
      return { ...base, modeText: `Past day · ${month!.slice(0, 3)} avg`, ...typicalValues(typical!, units) };
    case "no-forecast":
      return { ...base, modeText: `No forecast · ${month!.slice(0, 3)} avg`, ...typicalValues(typical!, units) };
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
 * The order of answers: a trip first; then **a trip with no days**, which is
 * `empty` with the fix before anything else is read — the one piece of trip
 * data allowed ahead of the ADR's order, because no answer the source could
 * give changes it; then the ADR's slot (`pending` / `failed` are
 * `unavailable`, never `empty` — the world's failure is not the author's);
 * then the reader's date (unknown is `pending`: the mode cannot be chosen
 * yet). Only after those does the rest of the trip speak: a day with no
 * located stop has no point, which is `empty` with the fix, because that one
 * the author CAN fix.
 */
export const dayWeather: MacroDef<WeatherParams, WeatherPayload> = {
  name: "day.weather", title: "Weather", shape: "block",
  params: WeatherParams, inputs: WEATHER_INPUTS,
  selection: { entity: "day", filters: WEATHER_FILTERS },
  needs: ["weather"],
  description:
    "The weather for each selected day at its stops: the forecast when the day is close, what's typical for the month when it is further out or already gone, each labelled. Filter it to a day or a city.",
  emptyText: "add a place to a stop to see this",
  // Fixed, never computed (ADR-037 decision 5) — the ADR's own wording.
  preview: "The weather for each day — the forecast when there is one, what's typical when there isn't.",
  resolve: ({ trip, globals, today, external, user }: WidgetContext, params, item): MacroResult<WeatherPayload> => {
    if (!trip) return needsTrip();
    // A trip with no days has nothing to ask the source about, and the author
    // can fix that — so it says so before the slot is read. The client still
    // requests (`useExternalInputs` keys on the widget, not the trip), but the
    // server answers zero points without an upstream call, so "loading
    // weather" here would only be a beat of waiting for an answer already
    // known to be empty.
    if (trip.days.length === 0) return empty("add a day to see this");
    const selection = narrow(trip, globals, params, item);
    if (selection.status !== "ok") return selection;
    const slot = readSlot(external, "weather");
    if (slot.status !== "ok") return slot;
    if (today === null) return unavailable("pending");

    const city = pinnedCity(selection.value, item);
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
        if (city !== undefined && point.city !== city) continue;
        picked.push({ point, mode: weatherModeOf(point, today), index });
      }
    }
    if (picked.length === 0) return undated ? empty("set the trip's dates to see this") : empty("add a place to a stop to see this");
    // Every row empty-handed is the source being down, not a quiet block.
    if (picked.every(({ mode }) => mode === "unavailable")) return unavailable("source");
    const units = unitsOf(user);
    const rows = picked.map(({ point, mode, index }) => rowOf(point, mode, index, units));

    // The OLDEST as-of shown: a stale row served after a failed revalidation
    // is older than its neighbours, and the line must not flatter it.
    const asOfs: string[] = [];
    const periods = new Set<string>();
    for (const { point, mode } of picked) {
      if (USES_FORECAST.has(mode) && !("unavailable" in point.forecast)) asOfs.push(point.forecast.asOf);
      if (USES_TYPICAL.has(mode) && !("unavailable" in point.typical)) {
        periods.add(`${point.typical.period.fromYear}–${point.typical.period.throughYear}`);
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
      headings: params.headings !== false,
      summary: `Weather for ${shown} of ${rows.length} ${rows.length === 1 ? "place-day" : "place-days"}.`,
    });
  },
  render: blockOf,
};
