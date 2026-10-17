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
// Four weeks by date, not four rows: a week the cron missed has no row.
//
// **"since <first week>"**, because nothing before the first rollup exists and
// nothing back-fills it (M47 decision 1). That is the tier's first row ever,
// not the first one the 26-week window draws.
//
// **"as of <week>" rather than "now"** when the newest row is not this week's:
// a cron that has stopped would otherwise go on reading as current.

const CHART_HEIGHT = 72;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Four weeks back from the newest point is the design's "last 30 days", in whole weeks. */
const NET_WEEKS = 4;

const growthConfig = { accounts: { label: "Accounts", color: "--color-ink" } } satisfies ChartConfig;

type Point = AdminTierSeriesRow["points"][number];

const weeksBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / (7 * DAY_MS));

/**
 * The change to the newest point from the oldest one at most `NET_WEEKS` weeks
 * before it, and how many weeks apart the two are. `null` when no other point
 * is that recent: there is no change to report.
 */
export function netChange(points: readonly Point[]): { delta: number; weeks: number } | null {
  const now = points[points.length - 1];
  const from = points.find((point) => now && weeksBetween(point.weekStart, now.weekStart) <= NET_WEEKS);
  if (!now || !from || from === now) return null;
  return { delta: now.accounts - from.accounts, weeks: weeksBetween(from.weekStart, now.weekStart) };
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

function TierCard({ tier, thisWeek }: { tier: AdminTierSeriesRow; thisWeek: string }) {
  const { planId, points } = tier;
  const first = points[0];
  const now = points[points.length - 1];
  const since = tier.firstWeek ?? first?.weekStart;
  const peak = Math.max(...points.map((point) => point.accounts));
  const net = netChange(points);
  const asOf = now && now.weekStart !== thisWeek ? `as of ${shortDay(now.weekStart)}` : "now";
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
          {points.length > 1 ? "No count in the four weeks before" : now ? "One week so far" : "Not counted yet"}
        </Text>
      )}
      {first && now && since ? (
        <>
          <ChartContainer
            config={growthConfig}
            height={CHART_HEIGHT}
            label={`${planId}: ${count(now.accounts)} accounts ${asOf}, peak ${count(peak)}, since ${shortDay(since)}.`}
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
            <DataText size="xs" data-testid={`tier-growth-${planId}-end`}>
              {asOf}
            </DataText>
          </span>
          <Text as="span" className="text-xs text-slate" data-testid={`tier-growth-${planId}-since`}>
            since {shortDay(since)}
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
export function TierGrowthCharts({ tiers, thisWeek }: { tiers: readonly AdminTierSeriesRow[]; thisWeek: string }) {
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
        <TierCard key={tier.planId} tier={tier} thisWeek={thisWeek} />
      ))}
    </div>
  );
}
