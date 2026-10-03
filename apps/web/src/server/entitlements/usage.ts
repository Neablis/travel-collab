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
import { and, desc, getTableColumns, gte, sql, type SQL } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { db } from "@/server/db/client";
import { aiUsage, aiUsageSteps, aiUsageToolCalls } from "@/server/db/schema";
import type { TurnLedger } from "@/server/assistant/ledger";
import { microUsdFor, type ModelRate } from "./modelRates";

/** One `ai_usage` row, as read back. */
export type AiUsageRow = typeof aiUsage.$inferSelect;

/** The part of an `ai_usage_steps` row that pricing reads. */
export type AiUsageStepRow = Pick<
  typeof aiUsageSteps.$inferSelect,
  "turnId" | "model" | "tokensIn" | "cacheReadTokens" | "cacheWriteTokens" | "tokensOut"
>;

/**
 * Write one turn's ledger: its `ai_usage` row, one row per step, and one per
 * tool call (M31 Phase 1).
 *
 * **The billing row is written on its own, first.** The step and tool-call
 * rows go in a second transaction, so a failure there — a provider that reuses
 * a `toolCallId`, a constraint nobody foresaw — loses the telemetry and never
 * the turn's cost row, which is what billing and margin read. (The review of
 * #301 found the first version shared one transaction, so a child failure
 * silently un-billed the turn.)
 *
 * **Idempotent on the turn.** The row's id is the ledger's `turnId`, inserted
 * `ON CONFLICT DO NOTHING`, and the step and tool-call rows upsert on their
 * composite keys — so writing the same ledger twice leaves one turn, N steps
 * and M calls, never two of anything. That is the property a durable runtime
 * that replays a step needs (ADR-062 §5), and it costs nothing here. A ledger
 * with no `turnId` (a caller that minted none) gets a fresh id, which is the
 * old behaviour: one row, and no way to deduplicate it.
 *
 * **Never throws.** This hangs off a streaming response that has already
 * started reaching the user, for the same reason `settleAiSteps` never throws:
 * a telemetry write must not be the reason an answer stops mid-sentence, and a
 * turn whose row failed to land is a reporting gap rather than a broken
 * request. Logged loudly, because a ledger that quietly stops recording is a
 * billing gap that shows up as a surprising invoice months later.
 *
 * Returns whether the write landed, which is what a test needs and what nothing in
 * production reads.
 */
export async function recordTurnLedger(ledger: TurnLedger, now: Date = new Date()): Promise<boolean> {
  const { cost } = ledger;
  const turnId = cost.turnId ?? crypto.randomUUID();
  try {
    await db
      .insert(aiUsage)
      .values({
        id: turnId,
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
        latencyMs: cost.latencyMs,
        createdAt: now,
      })
      .onConflictDoNothing({ target: aiUsage.id });
  } catch (error) {
    console.error("ai_usage row was not written", {
      userId: cost.userId,
      outcome: cost.outcome,
      error,
    });
    return false;
  }
  // One row per key, last write winning: a provider that reuses a call id
  // inside one turn would otherwise make a multi-row upsert touch the same row
  // twice, which Postgres refuses outright.
  const steps = [...new Map(ledger.stepSpend.map((step) => [step.index, step])).values()];
  const calls = [
    ...new Map(
      ledger.toolCalls
        // A call with no SDK id cannot be keyed, so it cannot be written
        // idempotently — and every caller that measures a real turn passes one.
        .filter((call): call is typeof call & { callId: string } => call.callId !== null)
        .map((call) => [call.callId, call]),
    ).values(),
  ];
  try {
    await db.transaction(async (tx) => {
      // **One statement per table**, not one per row: the completed path
      // awaits this inside `onEnd`, so a turn of nine steps and twenty calls
      // must not cost thirty round-trips before the stream can finish. On a
      // conflict every measured column takes the new value (`excluded`); the
      // key and the first-seen time do not move.
      if (steps.length > 0) {
        await tx
          .insert(aiUsageSteps)
          .values(
            steps.map((step) => ({
              turnId,
              stepIndex: step.index,
              model: step.model,
              tier: step.tier,
              tokensIn: step.tokensIn,
              cacheReadTokens: step.cacheReadTokens,
              cacheWriteTokens: step.cacheWriteTokens,
              tokensOut: step.tokensOut,
              finishReason: step.finishReason,
              escalated: step.escalated,
              pivoted: step.pivoted,
              createdAt: now,
            })),
          )
          .onConflictDoUpdate({
            target: [aiUsageSteps.turnId, aiUsageSteps.stepIndex],
            set: excludedOf(aiUsageSteps, [
              "model",
              "tier",
              "tokensIn",
              "cacheReadTokens",
              "cacheWriteTokens",
              "tokensOut",
              "finishReason",
              "escalated",
              "pivoted",
            ]),
          });
      }
      if (calls.length > 0) {
        await tx
          .insert(aiUsageToolCalls)
          .values(
            calls.map((call) => ({
              turnId,
              callId: call.callId,
              stepIndex: call.stepIndex,
              tool: call.name,
              outcome: call.outcome,
              durationMs: call.ms,
              inputBytes: call.inputBytes,
              outputBytes: call.outputBytes,
              reachedProposal: call.reachedProposal,
              createdAt: now,
            })),
          )
          .onConflictDoUpdate({
            target: [aiUsageToolCalls.turnId, aiUsageToolCalls.callId],
            set: excludedOf(aiUsageToolCalls, [
              "stepIndex",
              "tool",
              "outcome",
              "durationMs",
              "inputBytes",
              "outputBytes",
              "reachedProposal",
            ]),
          });
      }
    });
    return true;
  } catch (error) {
    console.error("ai_usage step and tool-call rows were not written", {
      userId: cost.userId,
      turnId,
      error,
    });
    return false;
  }
}

/**
 * An upsert's `SET` that takes each named column from the row that conflicted
 * (`excluded.<column>`) — how a multi-row insert updates every row to its own
 * new values in one statement.
 */
function excludedOf<T extends PgTable, K extends keyof T["_"]["columns"] & string>(
  table: T,
  keys: readonly K[],
): Record<K, SQL> {
  const columns = getTableColumns(table);
  return Object.fromEntries(
    keys.map((key) => [key, sql.raw(`excluded."${(columns[key] as { name: string }).name}"`)]),
  ) as Record<K, SQL>;
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
export function microUsdForRow(
  row: AiUsageRow,
  at: Date = row.createdAt,
  // Passed through to `rateAt`, so a test can re-derive the same stored row
  // against a different published history — which is what "re-pricing works"
  // actually means.
  history?: readonly ModelRate[],
  // The turn's per-step rows (M31 Phase 1). When present, the turn is priced
  // step by step at the model each step ran on — see `microUsdForSteps`.
  steps: readonly AiUsageStepRow[] = [],
): number | null {
  // Per step when the steps can all be priced; otherwise the turn-level price
  // the row always had. A step whose usage the provider never reported (a
  // wrap-up step, say) must not turn a priceable turn into an unpriced one —
  // the turn's own token totals still came from the provider's summary.
  const perStep = steps.length > 0 ? microUsdForSteps(steps, at, history) : null;
  const turn = perStep ?? microUsdFor(row.turnModel, row.turnTokensIn, row.turnTokensOut, at, history);
  if (turn === null) return null;
  if (row.classifierModel === null) return turn;
  const classifier = microUsdFor(
    row.classifierModel,
    row.classifierTokensIn,
    row.classifierTokensOut,
    at,
    history,
  );
  return classifier === null ? null : turn + classifier;
}

/**
 * A turn's agent spend, priced **per step, at the model each step ran on**,
 * with each step's cached reads at the cached rate (KI-2026-09-17-c).
 *
 * `ai_usage.turn_model` is the model the turn was ADMITTED on. A turn that
 * escalates runs its later steps on the escalation model, so pricing the whole
 * turn at `turn_model` bills those steps at the cheap model's rate — the
 * understatement that KI describes. The step rows carry what really ran.
 *
 * Null if any step is unpriceable: a turn that is partly unknown is not
 * reported as costing its known part.
 */
export function microUsdForSteps(
  steps: readonly AiUsageStepRow[],
  at: Date,
  history?: readonly ModelRate[],
): number | null {
  let total = 0;
  for (const step of steps) {
    const cost = microUsdFor(
      step.model,
      step.tokensIn,
      step.tokensOut,
      at,
      history,
      step.cacheReadTokens,
      step.cacheWriteTokens,
    );
    if (cost === null) return null;
    total += cost;
  }
  return total;
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
  // Every step row in the window, by turn. `recordTurnLedger` stamps a turn's
  // row and its step rows with the same `now`, though in separate writes, so
  // the window that selects a turn selects its steps.
  const stepsByTurn = new Map<string, AiUsageStepRow[]>();
  // Only the columns pricing reads: this runs on every console load, over
  // every step of every account in the window.
  const stepRows = await db
    .select({
      turnId: aiUsageSteps.turnId,
      model: aiUsageSteps.model,
      tokensIn: aiUsageSteps.tokensIn,
      cacheReadTokens: aiUsageSteps.cacheReadTokens,
      cacheWriteTokens: aiUsageSteps.cacheWriteTokens,
      tokensOut: aiUsageSteps.tokensOut,
    })
    .from(aiUsageSteps)
    .where(gte(aiUsageSteps.createdAt, since));
  for (const step of stepRows) {
    const list = stepsByTurn.get(step.turnId) ?? [];
    list.push(step);
    stepsByTurn.set(step.turnId, list);
  }
  const byUser = new Map<string, AccountCost>();
  for (const row of rows) {
    const entry = byUser.get(row.userId) ?? {
      userId: row.userId,
      requests: 0,
      microUsd: 0,
      unpriced: 0,
    };
    entry.requests += 1;
    const cost = microUsdForRow(row, row.createdAt, undefined, stepsByTurn.get(row.id) ?? []);
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
