"use client";

import { Area, AreaChart, Tooltip, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltipContent, tokenColor, type ChartConfig } from "@/components/ui/chart";
import { DataText } from "@/components/ui/data-text";
import { EmptyState } from "@/components/ui/empty-state";
import { Text } from "@/components/ui/text";
import type { AdminTierSeriesRow } from "@/lib/adminOverview";
import { count, shortDay } from "./aiFormat";

// **Accounts by tier, week by week** (M47 part 4, spec § Users *Accounts by
// tier*): one small area per tier from `tier_weekly`, which the tier-rollup
// cron writes daily.
//
// **Each card has its own y-scale**, as drawn: on a shared one, free's count
// flattens every paid tier to a line along the bottom.
//
// **Net change, not *+N added / −N lost*.** The design's two figures need each
// account's movement, and a table of weekly counts holds only the totals, so
// the card says the net over the last four weeks and says that it is net
// (Mitchell, 2026-10-17). The gross pair would need a per-account snapshot.
//
// **"since <first week>"**, because nothing before the first rollup exists and
// nothing back-fills it (M47 decision 1).

const CHART_HEIGHT = 72;
/** Four weeks back from the newest point is the design's "last 30 days", in whole weeks. */
const NET_WEEKS = 4;

const growthConfig = { accounts: { label: "Accounts", color: "--color-ink" } } satisfies ChartConfig;

type Point = AdminTierSeriesRow["points"][number];

/**
 * The change from the point `NET_WEEKS` before the newest to the newest, or
 * from the first point when there are fewer. `null` with one point or none:
 * there is no change to report yet.
 */
export function netChange(points: readonly Point[]): { delta: number; weeks: number } | null {
  if (points.length < 2) return null;
  const last = points.length - 1;
  const from = Math.max(0, last - NET_WEEKS);
  return { delta: points[last]!.accounts - points[from]!.accounts, weeks: last - from };
}

function netLabel(net: { delta: number; weeks: number }): string {
  const signed = net.delta > 0 ? `+${count(net.delta)}` : net.delta < 0 ? `−${count(-net.delta)}` : "0";
  return `${signed} net, last ${net.weeks} week${net.weeks === 1 ? "" : "s"}`;
}

type Hover = { active?: boolean; payload?: readonly { payload?: unknown }[] };

function WeekTooltip({ active, payload }: Hover) {
  const point = payload?.[0]?.payload as Point | undefined;
  if (!active || !point) return null;
  return (
    <ChartTooltipContent
      title={`Week of ${shortDay(point.weekStart)}`}
      lines={[{ label: "Accounts", value: count(point.accounts), color: tokenColor("--color-ink") }]}
    />
  );
}

function TierCard({ tier }: { tier: AdminTierSeriesRow }) {
  const { planId, points } = tier;
  const first = points[0];
  const now = points[points.length - 1];
  const peak = Math.max(...points.map((point) => point.accounts));
  const net = netChange(points);
  return (
    <section
      aria-label={`${planId} accounts by week`}
      className="flex flex-col gap-1.5 rounded-lg border border-hairline bg-surface px-3.5 py-3"
      data-testid={`tier-growth-${planId}`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-display text-md font-semibold text-ink">{planId}</span>
        <DataText className="text-xl font-semibold text-ink" data-testid={`tier-growth-${planId}-now`}>
          {now ? count(now.accounts) : "—"}
        </DataText>
      </div>
      {net ? (
        <DataText
          size="xs"
          className={net.delta > 0 ? "text-success-ink" : undefined}
          data-testid={`tier-growth-${planId}-net`}
        >
          {netLabel(net)}
        </DataText>
      ) : (
        <Text as="span" className="text-xs text-slate">
          {now ? "One week so far" : "Not counted yet"}
        </Text>
      )}
      {first && now ? (
        <>
          <ChartContainer
            config={growthConfig}
            height={CHART_HEIGHT}
            label={`${planId}: ${count(now.accounts)} accounts now, peak ${count(peak)}, since ${shortDay(first.weekStart)}.`}
          >
            <AreaChart data={[...points]} margin={{ top: 2, right: 0, bottom: 0, left: 0 }} accessibilityLayer={false}>
              <XAxis dataKey="weekStart" hide />
              {/* Its own scale, from zero: an area drawn off a raised floor
                  makes a small change look like a large one. */}
              <YAxis hide domain={[0, "dataMax"]} />
              <Tooltip content={WeekTooltip} cursor={{ stroke: tokenColor("--color-border-strong") }} isAnimationActive={false} />
              <Area
                dataKey="accounts"
                type="linear"
                stroke={tokenColor("--color-ink")}
                strokeWidth={1.6}
                fill={tokenColor("--color-ink")}
                fillOpacity={0.08}
                activeDot={false}
                isAnimationActive={false}
              />
            </AreaChart>
          </ChartContainer>
          <span className="flex justify-between">
            <DataText size="xs">{shortDay(first.weekStart)}</DataText>
            <DataText size="xs">peak {count(peak)}</DataText>
            <DataText size="xs">now</DataText>
          </span>
          <Text as="span" className="text-xs text-slate" data-testid={`tier-growth-${planId}-since`}>
            since {shortDay(first.weekStart)}
          </Text>
        </>
      ) : null}
    </section>
  );
}

/**
 * One card per tier, in the tier panel's order (premium before free), or an
 * empty state before the first rollup has run.
 */
export function TierGrowthCharts({ tiers }: { tiers: readonly AdminTierSeriesRow[] }) {
  if (tiers.every((tier) => tier.points.length === 0)) {
    return (
      <EmptyState
        title="No weekly counts yet"
        body="The tier rollup runs daily at 04:30 UTC. Its first run starts each tier's history."
      />
    );
  }
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="tier-growth">
      {/* Reversed for the same reason `TierPanel` reverses: the wire is the
          plan file's ladder order, and the design reads top tier first. */}
      {[...tiers].reverse().map((tier) => (
        <TierCard key={tier.planId} tier={tier} />
      ))}
    </div>
  );
}
