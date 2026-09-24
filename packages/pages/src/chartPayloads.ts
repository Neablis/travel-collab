import type { ActivityTag } from "@tc/contracts";

// What a CHART widget resolves to (M14 link 11). Kept out of `registry-types.ts`
// so the chart payloads can grow without every block widget's branch editing
// one file; `BlockPayload` names them from there like any other member.
//
// Numbers where the chart needs geometry, strings where a person reads text.
// A block component has no formatter of its own (see `ItineraryDayPayload`), so
// every label a reader sees — the axis ticks included — is formatted here, and
// the component only places them.

/** A stack in "Spend by day": one per tag, plus the stops that carry none. */
export type SpendSeriesKey = ActivityTag | "untagged";

export interface SpendByDayBar {
  /** "Day 3" — a trip ordinal, counting from 1. */
  label: string;
  /** Display-ready, or `null` for an undated day. */
  date: string | null;
  /** Minor units, trip currency, per stack. A key with no spend is 0, never absent. */
  amounts: Record<SpendSeriesKey, number>;
  /** The bar's height as a reader says it; `null` for a day nothing is priced on. */
  total: string | null;
  /** The stacks in words — "Meal $40.00, Lodging $200.00" — for the table a screen reader gets. */
  breakdown: string | null;
}

export interface SpendByDayPayload {
  kind: "spend-by-day";
  /** The stacks that carry any spend, in `ActivityTag` order and then untagged. */
  series: { key: SpendSeriesKey; label: string }[];
  /** One per selected day, in trip order — zero days included, so the run of days is the trip's. */
  days: SpendByDayBar[];
  /** The trip's budget spread evenly over its days; `null` without a budget. */
  budgetPerDay: { amountMinor: number; text: string } | null;
  /** The value axis, from 0 to at least the tallest bar and the budget line. */
  ticks: { value: number; text: string }[];
  /** One sentence a screen reader gets in place of the picture. */
  summary: string;
  /** What the chart leaves out and says so: other currencies, unscheduled stops. `null` when nothing. */
  notCharted: string | null;
}
