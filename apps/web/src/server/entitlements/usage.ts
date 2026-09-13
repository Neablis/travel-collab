// **The cost ledger's writer and its readers** (M20 link 9).
//
// One `ai_usage` row per AI request, written from the `TurnLedger` the
// assistant kernel already emits — field for field, so this link is an
// `INSERT`, a migration and a retention decision rather than a measurement
// design (ADR-043 decision 4).
//
// **Written on all three end paths, including failure**, because the
// round-trips already made were already paid for. That is free rather than new
// work: `createAskRecorder`'s single-writer latch already fires exactly once
// per turn on `onEnd`, abort and error, so this is a reader of that latch and
// not a fourth place that has to get once-only right.
//
// **No dollars anywhere in this file.** Price is a join, performed at read
// time against `modelRates.ts`, as at a point in time.
import { and, desc, gte, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { aiUsage } from "@/server/db/schema";
import type { TurnLedger } from "@/server/assistant/ledger";
import { microUsdFor } from "./modelRates";

/** One `ai_usage` row, as read back. */
export type AiUsageRow = typeof aiUsage.$inferSelect;

/**
 * Write one turn's row.
 *
 * **Never throws.** This hangs off a streaming response that has already
 * started reaching the user, for the same reason `settleAiSteps` never throws:
 * a telemetry write must not be the reason an answer stops mid-sentence, and a
 * turn whose row failed to land is a reporting gap rather than a broken
 * request. Logged loudly, because a ledger that quietly stops recording is a
 * billing gap that shows up as a surprising invoice months later.
 *
 * Returns whether a row landed, which is what a test needs and what nothing in
 * production reads.
 */
export async function recordAiUsage(ledger: TurnLedger, now: Date = new Date()): Promise<boolean> {
  const { cost } = ledger;
  try {
    await db.insert(aiUsage).values({
      id: crypto.randomUUID(),
      userId: cost.userId,
      endpoint: cost.endpoint,
      outcome: cost.outcome,
      taskClass: cost.taskClass,
      turnModel: cost.turn.model,
      // `?? null` and never `?? 0`: the provider reporting no usage and a turn
      // genuinely using no tokens are different facts, and a rate join has to
      // be able to tell them apart.
      turnTokensIn: cost.turn.tokensIn,
      turnTokensOut: cost.turn.tokensOut,
      // Null all three together when no classification round-trip was made —
      // a bare affirmation short-circuits the classifier and a page turn is
      // never classified. Neither has anything to price.
      classifierModel: cost.classifier?.model ?? null,
      classifierTokensIn: cost.classifier?.tokensIn ?? null,
      classifierTokensOut: cost.classifier?.tokensOut ?? null,
      steps: cost.steps,
      planVersionRef: cost.planVersionRef,
      createdAt: now,
    });
    return true;
  } catch (error) {
    console.error("ai_usage row was not written", {
      userId: cost.userId,
      outcome: cost.outcome,
      error,
    });
    return false;
  }
}

/**
 * What one row cost, in **micro-dollars**, priced at a date.
 *
 * `at` defaults to the row's own `created_at`, which is the ordinary reading —
 * *what did this request cost when it happened.* Passing a different date is
 * what **re-pricing history** means: the same stored row, a different published
 * rate, a different answer, and no row rewritten.
 *
 * `null` when a model has no published rate. **Not zero** — a request nobody
 * can price must not silently contribute nothing to a total.
 */
export function microUsdForRow(row: AiUsageRow, at: Date = row.createdAt): number | null {
  const turn = microUsdFor(row.turnModel, row.turnTokensIn, row.turnTokensOut, at);
  if (turn === null) return null;
  if (row.classifierModel === null) return turn;
  const classifier = microUsdFor(
    row.classifierModel,
    row.classifierTokensIn,
    row.classifierTokensOut,
    at,
  );
  return classifier === null ? null : turn + classifier;
}

/** Every row for one account, newest first. Phase 6's per-account drill-down. */
export async function usageFor(userId: string, limit = 100): Promise<AiUsageRow[]> {
  return db
    .select()
    .from(aiUsage)
    .where(sql`${aiUsage.userId} = ${userId}`)
    .orderBy(desc(aiUsage.createdAt))
    .limit(limit);
}

/** Every row written since `since`. The console's trailing window. */
export async function usageSince(since: Date): Promise<AiUsageRow[]> {
  return db.select().from(aiUsage).where(gte(aiUsage.createdAt, since));
}

/** What one account cost over a trailing window, in micro-dollars. */
export interface AccountCost {
  userId: string;
  requests: number;
  microUsd: number;
  /** Rows whose model has no published rate, so `microUsd` understates. */
  unpriced: number;
}

/**
 * Cost per account over a trailing window, priced **as at each row's own
 * date** — which is what "what did this account cost me" means.
 *
 * The join is done in TypeScript rather than in SQL, deliberately: the rate
 * record is a committed file, so pushing this into the database would mean
 * either duplicating the rates there (two sources, one of them stale) or
 * shipping a giant `CASE`. Row counts here are per-account-per-window and small
 * — the ceiling is 200 requests a day — so the read is bounded by the same
 * numbers link 5 sells.
 *
 * `unpriced` is reported rather than folded in, because an unpriceable row
 * silently counted as zero is the same defect class as a dollar column.
 */
export async function costPerAccount(since: Date): Promise<AccountCost[]> {
  const rows = await usageSince(since);
  const byUser = new Map<string, AccountCost>();
  for (const row of rows) {
    const entry = byUser.get(row.userId) ?? {
      userId: row.userId,
      requests: 0,
      microUsd: 0,
      unpriced: 0,
    };
    entry.requests += 1;
    const cost = microUsdForRow(row);
    if (cost === null) entry.unpriced += 1;
    else entry.microUsd += cost;
    byUser.set(row.userId, entry);
  }
  return [...byUser.values()].sort((a, b) => b.microUsd - a.microUsd);
}

/** The `n` accounts that cost the most over a window. Phase 6's top spenders. */
export async function topSpenders(since: Date, n = 10): Promise<AccountCost[]> {
  return (await costPerAccount(since)).slice(0, n);
}

/** How many rows one account has ever written. Cheap, for the accounts list. */
export async function requestCounts(since: Date): Promise<Map<string, number>> {
  const rows = await db
    .select({ userId: aiUsage.userId, count: sql<number>`count(*)::int` })
    .from(aiUsage)
    .where(and(gte(aiUsage.createdAt, since)))
    .groupBy(aiUsage.userId);
  return new Map(rows.map((row) => [row.userId, row.count]));
}
