import { z } from "zod";
import type { FilterDimension } from "@tc/contracts";
import { ActivityTag } from "@tc/contracts";
import type { MacroDef, WidgetContext, WidgetInput } from "../../registry-types";
import { blockOf } from "../../registry-types";
import type { SpendBurnDown, SpendByDayBar, SpendByDayPayload, SpendSeriesKey } from "../../chartPayloads";
import { ok, empty, needsTrip, type MacroResult } from "../../result";
import { filterInputs, filterParams } from "../../filters";
import { costOfStops, narrow, type SelectedStop } from "../../select";
import { dayLabel, formatDate, formatMoney, ordinal } from "../../format";
import { collapseKind } from "../../kinds";
import { TAG_LABEL } from "../../enumLabels";

// `cost.chart` — "Spend by day", the first chart (M14 link 11; widget
// brainstorm §6 item 5). One bar per selected day for what its stops cost,
// stacked by tag, with the budget spread evenly over the trip as a line — or,
// with `view: "burndown"`, the same stacks as a running total burning the
// budget down against an even pace (`burnDownOf`).
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
const CostChartParams = filterParams(COST_CHART_FILTERS, {
  // Absent is "bars": the chart every stored `cost.chart` already draws.
  view: z.enum(["bars", "burndown"]).optional(),
});
type CostChartParams = z.infer<typeof CostChartParams>;

const COST_CHART_INPUTS: readonly WidgetInput[] = [
  ...filterInputs(COST_CHART_FILTERS),
  // "Variation", not "Show as" (Mitchell, #221 preview: *"Maybe Variation is
  // better. Variation: Default, Burn Down"*). The stored values do not change,
  // so every saved chart reads the same.
  {
    name: "view", type: "choice", label: "Variation", default: "bars",
    options: [{ value: "bars", label: "Default" }, { value: "burndown", label: "Burn down" }],
  },
];

// The stack order, bottom up: the contract's own tag order, then untagged.
const SERIES: readonly SpendSeriesKey[] = [...ActivityTag.options, "untagged"];
const SERIES_LABEL: Record<SpendSeriesKey, string> = { ...TAG_LABEL, untagged: "Untagged" };

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

/**
 * `view: "burndown"` (widget brainstorm §3's "Budget burn-down"): the bars'
 * own stacks summed day over day, the budget left after each, and the even
 * pace to hold that against.
 *
 * **It folds the bars, so it is the same money by construction** — the
 * trip-currency rule and the one-stack-per-stop rule are theirs, and nothing
 * here sums a second currency (KI-2026-09-24-p stays where it was).
 *
 * The pace is per TRIP day, for `budgetPerDay`'s reason: what a narrowed chart
 * should have left after day 2 is the whole trip's answer. The running total
 * drawn starts at the first day SHOWN, so a range that starts mid-trip does not
 * draw the days before it — but **what is left is always the trip's**:
 * `tripSpentThrough` counts every trip-currency stop on or before that day,
 * whatever the chart is narrowed to. A budget less a weekend's meals is not
 * what is left of it, and held against a whole-trip pace it said "on pace"
 * when the trip was long past it (PR #221 self-review).
 */
function burnDownOf(
  bars: readonly SpendByDayBar[],
  dayIndexes: readonly number[],
  budget: SpendBurnDown["budget"],
  tripDays: number,
  tripSpentThrough: (dayIndex: number) => number,
  currency: string,
): SpendBurnDown {
  const running = zeroes();
  const days = bars.map((bar, i) => {
    for (const key of SERIES) running[key] += bar.amounts[key];
    const cumulative = { ...running };
    const spent = SERIES.reduce((sum, key) => sum + running[key], 0);
    const spentSoFar = formatMoney(spent, currency);
    if (budget === null) {
      return { cumulative, spentSoFar, leftMinor: null, left: null, paceMinor: null, pace: null, overPace: false };
    }
    const leftMinor = budget.amountMinor - tripSpentThrough(dayIndexes[i]!);
    const paceMinor = Math.round(budget.amountMinor * (1 - (dayIndexes[i]! + 1) / tripDays));
    const left = leftMinor >= 0 ? `${formatMoney(leftMinor, currency)} left` : `${formatMoney(-leftMinor, currency)} over`;
    const pace = formatMoney(paceMinor, currency);
    return { cumulative, spentSoFar, leftMinor, left, paceMinor, pace, overPace: leftMinor < paceMinor };
  });
  // Said, never drawn as a line at zero: a budget of nothing is not what an
  // unset budget means.
  return { budget, days, note: budget === null ? "No budget set — this is spend so far." : null };
}

export const costChart: MacroDef<CostChartParams, SpendByDayPayload> = {
  name: "cost.chart", title: "Spend by day", shape: "block",
  params: CostChartParams, inputs: COST_CHART_INPUTS,
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
      const parts = SERIES.filter((key) => amounts[key] > 0).map((key) => ({
        key, label: SERIES_LABEL[key], text: formatMoney(amounts[key], trip.currency),
      }));
      return {
        label: dayLabel(index),
        tick: ordinal(index + 1),
        date: date === null ? null : formatDate(date),
        amounts,
        total: total === 0 ? null : formatMoney(total, trip.currency),
        breakdown: parts.map((part) => `${part.label} ${part.text}`).join(", ") || null,
        parts,
      };
    });

    const others = collapseKind("money", otherCurrencies, { currency: trip.currency });
    const left = [
      others === null ? null : `${others} in other currencies`,
      unscheduled === 0 ? null : `${formatMoney(unscheduled, trip.currency)} unscheduled`,
    ].filter((part): part is string => part !== null);

    // Nothing to draw is only "no costs yet" when nothing is priced at all:
    // trip-currency money on no day is still money, and saying otherwise would
    // contradict the `notCharted` line the same stops earn beside a chart.
    const chartedTotal = costOfStops(charted);
    if (chartedTotal === 0) {
      if (left.length === 0) return empty();
      if (unscheduled === 0) return empty(`only priced in other currencies: ${others}`);
      return empty(`nothing priced on a day yet: ${left.join("; ")}`);
    }

    // Per TRIP day, not per selected day: the line is the pace the whole budget
    // allows, and narrowing the chart to a weekend does not make a weekend's
    // share of the budget bigger.
    const budget =
      trip.budget && trip.budget.currency === trip.currency && trip.days.length > 0 ? trip.budget.amountMinor : null;
    const perDay = budget === null ? null : Math.round(budget / trip.days.length);
    const budgetPerDay = perDay === null ? null : { amountMinor: perDay, text: formatMoney(perDay, trip.currency) };

    const tallest = Math.max(...bars.map((bar) => SERIES.reduce((sum, key) => sum + bar.amounts[key], 0)));
    const series = SERIES.filter((key) => bars.some((bar) => bar.amounts[key] > 0)).map((key) => ({
      key, label: SERIES_LABEL[key],
    }));

    const spent = formatMoney(chartedTotal, trip.currency);
    const dayCount = `${bars.length} ${bars.length === 1 ? "day" : "days"}`;
    if (params.view === "burndown") {
      // Every trip-currency stop on a day, whatever this chart is narrowed to.
      const whole = narrow(trip, globals, {});
      const onDays = whole.status === "ok"
        ? whole.value.stops.filter((s) => s.dayIndex !== null && s.activity.cost?.currency === trip.currency)
        : [];
      const tripSpentThrough = (dayIndex: number) => costOfStops(onDays.filter((s) => s.dayIndex! <= dayIndex));
      const burnDown = burnDownOf(
        bars, days, budget === null ? null : { amountMinor: budget, text: formatMoney(budget, trip.currency) },
        trip.days.length, tripSpentThrough, trip.currency,
      );
      const last = burnDown.days.at(-1)!;
      // The sentence's three numbers must add up: spent and left are both the
      // TRIP's through the last day shown, whatever the chart is narrowed to.
      const tripSpent = formatMoney(tripSpentThrough(days.at(-1)!), trip.currency);
      return ok({
        kind: "spend-by-day",
        view: "burndown",
        burnDown,
        series,
        days: bars,
        budgetPerDay,
        // The running total only rises, so the last day is the most spent.
        ticks: ticksFor(Math.max(chartedTotal, budget ?? 0), trip.currency),
        summary: burnDown.budget
          ? `Budget burn-down in ${trip.currency}: ${tripSpent} spent against a budget of ${burnDown.budget.text} — ${last.left}.`
          : `Spend so far in ${trip.currency}: ${spent} over ${dayCount}. No budget set.`,
        notCharted: left.length === 0 ? null : `Not charted: ${left.join("; ")}.`,
      });
    }

    const priced = bars.filter((bar) => bar.total !== null).length;
    const summary =
      `Spend by day in ${trip.currency}: ${spent} over ${priced} of ${dayCount}` +
      (budgetPerDay ? `, against a budget of ${budgetPerDay.text} a day.` : ".");

    return ok({
      kind: "spend-by-day",
      view: "bars",
      burnDown: null,
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
