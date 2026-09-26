import type { ActivityKind, ActivityTag } from "@tc/contracts";

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
  /** "Day 3" — a trip ordinal, counting from 1. The hover's title and the table's row. */
  label: string;
  /** "3rd" — the same ordinal, short enough for the axis under a narrow bar. */
  tick: string;
  /** Display-ready, or `null` for an undated day. */
  date: string | null;
  /** Minor units, trip currency, per stack. A key with no spend is 0, never absent. */
  amounts: Record<SpendSeriesKey, number>;
  /** The bar's height as a reader says it; `null` for a day nothing is priced on. */
  total: string | null;
  /** The stacks in words — "Meal $40.00, Lodging $200.00" — for the table a screen reader gets. */
  breakdown: string | null;
  /** The same stacks one by one, for the hover's line per stack. Only the ones with spend. */
  parts: { key: SpendSeriesKey; label: string; text: string }[];
}

/** One day of the burn-down: everything through it, against the budget. */
export interface BurnDownDay {
  /** Minor units per stack, summed from the first charted day through this one. */
  cumulative: Record<SpendSeriesKey, number>;
  /** The running total as a reader says it. */
  spentSoFar: string;
  /** Budget minus the running total, minor units — negative once over; `null` without a budget. */
  leftMinor: number | null;
  /** "$250.00 left" or "$50.00 over"; `null` without a budget. */
  left: string | null;
  /** What an even pace would leave after this TRIP day, minor units; `null` without a budget. */
  paceMinor: number | null;
  /** `paceMinor` as a reader says it. */
  pace: string | null;
  /** Less is left than the even pace would leave. Always `false` without a budget. */
  overPace: boolean;
}

export interface SpendBurnDown {
  budget: { amountMinor: number; text: string } | null;
  /** One per entry of `SpendByDayPayload.days`, in the same order. */
  days: BurnDownDay[];
  /** Said in words under the chart when there is no budget to burn down; `null` when there is one. */
  note: string | null;
}

export interface SpendByDayPayload {
  kind: "spend-by-day";
  /** The widget's `view` param: a bar per day, or the running total burning the budget down. */
  view: "bars" | "burndown";
  /** `null` for the bars. */
  burnDown: SpendBurnDown | null;
  /** The stacks that carry any spend, in `ActivityTag` order and then untagged. */
  series: { key: SpendSeriesKey; label: string }[];
  /** One per selected day, in trip order — zero days included, so the run of days is the trip's. */
  days: SpendByDayBar[];
  /** The trip's budget spread evenly over its days; `null` without a budget. */
  budgetPerDay: { amountMinor: number; text: string } | null;
  /** The value axis, from 0 to at least the tallest bar (or most spent, burning down) and the budget line. */
  ticks: { value: number; text: string }[];
  /** One sentence a screen reader gets in place of the picture. */
  summary: string;
  /** What the chart leaves out and says so: other currencies, unscheduled stops. `null` when nothing. */
  notCharted: string | null;
}

/** What "Spend by kind" / "Spend by tag" splits the money by: `cost.breakdown`'s `by`. */
export type SpendBreakdownBy = "kind" | "tag";

/** One slice of a spend breakdown: a wedge of the donut and a row of its key. */
export interface SpendBreakdownSlice<K extends string = ActivityKind | SpendSeriesKey> {
  /** The kind, or the tag (or "untagged") the slice is. */
  key: K;
  /** The board's word for it — "Travel", never "transit"; "Meal", "Untagged". */
  label: string;
  /** Minor units, trip currency. 0 for a slice nothing priced is on. */
  amountMinor: number;
  /** `amountMinor` as a reader says it; `null` when it is 0. */
  amount: string | null;
  /**
   * "60%" of the charted total, "<1%" for a sliver; `null` when `amount` is.
   * Apportioned across the slices (`shares.ts`), so the percents add up to 100.
   */
  share: string | null;
}

interface SpendBreakdownCommon {
  kind: "spend-breakdown";
  /**
   * What the widget is, and what it is narrowed to on the other dimension:
   * "Spend by kind", "Spend by kind · Meal", "Spend by tag · Pending". It names
   * the key's table, so a screen reader hears the narrowing too.
   */
  title: string;
  /** The key's first column heading: what a slice is — "Kind", "Tag". */
  keyHeading: string;
  /** Everything charted, in the trip's currency. */
  total: string;
  /** One sentence a screen reader gets in place of the picture. */
  summary: string;
  /** What the pie leaves out and says so: other currencies. `null` when nothing. */
  notCharted: string | null;
}

/**
 * "Spend by kind" or "Spend by tag". Every slice of the dimension, in its
 * contract order, zeroes included: the key lists the slices nothing priced is
 * on as well, and the pie draws only non-zero ones.
 */
export type SpendBreakdownPayload = SpendBreakdownCommon &
  (
    | { by: "kind"; slices: SpendBreakdownSlice<ActivityKind>[] }
    | { by: "tag"; slices: SpendBreakdownSlice<SpendSeriesKey>[] }
  );
