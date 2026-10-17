// Server-only. **Accounts per tier, week by week** (M47 decision 1): the
// console's tier panel counts what accounts hold now, and this keeps that
// count once a week in `tier_weekly` so the Users tab can draw it over time.
//
// Written by `/api/cron/tier-rollup` once a day. Each run overwrites the
// current week's rows, so the week ends holding its last day's count and a
// missed day costs nothing once the next one runs. Nothing before the first
// run exists, and nothing invents it: the chart says *"since <date>"*.
import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import type { PlanId } from "@tc/contracts";
import { db } from "@/server/db/client";
import { tierWeekly, users } from "@/server/db/schema";
import { PLAN_VERSIONS } from "./planVersions";

const DAY_MS = 24 * 60 * 60 * 1000;

/** The Monday (UTC) of the week `now` falls in, as `YYYY-MM-DD`. */
export function weekStartOf(now: Date): string {
  // `getUTCDay` is 0 on Sunday; Sunday belongs to the week that began six days earlier.
  const sinceMonday = (now.getUTCDay() + 6) % 7;
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - sinceMonday * DAY_MS);
  return monday.toISOString().slice(0, 10);
}

/** The plans the tier panel draws, in its order. */
function planIds(): PlanId[] {
  return [...new Set(PLAN_VERSIONS.map((entry) => entry.planId))];
}

export interface TierRollup {
  weekStart: string;
  accounts: Record<PlanId, number>;
}

/**
 * Count this week's holders of each plan and write them, one row per plan.
 *
 * **The tier panel's population** (`planPanel`): `users.plan_id`, live
 * holdings only (ADR-076 §4), so the chart's last point is the panel's
 * number. A plan nobody holds writes 0, so its line reads as empty rather
 * than missing.
 */
export async function rollupTiers(now: Date = new Date()): Promise<TierRollup> {
  const weekStart = weekStartOf(now);
  const counts = await db
    .select({ planId: users.planId, count: sql<number>`count(*)::int` })
    .from(users)
    .where(eq(users.planLivemode, true))
    .groupBy(users.planId);
  const accounts = Object.fromEntries(
    planIds().map((planId) => [planId, counts.find((row) => row.planId === planId)?.count ?? 0]),
  ) as Record<PlanId, number>;

  await db
    .insert(tierWeekly)
    .values(planIds().map((planId) => ({ weekStart, planId, accounts: accounts[planId], updatedAt: now })))
    .onConflictDoUpdate({
      target: [tierWeekly.weekStart, tierWeekly.planId],
      set: { accounts: sql`excluded.accounts`, updatedAt: sql`excluded.updated_at` },
    });
  return { weekStart, accounts };
}

/** One tier's weeks, oldest first. */
export interface TierSeriesRow {
  planId: PlanId;
  points: { weekStart: string; accounts: number }[];
}

/**
 * Every plan's last `weeks` weeks, oldest first, counting this one. A plan
 * with no rows yet has no points: the console draws that as not yet run.
 */
export async function tierSeries(weeks = 26, now: Date = new Date()): Promise<TierSeriesRow[]> {
  const from = weekStartOf(new Date(now.getTime() - (weeks - 1) * 7 * DAY_MS));
  const rows = await db
    .select({ weekStart: tierWeekly.weekStart, planId: tierWeekly.planId, accounts: tierWeekly.accounts })
    .from(tierWeekly)
    .where(and(gte(tierWeekly.weekStart, from), lte(tierWeekly.weekStart, weekStartOf(now))))
    .orderBy(asc(tierWeekly.weekStart));
  return planIds().map((planId) => ({
    planId,
    points: rows
      .filter((row) => row.planId === planId)
      .map(({ weekStart, accounts }) => ({ weekStart, accounts })),
  }));
}
