import { Bar, BarChart, CartesianGrid, Pie, PieChart, XAxis, YAxis } from "recharts";
import type { TagBreakdownPayload, TagsByDayPayload } from "@tc/pages";
import { ChartContainer, chartAxisLine, chartGrid, chartTick, seriesColor, tokenColor, type ChartConfig } from "@/components/ui/chart";

// The pictures of the tag widgets (M42 D11), loaded lazily by their blocks for
// `SpendByDayChart`'s reason: Recharts stays out of a notebook with no chart.
// Every colour is a tag's spend colour (`spendColors.ts`), so Food is one
// colour on the chip, in the spend charts and here.
//
// No number is drawn on any of them: each block's key or table carries every
// value as text, the spend charts' lesson (PR 221).

/** "Activities by tag" / "Hours by tag": a donut, or a bar per tag, of the tags that carry anything. */
export function TagBreakdownChart({
  payload,
  config,
  height,
}: {
  payload: TagBreakdownPayload;
  config: ChartConfig;
  height: number;
}) {
  // Zero slices are left off: a zero-degree sector draws a stray separator,
  // and a zero bar is a gap with a label under it.
  const data = payload.slices
    .filter((slice) => slice.value > 0)
    .map((slice) => ({ key: slice.key, label: slice.label, value: slice.value, fill: seriesColor(slice.key) }));
  if (payload.view === "bars") {
    return (
      <ChartContainer config={config} height={height} label={payload.summary}>
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 8, bottom: 0, left: 0 }} accessibilityLayer={false}>
          <CartesianGrid {...chartGrid} vertical horizontal={false} />
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="label" tick={chartTick} tickLine={false} axisLine={chartAxisLine} width={88} />
          <Bar dataKey="value" isAnimationActive={false} />
        </BarChart>
      </ChartContainer>
    );
  }
  const radius = height / 2 - 4;
  return (
    <ChartContainer config={config} height={height} label={payload.summary}>
      <PieChart margin={{ top: 0, right: 0, bottom: 0, left: 0 }} accessibilityLayer={false}>
        <Pie
          data={data}
          dataKey="value"
          nameKey="key"
          innerRadius={radius * 0.55}
          outerRadius={radius}
          startAngle={90}
          endAngle={-270}
          stroke={tokenColor("--color-surface")}
          strokeWidth={2}
          label={false}
          labelLine={false}
          rootTabIndex={-1}
          isAnimationActive={false}
        />
      </PieChart>
    </ChartContainer>
  );
}

/** "Tags by day": a bar per day, stacked by tag. */
export function TagsByDayChart({
  payload,
  config,
  height,
}: {
  payload: TagsByDayPayload;
  config: ChartConfig;
  height: number;
}) {
  const data = payload.days.map((day) => ({ tick: day.tick, ...day.counts }));
  return (
    <ChartContainer config={config} height={height} label={payload.summary}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} accessibilityLayer={false}>
        <CartesianGrid {...chartGrid} />
        <XAxis dataKey="tick" tick={chartTick} tickLine={false} axisLine={chartAxisLine} />
        <YAxis
          domain={[0, payload.ticks.at(-1) ?? 0]}
          ticks={payload.ticks}
          allowDecimals={false}
          tick={chartTick}
          tickLine={false}
          axisLine={false}
          width={32}
        />
        {payload.series.map(({ key }) => (
          <Bar key={key} dataKey={key} stackId="tags" fill={seriesColor(key)} isAnimationActive={false} />
        ))}
      </BarChart>
    </ChartContainer>
  );
}
