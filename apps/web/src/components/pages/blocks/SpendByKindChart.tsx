import { Pie, PieChart } from "recharts";
import type { SpendByKindPayload } from "@tc/pages";
import { ChartContainer, seriesColor, tokenColor, type ChartConfig } from "@/components/ui/chart";

// The picture half of "Spend by kind": a donut, one slice per kind that carries
// money. Loaded lazily by `SpendByKindBlock` for `SpendByDayChart`'s reason —
// Recharts stays out of a notebook that holds no chart.
//
// **No number and no label on the picture.** The key beside it carries every
// kind's amount and share as text, so a label here would say it twice and, on
// a thin slice, collide with its neighbour (the bars' lesson, PR 221). No
// hover either, for the same reason: there is nothing a hover could add.
//
// A donut rather than a full pie: the hole is what keeps three slices reading
// as parts of one ring rather than as wedges competing for the eye, and it
// costs nothing — `innerRadius` is one prop.

/** The donut, drawn at `height`, a slice per kind that carries money. */
export function SpendByKindChart({
  payload,
  config,
  height,
}: {
  payload: SpendByKindPayload;
  config: ChartConfig;
  height: number;
}) {
  // Zero slices are left off: a zero-degree sector draws a stray separator.
  // `fill` rides on each datum, which is how Recharts 3 colours a sector now
  // that `Cell` is deprecated.
  const data = payload.slices
    .filter((slice) => slice.amountMinor > 0)
    .map((slice) => ({ key: slice.key, value: slice.amountMinor, fill: seriesColor(slice.key) }));
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
          // Twelve o'clock, clockwise: the order the key reads in.
          startAngle={90}
          endAngle={-270}
          // The surface between slices, so two adjacent kinds read as two.
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
