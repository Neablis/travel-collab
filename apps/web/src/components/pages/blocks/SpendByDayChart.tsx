import { Area, Bar, BarChart, CartesianGrid, ComposedChart, Line, ReferenceLine, Tooltip, XAxis, YAxis } from "recharts";
import type { SpendByDayPayload } from "@tc/pages";
import {
  ChartContainer, ChartTooltipContent, chartAxisLine, chartGrid, chartTick, seriesColor, tokenColor, type ChartConfig,
} from "@/components/ui/chart";

// The picture half of "Spend by day", and the only file that brings Recharts
// into a notebook (its own chunk, 90 KB gzip, measured 2026-09-24).
// `SpendByDayBlock` loads it lazily, so a notebook without a chart never
// downloads it; what a reader gets without the picture (the key, what was
// left off, the table) is in the block.
//
// **No number is printed on the chart** (Mitchell, PR 221 preview: *"Add the
// actual cost number here as a hover just so we dont have text issues wrapping
// into left/right lane"*). A total over each bar collided with its neighbours
// on a long trip; each day's numbers are on hover now, and always in the
// block's table.

type Days = SpendByDayPayload["days"];

/**
 * The hover for one chart: the day's full name, its total and every stack, and
 * on a burn-down the running total, the budget left and the pace. Recharts
 * hands back the hovered row, and `index` is how it finds its day again.
 * Exported so a test can read it without steering a pointer through jsdom,
 * which has no layout for Recharts to hit-test.
 */
export function tooltipFor(payload: SpendByDayPayload) {
  return function SpendTooltip({ active, payload: hovered }: { active?: boolean; payload?: readonly { payload?: unknown }[] }) {
    const row = hovered?.[0]?.payload as { index?: number } | undefined;
    const day = row?.index === undefined ? undefined : payload.days[row.index];
    if (!active || !day) return null;
    const stacks = day.parts.map((part) => ({ label: part.label, value: part.text, color: seriesColor(part.key) }));
    const burn = payload.burnDown?.days[row!.index!];
    // "Day 1" in full: the axis says "1st" to save room, and the hover has it.
    const title = day.date ? `${day.label} · ${day.date}` : day.label;
    const lines = burn
      ? [
          { label: "Spent that day", value: day.total ?? "nothing priced" },
          ...stacks,
          { label: "Spent so far", value: burn.spentSoFar },
          ...(burn.left ? [{ label: "Budget", value: burn.left }] : []),
          ...(burn.pace ? [{ label: "Even pace leaves", value: burn.pace }] : []),
        ]
      : [{ label: "Total", value: day.total ?? "nothing priced" }, ...stacks];
    return <ChartTooltipContent title={title} lines={lines} />;
  };
}

function axes(payload: SpendByDayPayload) {
  const tickText = new Map(payload.ticks.map((tick) => [tick.value, tick.text]));
  const top = payload.ticks.at(-1)?.value ?? 0;
  return [
    <CartesianGrid key="grid" {...chartGrid} />,
    // Ordinals under the bars (*"just go with 1st, 2nd, 3rd to save on space"*).
    <XAxis key="x" dataKey="tick" tick={chartTick} tickLine={false} axisLine={chartAxisLine} />,
    <YAxis
      key="y"
      domain={[0, top]}
      ticks={payload.ticks.map((tick) => tick.value)}
      tickFormatter={(value: number) => tickText.get(value) ?? ""}
      tick={chartTick}
      tickLine={false}
      axisLine={false}
      width={80}
    />,
  ];
}

function budgetLine(amountMinor: number) {
  return (
    <ReferenceLine y={amountMinor} stroke={tokenColor("--color-ink")} strokeDasharray="4 3" ifOverflow="extendDomain" />
  );
}

/** The bars, or the burn-down, and the budget line, drawn at `height`. */
export function SpendByDayChart({
  payload,
  config,
  height,
}: {
  payload: SpendByDayPayload;
  config: ChartConfig;
  height: number;
}) {
  const content = tooltipFor(payload);
  return (
    <ChartContainer config={config} height={height} label={payload.summary}>
      {payload.burnDown ? (
        <BurnDown payload={payload} content={content} />
      ) : (
        <BarChart data={rowsOf(payload.days)} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} accessibilityLayer={false}>
          {axes(payload)}
          <Tooltip content={content} cursor={{ fill: tokenColor("--color-hairline") }} isAnimationActive={false} />
          {payload.series.map(({ key }) => (
            <Bar key={key} dataKey={key} stackId="spend" fill={seriesColor(key)} isAnimationActive={false} />
          ))}
          {payload.budgetPerDay ? budgetLine(payload.budgetPerDay.amountMinor) : null}
        </BarChart>
      )}
    </ChartContainer>
  );
}

const rowsOf = (days: Days) => days.map((day, index) => ({ index, tick: day.tick, ...day.amounts }));

/**
 * Cumulative spend, stacked by tag, hanging from the budget line: under the
 * stacks sits an unpainted base of what is LEFT, so the stacks' lower edge is
 * the budget left and is read against the even-pace diagonal directly — below
 * it is over pace. Past the budget the base is zero and the stacks rise over
 * the line. With no budget there is no base, no line and no pace: the stacks
 * are the running total from zero, and the block says why in words.
 */
function BurnDown({ payload, content }: { payload: SpendByDayPayload; content: ReturnType<typeof tooltipFor> }) {
  const burn = payload.burnDown!;
  const data = payload.days.map((day, index) => {
    const through = burn.days[index]!;
    return {
      index,
      tick: day.tick,
      base: Math.max(through.leftMinor ?? 0, 0),
      pace: through.paceMinor,
      ...through.cumulative,
    };
  });
  return (
    <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} accessibilityLayer={false}>
      {axes(payload)}
      <Tooltip content={content} cursor={{ stroke: tokenColor("--color-border-strong") }} isAnimationActive={false} />
      {burn.budget ? (
        <Area dataKey="base" stackId="burn" type="linear" fill="none" stroke="none" activeDot={false} isAnimationActive={false} />
      ) : null}
      {payload.series.map(({ key }) => (
        <Area
          key={key}
          dataKey={key}
          stackId="burn"
          type="linear"
          fill={seriesColor(key)}
          fillOpacity={1}
          stroke={seriesColor(key)}
          activeDot={false}
          isAnimationActive={false}
        />
      ))}
      {burn.budget ? budgetLine(burn.budget.amountMinor) : null}
      {burn.budget ? (
        <Line
          dataKey="pace"
          type="linear"
          stroke={tokenColor("--color-slate")}
          strokeDasharray="2 3"
          dot={false}
          activeDot={false}
          isAnimationActive={false}
        />
      ) : null}
    </ComposedChart>
  );
}
