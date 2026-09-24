import { Bar, BarChart, CartesianGrid, LabelList, ReferenceLine, XAxis, YAxis } from "recharts";
import type { SpendByDayPayload } from "@tc/pages";
import {
  ChartContainer, chartAxisLine, chartGrid, chartLabel, chartTick, seriesColor, tokenColor, type ChartConfig,
} from "@/components/ui/chart";

// The picture half of "Spend by day", and the only file that brings Recharts
// into a notebook (its own chunk, 90 KB gzip, measured 2026-09-24).
// `SpendByDayBlock` loads it lazily, so a notebook without a chart never
// downloads it; what a reader gets without the picture (the key, what was
// left off, the table) is in the block.

/** The bars, the day totals over them and the budget line, drawn at `height`. */
export function SpendByDayChart({
  payload,
  config,
  height,
}: {
  payload: SpendByDayPayload;
  config: ChartConfig;
  height: number;
}) {
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
    <ChartContainer config={config} height={height} label={payload.summary}>
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
  );
}
