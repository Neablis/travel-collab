import { z } from "zod";
import type { FilterDimension } from "@tc/contracts";
import { ActivityTag } from "@tc/contracts";
import type { MacroDef, WidgetContext } from "../../registry-types";
import { blockOf } from "../../registry-types";
import type { SpendByDayBar, SpendByDayPayload, SpendSeriesKey } from "../../chartPayloads";
import { ok, empty, needsTrip, type MacroResult } from "../../result";
import { filterInputs, filterParams } from "../../filters";
import { costOfStops, narrow, type SelectedStop } from "../../select";
import { formatDate, formatMoney } from "../../format";
import { collapseKind } from "../../kinds";

// `cost.chart` — "Spend by day", the first chart (M14 link 11; widget
// brainstorm §6 item 5). One bar per selected day for what its stops cost,
// stacked by tag, with the budget spread evenly over the trip as a line.
//
// **A primitive: `stop` + filters + a chart shape**, exactly as `cost.rows` is
// `stop` + filters + rows (ADR-039 decision 1). It selects the same stops
// through the same `narrow` and sums them with the same `costOfStops`, so a bar
// and `cost{day}` for that day are one number, never two that can drift. The
// property test in `spendByDay.test.ts` holds that for every trip.
//
// Two filters, not `cost.rows`' five. `dates` is the day range a chart of days
// is naturally cut by, and `tag` is "just the meals". `day` would be a one-bar
// chart, and `city`/`kind` can join later on the same declaration with no
// change here beyond the list.
const COST_CHART_FILTERS = ["dates", "tag"] as const satisfies readonly FilterDimension[];
const CostChartParams = filterParams(COST_CHART_FILTERS);
type CostChartParams = z.infer<typeof CostChartParams>;

// The stack order, bottom up: the contract's own tag order, then untagged.
const SERIES: readonly SpendSeriesKey[] = [...ActivityTag.options, "untagged"];
const SERIES_LABEL: Record<SpendSeriesKey, string> = {
  meal: "Meal", lodging: "Lodging", ticketed: "Ticketed", outdoors: "Outdoors", untagged: "Untagged",
};

/**
 * Which ONE stack a stop's cost goes on.
 *
 * A stop can carry several tags, and the stacks of a bar must add up to the
 * day's cost — so a stop is counted once, under one tag, never once per tag.
 * The first in the contract's order, unless the widget is filtered to a tag:
 * then every stop on the chart carries that one, and stacking a "just the
 * outdoors" chart under "Meal" would contradict the filter the reader set.
 */
function stackOf(stop: SelectedStop, filteredTo: ActivityTag | undefined): SpendSeriesKey {
  if (filteredTo) return filteredTo;
  // `?? []`: the contract defaults `tags` on parse, and a trip that reached
  // here without that parse (`registry.property.test.ts` builds its own) must
  // still chart as untagged rather than throw.
  const tags: readonly ActivityTag[] = stop.activity.tags ?? [];
  return ActivityTag.options.find((tag) => tags.includes(tag)) ?? "untagged";
}

const zeroes = (): Record<SpendSeriesKey, number> =>
  Object.fromEntries(SERIES.map((key) => [key, 0])) as Record<SpendSeriesKey, number>;

/**
 * The value axis: 0 and three to five round steps above the highest thing
 * drawn. A "round" step is 1, 2, 2.5 or 5 times a power of ten of whole
 * currency units, so the labels read `$250.00`, never `$233.33`.
 */
function ticksFor(highest: number, currency: string): SpendByDayPayload["ticks"] {
  const rough = Math.max(highest / 4, 100);
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rough)!;
  const top = Math.ceil(highest / step) * step;
  const ticks: SpendByDayPayload["ticks"] = [];
  for (let value = 0; value <= top; value += step) ticks.push({ value, text: formatMoney(value, currency) });
  return ticks;
}

export const costChart: MacroDef<CostChartParams, SpendByDayPayload> = {
  name: "cost.chart", title: "Spend by day", shape: "block",
  params: CostChartParams, inputs: filterInputs(COST_CHART_FILTERS),
  selection: { entity: "stop", filters: COST_CHART_FILTERS },
  description:
    "A bar per day for what that day's stops cost, stacked by tag, with the budget per day drawn as a line. Filter it to a date range or one tag.",
  emptyText: "no costs yet",
  // Fixed, never computed (ADR-037 decision 5): no amount, no day.
  preview: "a bar per day of what it costs, against the budget",
  resolve: ({ trip, globals }: WidgetContext, params, item): MacroResult<SpendByDayPayload> => {
    if (!trip) return needsTrip();
    const selection = narrow(trip, globals, params, item);
    if (selection.status !== "ok") return selection;
    const { days, stops } = selection.value;

    // **The trip's currency only**, which is `kinds.ts`'s money rule: no rates
    // in a pure package (Invariant 4), and a bar made of yen and dollars is a
    // wrong bar. What is left off is named under the chart instead.
    const charted = stops.filter((s) => s.dayIndex !== null && s.activity.cost?.currency === trip.currency);
    const otherCurrencies = stops.flatMap((s) =>
      s.activity.cost && s.activity.cost.currency !== trip.currency ? [s.activity.cost] : [],
    );
    const unscheduled = costOfStops(stops.filter((s) => s.dayIndex === null && s.activity.cost?.currency === trip.currency));

    const bars: SpendByDayBar[] = days.map((index) => {
      const amounts = zeroes();
      for (const stop of charted) {
        if (stop.dayIndex !== index) continue;
        const key = stackOf(stop, params.tag);
        amounts[key] += costOfStops([stop]);
      }
      const total = costOfStops(charted.filter((s) => s.dayIndex === index));
      const date = trip.days[index]!.date;
      return {
        label: `Day ${index + 1}`,
        date: date === null ? null : formatDate(date),
        amounts,
        total: total === 0 ? null : formatMoney(total, trip.currency),
        breakdown:
          SERIES.filter((key) => amounts[key] > 0)
            .map((key) => `${SERIES_LABEL[key]} ${formatMoney(amounts[key], trip.currency)}`)
            .join(", ") || null,
      };
    });

    const others = collapseKind("money", otherCurrencies, { currency: trip.currency });
    const chartedTotal = costOfStops(charted);
    if (chartedTotal === 0) return others === null ? empty() : empty(`only priced in other currencies: ${others}`);

    // Per TRIP day, not per selected day: the line is the pace the whole budget
    // allows, and narrowing the chart to a weekend does not make a weekend's
    // share of the budget bigger.
    const perDay =
      trip.budget && trip.budget.currency === trip.currency && trip.days.length > 0
        ? Math.round(trip.budget.amountMinor / trip.days.length)
        : null;
    const budgetPerDay = perDay === null ? null : { amountMinor: perDay, text: formatMoney(perDay, trip.currency) };

    const tallest = Math.max(...bars.map((bar) => SERIES.reduce((sum, key) => sum + bar.amounts[key], 0)));
    const series = SERIES.filter((key) => bars.some((bar) => bar.amounts[key] > 0)).map((key) => ({
      key, label: SERIES_LABEL[key],
    }));

    const left = [
      others === null ? null : `${others} in other currencies`,
      unscheduled === 0 ? null : `${formatMoney(unscheduled, trip.currency)} unscheduled`,
    ].filter((part): part is string => part !== null);

    const priced = bars.filter((bar) => bar.total !== null).length;
    const summary =
      `Spend by day in ${trip.currency}: ${formatMoney(chartedTotal, trip.currency)} over ${priced} of ${bars.length} ` +
      `${bars.length === 1 ? "day" : "days"}` +
      (budgetPerDay ? `, against a budget of ${budgetPerDay.text} a day.` : ".");

    return ok({
      kind: "spend-by-day",
      series,
      days: bars,
      budgetPerDay,
      ticks: ticksFor(Math.max(tallest, budgetPerDay?.amountMinor ?? 0), trip.currency),
      summary,
      notCharted: left.length === 0 ? null : `Not charted: ${left.join("; ")}.`,
    });
  },
  render: blockOf,
};
