import type { Location, Money, ValueKind } from "@tc/contracts";
import { enumLabel } from "./enumLabels";
import { formatDate, formatMoney } from "./format";

// One formatter per value kind — M14 field widget, build step 3 (gap 3 of the
// 2026-09-24 review). A generic field widget picks how to print a value by its
// manifest `valueKind` and nothing else, so this table is the whole of that
// decision.
//
// **Exhaustive by construction.** Both the value map and the table are keyed by
// `ValueKind`, so a kind added to `VALUE_KINDS` fails to compile here until it
// has a value type, a formatter, a ghost and an "All" rule — rather than
// reaching a field widget as a lookup that misses at render time.

/** The runtime shape of one value of each kind, as a resolver hands it over. */
export interface KindValues {
  /** A `Money`, or a bare integer in the trip's currency (`costSubtotal`). */
  money: Money | number;
  /** `yyyy-mm-dd`. */
  date: string;
  count: number;
  text: string;
  /** Whole minutes — the unit a `timeWindow`'s end minus its start is in. */
  duration: number;
  enum: string;
  location: Location;
  /** A trip day's index, counting from 0 — printed counting from 1. */
  day: number;
}

export interface KindContext {
  /** The trip's currency: what a bare integer amount is denominated in. */
  currency: string;
}

export interface CollapseOptions {
  /**
   * Drop repeated values, keeping each one's first appearance. Only a listing
   * collapse (text, enum, location) has repeats to drop; a sum or a span means
   * the same with or without it, so it is ignored there.
   */
  distinct?: boolean;
}

export interface KindFormat<V> {
  format(value: V, ctx: KindContext): string;
  /**
   * The Editing-mode ghost: the SHAPE of a formatted value, never a value
   * (notebook-widget-framework spec, "a ghost is shape-true and never
   * value-true"). No digits, so it cannot be read as a fact in any locale.
   */
  ghost: string;
  /**
   * The "All" rule — one display string for a field read across many items.
   * `null` for no values, so the caller shows its empty state rather than a
   * total of nothing that reads as `$0.00`.
   */
  collapse(values: readonly V[], ctx: KindContext, opts?: CollapseOptions): string | null;
  /**
   * Whether `CollapseOptions.distinct` changes `collapse` — true only for the
   * listing kinds. The editor offers "Remove duplicates" by this flag, and
   * `kinds.test.ts` checks it against what `collapse` does for every kind.
   */
  distinct: boolean;
}

export type KindFormats = { [K in ValueKind]: KindFormat<KindValues[K]> };

const LIST_SEPARATOR = ", ";

const countFormat = new Intl.NumberFormat("en-US");

function sum(values: readonly number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

function toMoney(value: Money | number, ctx: KindContext): Money {
  return typeof value === "number" ? { amountMinor: value, currency: ctx.currency } : value;
}

const dayName = (index: number): string => `Day ${index + 1}`;

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

// Text, enum and location: "All stops" lists every value, long or not
// (Mitchell's answer 3, 2026-09-24), and `distinct` collapses repeats. Repeats
// are judged on the printed string — two pins with one name read as the same
// place to the person reading the page.
function listing<V>(format: (value: V, ctx: KindContext) => string): Pick<KindFormat<V>, "collapse" | "distinct"> {
  return {
    collapse: (values, ctx, opts) => {
      if (values.length === 0) return null;
      const printed = values.map((v) => format(v, ctx));
      return (opts?.distinct ? [...new Set(printed)] : printed).join(LIST_SEPARATOR);
    },
    distinct: true,
  };
}

export const VALUE_KIND_FORMATS: KindFormats = {
  money: {
    format: (value, ctx) => {
      const { amountMinor, currency } = toMoney(value, ctx);
      return formatMoney(amountMinor, currency);
    },
    ghost: "$XXX",
    // Summed per currency and joined with " + ". There are no exchange rates in
    // a pure package (Invariant 4), and one number made by adding yen to
    // dollars is a wrong number. The trip's currency leads and the rest follow
    // by code, so the result does not depend on the order of the stops.
    collapse: (values, ctx) => {
      if (values.length === 0) return null;
      const totals = new Map<string, number>();
      for (const v of values) {
        const { amountMinor, currency } = toMoney(v, ctx);
        totals.set(currency, (totals.get(currency) ?? 0) + amountMinor);
      }
      const rank = (c: string) => (c === ctx.currency ? "" : c);
      return [...totals]
        .sort(([a], [b]) => rank(a).localeCompare(rank(b)))
        .map(([currency, amountMinor]) => formatMoney(amountMinor, currency))
        .join(" + ");
    },
    distinct: false,
  },
  date: {
    format: (value) => formatDate(value),
    // Shape-true to `formatDate`'s own output ("Aug 1, 2026"). The spec's
    // `Ddd Mmm N` assumes a weekday this formatter does not print.
    ghost: "Mmm N, YYYY",
    // Earliest to latest. `yyyy-mm-dd` sorts as a string, so no Date is built.
    collapse: (values) => {
      if (values.length === 0) return null;
      const sorted = [...values].sort();
      const first = sorted[0]!;
      const last = sorted[sorted.length - 1]!;
      return first === last ? formatDate(first) : `${formatDate(first)} – ${formatDate(last)}`;
    },
    distinct: false,
  },
  count: {
    format: (value) => countFormat.format(value),
    ghost: "NN",
    collapse: (values) => (values.length === 0 ? null : countFormat.format(sum(values))),
    distinct: false,
  },
  text: {
    format: (value) => value,
    ghost: "———",
    ...listing((value) => value),
  },
  duration: {
    format: (value) => formatDuration(value),
    ghost: "Nh NNm",
    collapse: (values) => (values.length === 0 ? null : formatDuration(sum(values))),
    distinct: false,
  },
  enum: {
    // By label ("Holding", not "hold"), from the one map the board reads too.
    format: (value) => enumLabel(value),
    ghost: "———",
    ...listing(enumLabel),
  },
  location: {
    format: (value) => value.name,
    ghost: "———",
    ...listing((value) => value.name),
  },
  // "Day 3" for index 2: the day a person reads, never the stored index (a
  // sentence's "Trip day" printed "0" on the first day, #221 preview). Many
  // days list in trip order, each once — a day is not a quantity to sum.
  day: {
    format: dayName,
    ghost: "Day N",
    collapse: (values) =>
      values.length === 0 ? null : [...new Set(values)].sort((a, b) => a - b).map(dayName).join(LIST_SEPARATOR),
    distinct: false,
  },
};

/** One value of `kind`, formatted for display — the table's `format`, typed by kind. */
export function formatKind<K extends ValueKind>(kind: K, value: KindValues[K], ctx: KindContext): string {
  return VALUE_KIND_FORMATS[kind].format(value, ctx);
}

/**
 * A `list: true` field: `valueKind` names the element (contracts CHANGELOG,
 * 2026-09-24), so a list prints as its elements' formats, joined.
 */
export function formatKindList<K extends ValueKind>(
  kind: K,
  values: readonly KindValues[K][],
  ctx: KindContext,
  opts?: CollapseOptions,
): string {
  const { format, distinct } = VALUE_KIND_FORMATS[kind];
  const printed = values.map((v) => format(v, ctx));
  // One stop's list can repeat itself (`tags` is an array, not a set), and
  // "Remove duplicates" is offered for it, so it has to mean the same here as
  // across stops (CodeRabbit, PR #226).
  return (opts?.distinct && distinct ? [...new Set(printed)] : printed).join(LIST_SEPARATOR);
}

/**
 * Many values of `kind` reduced to one display string — the "All" rule
 * (sum, span, or every value with optional `distinct`); `null` when there are none.
 */
export function collapseKind<K extends ValueKind>(
  kind: K,
  values: readonly KindValues[K][],
  ctx: KindContext,
  opts?: CollapseOptions,
): string | null {
  return VALUE_KIND_FORMATS[kind].collapse(values, ctx, opts);
}
