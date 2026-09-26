import type { z } from "zod";
import type { FilterDimension } from "@tc/contracts";
import { ActivityKind } from "@tc/contracts";
import type { MacroDef, WidgetContext } from "../../registry-types";
import { blockOf } from "../../registry-types";
import type { SpendByKindPayload, SpendByKindSlice } from "../../chartPayloads";
import { ok, empty, needsTrip, type MacroResult } from "../../result";
import { filterInputs, filterParams } from "../../filters";
import { costOfStops, narrow } from "../../select";
import { formatMoney } from "../../format";
import { collapseKind } from "../../kinds";
import { KIND_LABEL } from "../../enumLabels";

// `cost.byKind` — "Spend by kind", a pie of what the selection costs per
// `ActivityKind`: Planned, Pending, Travel. Mitchell, 2026-09-26, on the
// Settings sheet's M19 `budget-breakdown` shell: *"Dont we have everything to
// implement that now? … Lets remove it there, and implement it as a PIE chart
// widget for notebooks"*. We did: since M28 (ADR-054) a stop's kind is the
// three-way answer the shell was waiting on, and a cost inherits it from its
// stop — the M19 question "does a cost carry its own kind" is answered "no,
// the stop's", which is what `activity.ts` already argued for.
//
// **A new primitive, not a `view` on `cost.chart`** (ADR-039 decision 1: a
// primitive is ONE entity + ONE filter list + a shape). The two would share
// `stop` and nothing else that matters:
//
// - the filters differ. `cost.chart` refuses `day` because a one-day bar chart
//   is one bar; a one-day pie is a perfectly good question ("what did Tuesday
//   go on"), and `city` likewise. A primitive declares one filter list, so a
//   `view` could only offer the bars' two or force the bars to take four;
// - the kind filter is legal on the bars and meaningless here — a pie split by
//   kind and filtered to one kind is a single slice;
// - the payload shares nothing: no days, no axis, no budget line.
//
// **The same money as the other cost widgets, by construction.** It selects
// through `narrow` and sums with `costOfStops`, so with every stop in the trip's
// currency the pie's total is `cost` with the same filters, and each slice is
// `cost{kind}` — `spendByKind.test.ts` holds that for every trip. Its currency
// rule is `cost.chart`'s, not `cost`'s: a slice made of yen and dollars is a
// wrong slice (KI-2026-09-24-p), so other currencies are left off and named.
// Unlike the bars it has no day axis, so an unscheduled stop is simply in it.
const COST_BY_KIND_FILTERS = ["day", "dates", "city", "tag"] as const satisfies readonly FilterDimension[];
const CostByKindParams = filterParams(COST_BY_KIND_FILTERS);
type CostByKindParams = z.infer<typeof CostByKindParams>;

/**
 * A slice's share of the total as a reader says it: a whole percent, and
 * "<1%" rather than "0%" for money that is there but rounds away.
 */
function shareOf(amount: number, total: number): string {
  const percent = Math.round((amount / total) * 100);
  return percent === 0 ? "<1%" : `${percent}%`;
}

export const costByKind: MacroDef<CostByKindParams, SpendByKindPayload> = {
  name: "cost.byKind", title: "Spend by kind", shape: "block",
  params: CostByKindParams, inputs: filterInputs(COST_BY_KIND_FILTERS),
  selection: { entity: "stop", filters: COST_BY_KIND_FILTERS },
  description:
    "A pie of what the selected stops cost per kind — Planned, Pending, Travel — with each kind's amount and share. Filter it to a day, dates, a city or a tag.",
  // `cost.chart`'s wording: the two are the notebook's charts of the same money.
  emptyText: "no costs yet",
  // Fixed, never computed (ADR-037 decision 5): no amount, no kind.
  preview: "a pie of what planned, pending and travel stops cost",
  resolve: ({ trip, globals }: WidgetContext, params, item): MacroResult<SpendByKindPayload> => {
    if (!trip) return needsTrip();
    const selection = narrow(trip, globals, params, item);
    if (selection.status !== "ok") return selection;
    const { stops } = selection.value;

    const charted = stops.filter((s) => s.activity.cost?.currency === trip.currency);
    const otherCurrencies = stops.flatMap((s) =>
      s.activity.cost && s.activity.cost.currency !== trip.currency ? [s.activity.cost] : [],
    );
    const others = collapseKind("money", otherCurrencies, { currency: trip.currency });

    const total = costOfStops(charted);
    if (total === 0) return others === null ? empty() : empty(`only priced in other currencies: ${others}`);

    const slices: SpendByKindSlice[] = ActivityKind.options.map((key) => {
      const amountMinor = costOfStops(charted.filter((s) => s.activity.kind === key));
      return {
        key,
        label: KIND_LABEL[key],
        amountMinor,
        amount: amountMinor === 0 ? null : formatMoney(amountMinor, trip.currency),
        share: amountMinor === 0 ? null : shareOf(amountMinor, total),
      };
    });

    const totalText = formatMoney(total, trip.currency);
    const parts = slices.filter((s) => s.amount !== null).map((s) => `${s.label} ${s.amount} (${s.share})`);
    return ok({
      kind: "spend-by-kind",
      slices,
      total: totalText,
      summary: `Spend by kind in ${trip.currency}: ${totalText} — ${parts.join(", ")}.`,
      notCharted: others === null ? null : `Not charted: ${others} in other currencies.`,
    });
  },
  render: blockOf,
};
