import { z } from "zod";
import type { FilterDimension } from "@tc/contracts";
import { ActivityKind } from "@tc/contracts";
import type { MacroDef, WidgetContext, WidgetInput, WidgetSelection } from "../../registry-types";
import { blockOf } from "../../registry-types";
import type { SpendBreakdownBy, SpendBreakdownPayload, SpendBreakdownSlice } from "../../chartPayloads";
import { ok, empty, needsTrip, type MacroResult } from "../../result";
import { filterInputs, filterParams, withoutWithheld } from "../../filters";
import { costOfStops, narrow, type Narrowed, type SelectedStop } from "../../select";
import { dayLabel, formatMoney, formatShortDate } from "../../format";
import { collapseKind } from "../../kinds";
import { KIND_LABEL, TAG_LABEL } from "../../enumLabels";
import { SPEND_SERIES, SPEND_SERIES_LABEL, seriesOf } from "./spendSeries";

// `cost.breakdown` — "Spend by kind" and "Spend by tag", a pie of what the
// selection costs split one of two ways (`by`):
//
// - **by kind** (the default): Planned, Pending, Travel. Mitchell, 2026-09-26,
//   on the Settings sheet's M19 `budget-breakdown` shell: *"Dont we have
//   everything to implement that now? … Lets remove it there, and implement it
//   as a PIE chart widget for notebooks"*. Since M28 (ADR-054) a stop's kind is
//   the three-way answer the shell was waiting on, and a cost inherits it from
//   its stop — the M19 question "does a cost carry its own kind" is answered
//   "no, the stop's", which is what `activity.ts` already argued for.
// - **by tag**: Meal, Lodging, Ticketed, Outdoors, Untagged. Mitchell, the same
//   day: *"Can #246 introduce the pie chart for spend by kind and spend by
//   tags?"* — as ONE primitive with a `by` param, renamed from `cost.byKind`
//   while nothing stored it. A stop with several tags is counted once, under
//   `seriesOf`'s first-tag rule, which is "Spend by day"'s own — shared, so the
//   pie and the bars can never file the same dinner under two tags.
//
// **A primitive of its own, not a `view` on `cost.chart`** (ADR-039 decision 1:
// a primitive is ONE entity + ONE filter list + a shape). The two share `stop`
// and nothing else that matters: a one-day pie is a perfectly good question
// ("what did Tuesday go on") where a one-day bar chart is one bar, and the
// payload shares no days, no axis and no budget line.
//
// **The filter on the slices' own dimension is withheld** (`BREAKDOWN_SELECTION`
// below): a pie split by kind and narrowed to one kind is a single slice. The
// declaration lists all five filters — the ceiling — and says which one each
// `by` withholds, so the resolver drops it (`withoutWithheld`), the settings
// panel does not offer it (`inputsFor`), and a stored `{by: "tag", tag: "meal"}`
// reads as the whole trip's tags rather than as one slice.
//
// **The same money as the other cost widgets, by construction.** It selects
// through `narrow` and sums with `costOfStops`, so with every stop in the trip's
// currency the pie's total is `cost` with the same filters, and each kind slice
// is `cost{kind}` — `spendBreakdown.test.ts` holds that for every trip, and
// that each tag slice is what "Spend by day" stacks under that tag. Its currency
// rule is `cost.chart`'s, not `cost`'s: a slice made of yen and dollars is a
// wrong slice (KI-2026-09-24-p), so other currencies are left off and named.
// Unlike the bars it has no day axis, so an unscheduled stop is simply in it.
const COST_BREAKDOWN_FILTERS = ["day", "dates", "city", "tag", "kind"] as const satisfies readonly FilterDimension[];

/**
 * The two ways to split, each with the one word the widget says for it — the
 * "Split by" option, the key's column heading, and the title's "Spend by …".
 * Keyed by `SpendBreakdownBy`, so a third split fails to compile until it has
 * its word; everything below (the param's enum, the choice's options, which
 * filter each withholds) is derived from this rather than listed again.
 *
 * The words for the SLICES are never here: they are the contract's own label
 * maps (`KIND_LABEL`, `SPEND_SERIES_LABEL` over `TAG_LABEL`), read per key, so
 * a kind or tag added to the contract reaches the pie, its key and its title
 * with no edit to this file (Mitchell, 2026-09-26: *"Use what the typescript
 * define … and should change if we add more in future"*).
 */
const SPLITS: { readonly [B in SpendBreakdownBy]: { noun: string; withholds: FilterDimension } } = {
  kind: { noun: "Kind", withholds: "kind" },
  tag: { noun: "Tag", withholds: "tag" },
};
const BY = Object.keys(SPLITS) as [SpendBreakdownBy, ...SpendBreakdownBy[]];
const DEFAULT_BY: SpendBreakdownBy = "kind";

const CostBreakdownParams = filterParams(COST_BREAKDOWN_FILTERS, {
  // Absent is "kind": the pie every stored `cost.breakdown` without it draws.
  by: z.enum(BY).optional(),
});
type CostBreakdownParams = z.infer<typeof CostBreakdownParams>;

const BREAKDOWN_SELECTION: WidgetSelection = {
  entity: "stop",
  filters: COST_BREAKDOWN_FILTERS,
  withheld: {
    param: "by",
    default: DEFAULT_BY,
    values: Object.fromEntries(BY.map((by) => [by, [SPLITS[by].withholds]])),
  },
};

const COST_BREAKDOWN_INPUTS: readonly WidgetInput[] = [
  {
    name: "by", type: "choice", label: "Split by", default: DEFAULT_BY,
    options: BY.map((by) => ({ value: by, label: SPLITS[by].noun })),
  },
  ...filterInputs(COST_BREAKDOWN_FILTERS),
];

/**
 * A slice's share of the total as a reader says it: a whole percent, and
 * "<1%" rather than "0%" for money that is there but rounds away.
 */
function shareOf(amount: number, total: number): string {
  const percent = Math.round((amount / total) * 100);
  return percent === 0 ? "<1%" : `${percent}%`;
}

/** One slice per key, zeroes included, summing the stops `belongs` files under it. */
function slicesOf<K extends string>(
  keys: readonly K[],
  label: (key: K) => string,
  belongs: (stop: SelectedStop, key: K) => boolean,
  charted: readonly SelectedStop[],
  total: number,
  currency: string,
): SpendBreakdownSlice<K>[] {
  return keys.map((key) => {
    const amountMinor = costOfStops(charted.filter((s) => belongs(s, key)));
    return {
      key,
      label: label(key),
      amountMinor,
      amount: amountMinor === 0 ? null : formatMoney(amountMinor, currency),
      share: amountMinor === 0 ? null : shareOf(amountMinor, total),
    };
  });
}

/**
 * "Spend by kind", then what it is narrowed to, each as a reader says it:
 * "Spend by kind · Meal", "Spend by tag · Pending · Kyoto · Day 3". The
 * withheld dimension never appears — it was dropped before `narrow` saw it.
 */
function titleOf(by: SpendBreakdownBy, selection: Narrowed): string {
  const { filters } = selection;
  const parts = [`Spend by ${SPLITS[by].noun.toLowerCase()}`];
  // The contract's label maps, keyed by the enums: a value added there has
  // its word here the day it compiles.
  if (filters.tag !== undefined) parts.push(TAG_LABEL[filters.tag]);
  if (filters.kind !== undefined) parts.push(KIND_LABEL[filters.kind]);
  if (filters.city !== undefined) parts.push(filters.city);
  if (filters.day !== undefined && selection.days.length === 1) parts.push(dayLabel(selection.days[0]!));
  if (filters.dates !== undefined) {
    const from = formatShortDate(filters.dates.from)!;
    const through = formatShortDate(filters.dates.through)!;
    parts.push(from === through ? from : `${from} – ${through}`);
  }
  return parts.join(" · ");
}

export const costBreakdown: MacroDef<CostBreakdownParams, SpendBreakdownPayload> = {
  name: "cost.breakdown", title: "Spend breakdown", shape: "block",
  params: CostBreakdownParams, inputs: COST_BREAKDOWN_INPUTS,
  selection: BREAKDOWN_SELECTION,
  description:
    "A pie of what the selected stops cost, split by kind (Planned, Pending, Travel) or by tag (Meal, Lodging, Ticketed, Outdoors, Untagged; a stop with several tags counts under its first), with each slice's amount and share. Filter it to a day, dates or a city, and to a tag when split by kind or a kind when split by tag.",
  // `cost.chart`'s wording: the two are the notebook's charts of the same money.
  emptyText: "no costs yet",
  // Fixed, never computed (ADR-037 decision 5): no amount, no kind. The two
  // presets carry their own.
  preview: "a pie of what the trip costs, by kind or by tag",
  resolve: ({ trip, globals }: WidgetContext, params, item): MacroResult<SpendBreakdownPayload> => {
    if (!trip) return needsTrip();
    const by: SpendBreakdownBy = params.by ?? DEFAULT_BY;
    const selection = narrow(trip, globals, withoutWithheld(BREAKDOWN_SELECTION, params), item);
    if (selection.status !== "ok") return selection;
    const { stops } = selection.value;

    const charted = stops.filter((s) => s.activity.cost?.currency === trip.currency);
    const otherCurrencies = stops.flatMap((s) =>
      s.activity.cost && s.activity.cost.currency !== trip.currency ? [s.activity.cost] : [],
    );
    const others = collapseKind("money", otherCurrencies, { currency: trip.currency });

    const total = costOfStops(charted);
    if (total === 0) return others === null ? empty() : empty(`only priced in other currencies: ${others}`);

    const title = titleOf(by, selection.value);
    const totalText = formatMoney(total, trip.currency);
    const common = {
      kind: "spend-breakdown" as const,
      title,
      keyHeading: SPLITS[by].noun,
      total: totalText,
      notCharted: others === null ? null : `Not charted: ${others} in other currencies.`,
    };
    const sentence = (slices: readonly SpendBreakdownSlice<string>[]) =>
      `${title} in ${trip.currency}: ${totalText} — ` +
      slices.filter((s) => s.amount !== null).map((s) => `${s.label} ${s.amount} (${s.share})`).join(", ") + ".";

    if (by === "tag") {
      const slices = slicesOf(SPEND_SERIES, (key) => SPEND_SERIES_LABEL[key], (s, key) => seriesOf(s) === key, charted, total, trip.currency);
      return ok({ ...common, by, slices, summary: sentence(slices) });
    }
    const slices = slicesOf(ActivityKind.options, (key) => KIND_LABEL[key], (s, key) => s.activity.kind === key, charted, total, trip.currency);
    return ok({ ...common, by, slices, summary: sentence(slices) });
  },
  render: blockOf,
};
