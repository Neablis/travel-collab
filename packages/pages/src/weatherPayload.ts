import type { WeatherSource } from "@tc/contracts";

// What `day.weather` resolves to (M14 link 11, ADR-052). Its own file for
// `chartPayloads.ts`' reason: the block's payload can grow without every other
// block widget's branch editing `registry-types.ts`.
//
// Every value a reader sees is display-ready here, as every block payload's is;
// the two exceptions are INSTANTS (`forecastAsOf`), which the block component
// formats in the reader's own time zone — the one thing this package cannot
// know (ADR-052 decision 7).

/**
 * Which of decision 3's rows a (day, city) landed on.
 *
 * `past` and `no-forecast` are both "typical", told apart because their words
 * differ: a day already gone is *"not what it was"*, and a forecast that did not
 * answer inside the horizon is typical rather than nothing (review point 4).
 */
export type WeatherMode = "forecast" | "today" | "typical" | "past" | "no-forecast" | "unavailable";

export interface WeatherRow {
  /** Stable per (day, city), for React. */
  key: string;
  /** "Day 3" — a trip ordinal, counting from 1. */
  label: string;
  /** Display-ready ("Nov 13"). */
  date: string;
  city: string | null;
  mode: WeatherMode;
  /** The mode in words, always — the gate box's "each naming its mode in words". */
  modeText: string;
  /** Today only: the first hour still to come. */
  now: string | null;
  high: string | null;
  low: string | null;
  /** "2.1 mm" for a forecast; "3.5 mm a day" for typical, which is an amount and never a chance. */
  rain: string | null;
  /** The forecast's sky in words; `null` for typical, which has none. */
  sky: string | null;
}

export interface WeatherCredit {
  source: WeatherSource;
  text: string;
  /** A fixed URL from this package, never one from fetched data (decision 5). */
  href: string | null;
}

export interface WeatherPayload {
  kind: "weather";
  rows: WeatherRow[];
  /** The OLDEST forecast as-of among the rows shown, ISO; `null` when no row shows a forecast. */
  forecastAsOf: string | null;
  /** "2001–2020 averages" when a row shows typical; `null` otherwise. */
  typicalPeriod: string | null;
  /** One per source whose data is on the block, forecast first. */
  credits: WeatherCredit[];
  /** The block in one sentence, for its accessible name. */
  summary: string;
}
