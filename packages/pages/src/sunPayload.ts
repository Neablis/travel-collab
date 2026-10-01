// What `day.sun` resolves to (M14 link 11). Its own file for `weatherPayload.ts`'
// reason: the block's payload can grow without every other block widget's
// branch editing `registry-types.ts`.
//
// One set of rows serves both views. Each carries the strings a reader sees,
// display-ready as every block payload's are, and beside them the MINUTES the
// graphic draws from — the day's local clock as a number, on one axis shared
// by every row.

import type { WidgetView } from "./widgetView";

/** A day with a sunrise and a sunset, or one the sun spends wholly above or below the horizon. */
export type SunState = "normal" | "up-all-day" | "down-all-day";

export interface SunAxisTick {
  minute: number;
  /** In the reader's clock, short enough to sit over a narrow axis: "6a" / "noon", or "06" / "12". */
  label: string;
}

/** One clock shared by every row, so a ribbon in one row means what it does in the next. */
export interface SunAxis {
  /** Local minutes after the day's midnight; whole hours. */
  startMinute: number;
  endMinute: number;
  ticks: SunAxisTick[];
}

export interface SunRow {
  /** The day's index — stable per day, for React. */
  key: string;
  /** "Day 3" — a trip ordinal, counting from 1. */
  label: string;
  city: string | null;
  state: SunState;
  /**
   * Local minutes after THIS day's midnight; may pass 1440 (a sunset the next
   * morning) or be negative. `null` unless `state` is `"normal"`.
   */
  sunriseMinute: number | null;
  sunsetMinute: number | null;
  /** Clock labels in the reader's format, keeping "(next day)" / "(day before)". `null` unless `"normal"`. */
  sunrise: string | null;
  sunset: string | null;
  /** What a polar day says where its sunrise would be: "sun up all day" / "sun down all day". `null` when `"normal"`. */
  words: string | null;
  /** "12h 47m"; "24h" for up-all-day, "0h" for down-all-day. */
  daylight: string;
  /**
   * Where the morning golden hour ends and the evening one starts; `null` when
   * the sun never crosses six degrees on that side of the day. A sun up all day
   * can still carry them (it dips that low without setting); its ribbon has no
   * end to draw them at, so the graphic leaves them out.
   */
  goldenMorningEndMinute: number | null;
  goldenEveningStartMinute: number | null;
}

export interface SunPayload {
  kind: "sun";
  /** The widget's `view` param, the graphic unless the author chose the table. */
  view: WidgetView;
  /** Shared by every row's ribbon. */
  axis: SunAxis;
  rows: SunRow[];
  /** The block in one sentence, for its accessible name. */
  summary: string;
}
