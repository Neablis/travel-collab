import { Bar, BarChart, CartesianGrid, LabelList, ReferenceLine, XAxis, YAxis } from "recharts";
import type { SpendByDayPayload, SpendSeriesKey } from "@tc/pages";
import { DataText } from "@/components/ui/data-text";
import {
  ChartContainer, ChartLegend, chartAxisLine, chartGrid, chartLabel, chartTick, seriesColor, tokenColor,
  type ChartConfig, type ChartToken,
} from "@/components/ui/chart";

// "Spend by day" — a bar per day, stacked by tag, with the budget per day as a
// dashed line (M14 link 11, the first chart).
//
// Spans throughout, for `CostsTableBlock`'s reason: this sits inside a
// paragraph. The chart itself arrives through `ChartContainer`'s portal.

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

/**
 * "Spend by day": the chart, its key, what it left out, and the same numbers
 * as a table for a screen reader.
 */
export function SpendByDayBlock({ payload }: { payload: SpendByDayPayload }) {
  const config: ChartConfig = Object.fromEntries(
    payload.series.map(({ key, label }) => [key, { label, color: SERIES_COLOR[key] }]),
  );
  // `crown` is the stack the day's total sits on: its highest non-zero one.
  // Labelling the last SERIES instead drops the total from every day that has
  // none of it, since Recharts draws no label on a zero-height segment.
  const data = payload.days.map((day) => ({
    label: day.label,
    total: day.total ?? "",
    crown: [...payload.series].reverse().find(({ key }) => day.amounts[key] > 0)?.key,
    ...day.amounts,
  }));
  const tickText = new Map(payload.ticks.map((tick) => [tick.value, tick.text]));
  const top = payload.ticks.at(-1)?.value ?? 0;

  return (
    <span className="flex flex-col gap-2 rounded-md border border-hairline bg-surface p-3">
      <ChartContainer config={config} height={SPEND_CHART_HEIGHT} label={payload.summary}>
        <BarChart data={data} margin={{ top: 20, right: 8, bottom: 0, left: 0 }} accessibilityLayer={false}>
          <CartesianGrid {...chartGrid} />
          <XAxis dataKey="label" tick={chartTick} tickLine={false} axisLine={chartAxisLine} />
          <YAxis
            domain={[0, top]}
            ticks={payload.ticks.map((tick) => tick.value)}
            tickFormatter={(value: number) => tickText.get(value) ?? ""}
            tick={chartTick}
            tickLine={false}
            axisLine={false}
            width={80}
          />
          {payload.series.map(({ key }) => (
            <Bar key={key} dataKey={key} stackId="spend" fill={seriesColor(key)} isAnimationActive={false}>
              {/* The day's total over the top of its stack — printed, so a
                  notebook on paper still says what each day came to. */}
              <LabelList
                dataKey={(row: (typeof data)[number]) => (row.crown === key ? row.total : "")}
                position="top"
                {...chartLabel}
              />
            </Bar>
          ))}
          {payload.budgetPerDay ? (
            <ReferenceLine
              y={payload.budgetPerDay.amountMinor}
              stroke={tokenColor("--color-ink")}
              strokeDasharray="4 3"
              ifOverflow="extendDomain"
            />
          ) : null}
        </BarChart>
      </ChartContainer>
      <ChartLegend
        config={config}
        extra={
          payload.budgetPerDay ? (
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="w-4 border-t-2 border-dashed border-ink" />
              Budget <DataText size="xs">{payload.budgetPerDay.text}</DataText> a day
            </span>
          ) : null
        }
      />
      {payload.notCharted ? <span className="block text-xs text-slate">{payload.notCharted}</span> : null}
      {/* The chart's numbers for a screen reader: the picture is `role="img"`
          with the summary as its name, and this is the table behind it. */}
      <span role="table" aria-label="Spend by day" className="sr-only">
        <span role="row">
          <span role="columnheader">Day</span>
          <span role="columnheader">Date</span>
          <span role="columnheader">Total</span>
          <span role="columnheader">By tag</span>
        </span>
        {payload.days.map((day) => (
          <span role="row" key={day.label}>
            <span role="rowheader">{day.label}</span>
            <span role="cell">{day.date ?? "—"}</span>
            <span role="cell">{day.total ?? "nothing priced"}</span>
            <span role="cell">{day.breakdown ?? "—"}</span>
          </span>
        ))}
      </span>
    </span>
  );
}
