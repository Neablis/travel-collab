"use client";

import { Area, AreaChart, Bar, BarChart, ReferenceLine, Tooltip, XAxis, YAxis } from "recharts";
import {
  ChartContainer, ChartTooltipContent, chartTick, tokenColor, type ChartConfig,
} from "@/components/ui/chart";
import type { AdminAiContextStep, AdminAiTurnsDay } from "@/lib/adminAiModels";
import { compact, count, shortDay } from "./aiFormat";

// The AI models tab's two pictures (M36 link 4), through the one chart
// component (`ui/chart.tsx`, M14 link 11) — `chart.test.tsx` renders both and
// fails on any paint that is not a token.
//
// **No axis numbers, as drawn.** Each chart's numbers are on hover and in the
// table beside it (`AiModelsTab`), the same split the spend charts make:
// a printed value per day or per step would be thirty or eight labels fighting
// for a 120px band.
//
// **Not lazy, unlike the notebook charts.** Those keep Recharts out of every
// notebook page's first load; this is a tab of an admin-only route, read by a
// handful of operators, and splitting it would buy a placeholder flash for
// nobody.

/** The two series of *Turns a day*: every turn, and failed turns at the base. */
export const turnsChartConfig = {
  turns: { label: "Turns", color: "--color-ink" },
  failed: { label: "Failed", color: "--color-danger-ink" },
} satisfies ChartConfig;

/** The two marks of *Context size by step*: the median before the 95th percentile. */
export const contextChartConfig = {
  median: { label: "Median input tokens", color: "--color-ink" },
  p95: { label: "95th percentile", color: "--color-moss" },
} satisfies ChartConfig;

type Hover = { active?: boolean; payload?: readonly { payload?: unknown }[] };

function TurnsTooltip({ active, payload }: Hover) {
  const day = payload?.[0]?.payload as AdminAiTurnsDay | undefined;
  if (!active || !day) return null;
  return (
    <ChartTooltipContent
      title={shortDay(day.day)}
      lines={[
        { label: "Turns", value: count(day.turns), color: tokenColor("--color-ink") },
        { label: "Failed", value: count(day.failed), color: tokenColor("--color-danger-ink") },
      ]}
    />
  );
}

/**
 * Turns per day as an ink area, failed turns as a danger area at its base
 * (spec § AI models 2). Thirty points, oldest first.
 */
export function TurnsADayChart({ days, height }: { days: readonly AdminAiTurnsDay[]; height: number }) {
  const total = days.reduce((sum, day) => sum + day.turns, 0);
  const failed = days.reduce((sum, day) => sum + day.failed, 0);
  return (
    <ChartContainer
      config={turnsChartConfig}
      height={height}
      label={`Turns a day over ${days.length} days: ${count(total)} turns, ${count(failed)} failed.`}
    >
      <AreaChart data={[...days]} margin={{ top: 4, right: 0, bottom: 0, left: 0 }} accessibilityLayer={false}>
        <XAxis dataKey="day" hide />
        <YAxis hide domain={[0, "dataMax"]} />
        <ReferenceLine y={0} stroke={tokenColor("--color-hairline")} />
        <Tooltip content={TurnsTooltip} cursor={{ stroke: tokenColor("--color-border-strong") }} isAnimationActive={false} />
        <Area
          dataKey="turns"
          type="linear"
          stroke={tokenColor("--color-ink")}
          strokeWidth={1.6}
          fill={tokenColor("--color-ink")}
          fillOpacity={0.08}
          activeDot={false}
          isAnimationActive={false}
        />
        <Area
          dataKey="failed"
          type="linear"
          stroke="none"
          fill={tokenColor("--color-danger-ink")}
          fillOpacity={0.55}
          activeDot={false}
          isAnimationActive={false}
        />
      </AreaChart>
    </ChartContainer>
  );
}

function ContextTooltip({ active, payload }: Hover) {
  const step = payload?.[0]?.payload as AdminAiContextStep | undefined;
  if (!active || !step) return null;
  return (
    <ChartTooltipContent
      title={`Step ${step.step}`}
      lines={[
        { label: "Median", value: count(step.median), color: tokenColor("--color-ink") },
        { label: "95th percentile", value: count(step.p95), color: tokenColor("--color-moss") },
        { label: "Turns that got this far", value: count(step.turns) },
      ]}
    />
  );
}

/** Under each column: the step number in ink, its median in slate (as drawn). */
function StepTick({
  x,
  y,
  payload,
  steps,
}: {
  x?: number;
  y?: number;
  payload?: { value?: string };
  steps: readonly AdminAiContextStep[];
}) {
  const step = steps.find((s) => s.step === payload?.value);
  return (
    <g transform={`translate(${x ?? 0},${y ?? 0})`}>
      <text textAnchor="middle" dy={10} fill={tokenColor("--color-ink")} fontFamily={chartTick.fontFamily} fontSize={chartTick.fontSize}>
        {payload?.value}
      </text>
      <text textAnchor="middle" dy={24} fill={tokenColor("--color-slate")} fontFamily={chartTick.fontFamily} fontSize={chartTick.fontSize}>
        {step ? compact(step.median) : ""}
      </text>
    </g>
  );
}

/**
 * One column per step (1–7, then 8+): the median as an ink bar in front of the
 * 95th percentile in moss with a strong border (spec § AI models 3). Two
 * category axes over the same steps put the two bars in one slot, overlapping.
 */
export function ContextByStepChart({ steps, height }: { steps: readonly AdminAiContextStep[]; height: number }) {
  return (
    <ChartContainer
      config={contextChartConfig}
      height={height}
      label={`Median and 95th percentile input tokens at each of ${steps.length} step columns.`}
    >
      <BarChart data={[...steps]} margin={{ top: 4, right: 0, bottom: 0, left: 0 }} barCategoryGap="18%" accessibilityLayer={false}>
        <XAxis xAxisId="p95" dataKey="step" hide />
        <XAxis
          xAxisId="median"
          dataKey="step"
          tickLine={false}
          axisLine={{ stroke: tokenColor("--color-hairline") }}
          interval={0}
          height={34}
          tick={<StepTick steps={steps} />}
        />
        <YAxis hide domain={[0, "dataMax"]} />
        <Tooltip content={ContextTooltip} cursor={{ fill: tokenColor("--color-hairline") }} isAnimationActive={false} />
        <Bar
          xAxisId="p95"
          dataKey="p95"
          fill={tokenColor("--color-moss")}
          stroke={tokenColor("--color-border-strong")}
          radius={[3, 3, 0, 0]}
          isAnimationActive={false}
        />
        <Bar xAxisId="median" dataKey="median" fill={tokenColor("--color-ink")} radius={[3, 3, 0, 0]} isAnimationActive={false} />
      </BarChart>
    </ChartContainer>
  );
}
