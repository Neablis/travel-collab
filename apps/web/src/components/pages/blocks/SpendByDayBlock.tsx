import { Suspense, lazy } from "react";
import type { SpendByDayPayload, SpendSeriesKey } from "@tc/pages";
import { DataText } from "@/components/ui/data-text";
import { ChartLegend, ChartPlaceholder, type ChartConfig, type ChartToken } from "@/components/ui/chart";

// "Spend by day" — a bar per day, stacked by tag, with the budget per day as a
// dashed line (M14 link 11, the first chart); or, as the widget's `view`
// variation "Burn down", the running total against the budget and an even pace.
//
// Spans throughout, for `CostsTableBlock`'s reason: this sits inside a
// paragraph. The chart itself arrives through `ChartContainer`'s portal.
//
// **The picture is loaded lazily.** Imported here, Recharts was in every
// notebook page's first load whether or not the notebook held a chart; moving
// it out took the route's entry JS from 326 to 236 KB gzip (`next build`,
// 2026-09-24). `SpendByDayChart` is the one file that imports it. Until it
// arrives a `ChartPlaceholder` holds the chart's exact height, so nothing below
// moves (ADR-044), and the key, the note and the table are already there.
// `MacroView.test.tsx`'s nesting sweep waits for it, so it still covers the
// drawn chart rather than the placeholder.
const SpendByDayChart = lazy(() => import("./SpendByDayChart").then((m) => ({ default: m.SpendByDayChart })));

// The tag chips' own families (`lib/activityTags.ts`'s `TAG_CHIP_CLASS`), as
// solids, so a meal is the same colour on the board and in the chart. Untagged
// is the quiet neutral: it is the remainder, not a category. `border-input`
// rather than `border-strong` because a bar is a non-text mark and needs 3:1
// against the surface (design-system.md's contrast table has 3.16 for it).
const SERIES_COLOR: Record<SpendSeriesKey, ChartToken> = {
  meal: "--color-warning",
  lodging: "--color-info",
  ticketed: "--color-success",
  outdoors: "--color-slate",
  untagged: "--color-border-input",
};

// ADR-044: fixed, so the page never moves when the chart arrives or a filter
// changes how many days there are.
const SPEND_CHART_HEIGHT = 224;

/** Each stack's label and colour, shared by the chart and its key. */
export function spendChartConfig(payload: SpendByDayPayload): ChartConfig {
  return Object.fromEntries(payload.series.map(({ key, label }) => [key, { label, color: SERIES_COLOR[key] }]));
}

/**
 * "Spend by day": the chart, its key, what it left out, and the same numbers
 * as a table for a screen reader.
 */
export function SpendByDayBlock({ payload }: { payload: SpendByDayPayload }) {
  const config = spendChartConfig(payload);
  const burn = payload.burnDown;
  const budget = burn ? burn.budget : null;

  return (
    <span className="flex flex-col gap-2 rounded-md border border-hairline bg-surface p-3">
      <Suspense fallback={<ChartPlaceholder height={SPEND_CHART_HEIGHT} label={payload.summary} />}>
        <SpendByDayChart payload={payload} config={config} height={SPEND_CHART_HEIGHT} />
      </Suspense>
      <ChartLegend
        config={config}
        extra={
          burn ? (
            budget ? (
              <>
                <span className="flex items-center gap-1.5">
                  <span aria-hidden className="w-4 border-t-2 border-dashed border-ink" />
                  Budget <DataText size="xs">{budget.text}</DataText>
                </span>
                <span className="flex items-center gap-1.5">
                  <span aria-hidden className="w-4 border-t-2 border-dotted border-slate" />
                  Even pace
                </span>
              </>
            ) : null
          ) : payload.budgetPerDay ? (
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="w-4 border-t-2 border-dashed border-ink" />
              Budget <DataText size="xs">{payload.budgetPerDay.text}</DataText> a day
            </span>
          ) : null
        }
      />
      {/* Said, never drawn: a burn-down with no budget is spend so far. */}
      {burn?.note ? <span className="block text-xs text-slate">{burn.note}</span> : null}
      {payload.notCharted ? <span className="block text-xs text-slate">{payload.notCharted}</span> : null}
      {/* The chart's numbers without a pointer: the picture is `role="img"`
          with the summary as its name, its hover is a mouse's alone, and this
          table is the one place that carries EVERY number — for a screen
          reader, a keyboard, and paper. */}
      <span role="table" aria-label="Spend by day" className="sr-only">
        <span role="row">
          <span role="columnheader">Day</span>
          <span role="columnheader">Date</span>
          <span role="columnheader">Total</span>
          <span role="columnheader">By tag</span>
          {burn ? <span role="columnheader">So far</span> : null}
          {budget ? <span role="columnheader">Budget</span> : null}
          {budget ? <span role="columnheader">Even pace leaves</span> : null}
        </span>
        {payload.days.map((day, index) => (
          <span role="row" key={day.label}>
            <span role="rowheader">{day.label}</span>
            <span role="cell">{day.date ?? "—"}</span>
            <span role="cell">{day.total ?? "nothing priced"}</span>
            <span role="cell">{day.breakdown ?? "—"}</span>
            {burn ? <span role="cell">{burn.days[index]!.spentSoFar}</span> : null}
            {budget ? <span role="cell">{burn!.days[index]!.left}</span> : null}
            {budget ? <span role="cell">{burn!.days[index]!.pace}</span> : null}
          </span>
        ))}
      </span>
    </span>
  );
}
