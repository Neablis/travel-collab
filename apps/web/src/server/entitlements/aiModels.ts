// **The AI models tab's one read** (M36 link 4) — the ledger M31 built, per
// turn, per step and per tool call, which no admin surface read until now.
//
// **Trailing 30 days, and the previous 30 for one number** (D10): the turns
// delta. Everything else is the current window only.
//
// **Three row reads and a count, aggregated here rather than in SQL.** Cost
// has to be priced in TypeScript anyway — the rate record is a committed file
// (`modelRates.ts`), for the reason `costPerAccount` gives — and once the step
// rows are in memory for that, a median per bucket is a sort, not another
// round-trip. The volume is the one the console already reads on every load:
// `costPerAccount` selects every step in the same window.
//
// **A step or tool call belongs to the window its TURN is in**, joined on
// `ai_usage.id`, so a turn is never half in and half out. The writer stamps
// all three rows with one `now`, so the two readings agree except across a
// replayed write, where the turn's own time is the honest one.
//
// **Simulated turns are left out everywhere** (`turn_model = 'simulated/…'`,
// ai-live off), as the `ai-usage` skill's queries leave them out: they spend
// nothing and their tool calls are scripted, so they would dilute every rate
// on this tab with a number nobody's question produced.
//
// **No dollars stored and no `Money`** (`usage.noMoney.test.ts`): cost is
// micro-dollars, priced per step at the model that step ran on, at the step's
// own date. **No content either** (D7): nothing here selects a column a
// question or an answer could be in, because there is none.
import { and, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { aiUsage, aiUsageSteps, aiUsageToolCalls } from "@/server/db/schema";
import { microUsdFor } from "./modelRates";
import { TRAILING_WINDOW_DAYS } from "./admin";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Steps at or past this index share one column, *8+* (0-based: the eighth step). */
const LAST_STEP_BUCKET = 7;

/** A step whose input crosses this is a long-context step (the design's 32k). */
export const LONG_CONTEXT_TOKENS = 32_000;

/**
 * Called in fewer than this share of measured turns: *offered on every step,
 * almost never called* (spec § AI models — "tools under 1% of turns").
 */
export const RARELY_CALLED_SHARE = 0.01;

/** One trailing day of turns, oldest first. `day` is its start, ISO-8601. */
export interface AiTurnsDay {
  day: string;
  turns: number;
  failed: number;
}

/** One column of *Context size by step*: input tokens at that step. */
export interface AiContextStep {
  /** `"1"`…`"7"`, then `"8+"` — 1-based, as the design labels it. */
  step: string;
  median: number;
  p95: number;
  /** Turns that got this far — that have a step row in this column. */
  turns: number;
}

/** One model's row in *Models*. */
export interface AiModelRow {
  model: string;
  /**
   * `"classifier"` for the classifier, else the `tier` slots its steps ran in
   * (`cheap` · `mid` · `strong`), as recorded — never inferred from the id.
   */
  roles: readonly string[];
  /** Steps, or for the classifier the round-trips it made. */
  calls: number;
  tokensIn: number;
  /** `null` for the classifier: its round-trip has no duration column. */
  medianDurationMs: number | null;
  /** Priced calls only — see `unpriced`. */
  costMicroUsd: number;
  /** Calls with no published rate or no reported usage, so `costMicroUsd` is a floor. */
  unpriced: number;
  /** `cache_read_tokens / tokens_in` over calls that report both; `null` if none do. */
  cacheReadShare: number | null;
}

/** One tool's row in *Tool calls*. */
export interface AiToolRow {
  tool: string;
  calls: number;
  /** Measured turns that called it at least once. */
  turns: number;
  failed: number;
  repaired: number;
  medianDurationMs: number | null;
  medianOutputBytes: number | null;
  /** `null` for a tool that cannot propose — every row's `reached_proposal` is null. */
  reachedProposal: { reached: number; of: number } | null;
}

/** The day with the most failed turns, when it stands out from the window. */
export interface AiWorstDay {
  day: string;
  turns: number;
  failed: number;
  /** The tool with the most failed calls that day, if any call failed. */
  tool: string | null;
}

/** Everything the AI models tab draws. Counts, tokens, ms, bytes, micro-dollars. */
export interface AiModelsReport {
  windowDays: number;
  turns: number;
  previousTurns: number;
  accounts: number;
  medianStepsPerTurn: number | null;
  /** Turns with at least one step row — the denominator of every per-step rate. */
  measuredTurns: number;
  toolCalls: {
    total: number;
    medianPerTurn: number | null;
    p95PerTurn: number | null;
    failed: number;
    repaired: number;
  };
  contextPerStep: { median: number; p95: number } | null;
  /** `outcome = 'error'`. An abort is a user leaving, not a failure. */
  failedTurns: number;
  worstDay: AiWorstDay | null;
  days: AiTurnsDay[];
  taskClasses: { question: number; change: number; compose: number };
  escalatedTurns: number;
  contextByStep: AiContextStep[];
  cacheReadShare: number | null;
  turnsOver32k: number;
  /** Mean growth in median input from one step column to the next; `null` under two columns. */
  growthPerStep: number | null;
  models: AiModelRow[];
  tools: AiToolRow[];
  /** Registered tools called in under 1% of measured turns, fewest calls first. */
  rarelyCalled: { tool: string; calls: number }[];
  /**
   * Turns that took steps (`steps > 0`) and have no step row: the child write
   * failed (it is a second transaction, `recordTurnLedger`). Turn counts are
   * right; tool and context numbers undercount. `since` is the earliest.
   */
  ledgerGap: { turns: number; since: string | null };
}

/**
 * Linear-interpolated percentile of an ascending list — `percentile_cont`'s
 * definition, so a number here matches the `ai-usage` skill's SQL.
 */
function percentile(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const rank = p * (sorted.length - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  return sorted[low]! + (sorted[high]! - sorted[low]!) * (rank - low);
}

const ascending = (values: Iterable<number>) => [...values].sort((a, b) => a - b);
const median = (values: Iterable<number>) => percentile(ascending(values), 0.5);

const notSimulated = sql`${aiUsage.turnModel} NOT LIKE 'simulated/%'`;

/**
 * The AI models tab's whole read, for the 30 days before `now`.
 *
 * `registeredTools` is the assistant's tool registry by name, passed in rather
 * than imported: the registry is the assistant's and reaches trip tools, and
 * this module knows no trips (ADR-045 rule 5). It is what *almost never
 * called* is measured against — a tool with no calls has no ledger row.
 */
export async function aiModelsReport(
  registeredTools: readonly string[],
  now: Date = new Date(),
): Promise<AiModelsReport> {
  const since = new Date(now.getTime() - TRAILING_WINDOW_DAYS * DAY_MS);
  const previousSince = new Date(since.getTime() - TRAILING_WINDOW_DAYS * DAY_MS);
  const inWindow = and(gte(aiUsage.createdAt, since), lt(aiUsage.createdAt, now), notSimulated);

  const [turns, steps, calls, [previous]] = await Promise.all([
    db
      .select({
        id: aiUsage.id,
        userId: aiUsage.userId,
        outcome: aiUsage.outcome,
        taskClass: aiUsage.taskClass,
        steps: aiUsage.steps,
        classifierModel: aiUsage.classifierModel,
        classifierTokensIn: aiUsage.classifierTokensIn,
        classifierTokensOut: aiUsage.classifierTokensOut,
        createdAt: aiUsage.createdAt,
      })
      .from(aiUsage)
      .where(inWindow),
    db
      .select({
        turnId: aiUsageSteps.turnId,
        stepIndex: aiUsageSteps.stepIndex,
        model: aiUsageSteps.model,
        tier: aiUsageSteps.tier,
        tokensIn: aiUsageSteps.tokensIn,
        cacheReadTokens: aiUsageSteps.cacheReadTokens,
        cacheWriteTokens: aiUsageSteps.cacheWriteTokens,
        tokensOut: aiUsageSteps.tokensOut,
        escalated: aiUsageSteps.escalated,
        durationMs: aiUsageSteps.durationMs,
        createdAt: aiUsageSteps.createdAt,
      })
      .from(aiUsageSteps)
      .innerJoin(aiUsage, eq(aiUsage.id, aiUsageSteps.turnId))
      .where(inWindow),
    db
      .select({
        turnId: aiUsageToolCalls.turnId,
        tool: aiUsageToolCalls.tool,
        outcome: aiUsageToolCalls.outcome,
        durationMs: aiUsageToolCalls.durationMs,
        outputBytes: aiUsageToolCalls.outputBytes,
        reachedProposal: aiUsageToolCalls.reachedProposal,
      })
      .from(aiUsageToolCalls)
      .innerJoin(aiUsage, eq(aiUsage.id, aiUsageToolCalls.turnId))
      .where(inWindow),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(aiUsage)
      .where(and(gte(aiUsage.createdAt, previousSince), lt(aiUsage.createdAt, since), notSimulated)),
  ]);

  const dayOf = (at: Date) => Math.min(TRAILING_WINDOW_DAYS - 1, Math.floor((at.getTime() - since.getTime()) / DAY_MS));
  const turnDay = new Map(turns.map((turn) => [turn.id, dayOf(turn.createdAt)]));

  // --- turns and days
  const days: AiTurnsDay[] = Array.from({ length: TRAILING_WINDOW_DAYS }, (_, i) => ({
    day: new Date(since.getTime() + i * DAY_MS).toISOString(),
    turns: 0,
    failed: 0,
  }));
  const taskClasses = { question: 0, change: 0, compose: 0 };
  for (const turn of turns) {
    const day = days[turnDay.get(turn.id)!]!;
    day.turns += 1;
    if (turn.outcome === "error") day.failed += 1;
    if (turn.taskClass === "question") taskClasses.question += 1;
    else if (turn.taskClass === "edit" || turn.taskClass === "plan") taskClasses.change += 1;
    else if (turn.taskClass === "compose") taskClasses.compose += 1;
  }
  const failedTurns = days.reduce((sum, day) => sum + day.failed, 0);

  // --- steps: which turns were measured, context, escalation
  const measured = new Set(steps.map((step) => step.turnId));
  const escalated = new Set(steps.filter((step) => step.escalated).map((step) => step.turnId));
  const over32k = new Set(
    steps.filter((step) => (step.tokensIn ?? 0) > LONG_CONTEXT_TOKENS).map((step) => step.turnId),
  );
  const contextTokens = ascending(steps.flatMap((step) => (step.tokensIn === null ? [] : [step.tokensIn])));
  const buckets = new Map<number, { tokens: number[]; turns: Set<string> }>();
  let cacheRead = 0;
  let cacheBase = 0;
  for (const step of steps) {
    const index = Math.min(step.stepIndex, LAST_STEP_BUCKET);
    const bucket = buckets.get(index) ?? { tokens: [], turns: new Set<string>() };
    bucket.turns.add(step.turnId);
    if (step.tokensIn !== null) bucket.tokens.push(step.tokensIn);
    buckets.set(index, bucket);
    if (step.tokensIn !== null && step.cacheReadTokens !== null) {
      cacheRead += step.cacheReadTokens;
      cacheBase += step.tokensIn;
    }
  }
  const contextByStep: AiContextStep[] = [...buckets.entries()]
    .sort(([a], [b]) => a - b)
    .flatMap(([index, bucket]) => {
      const sorted = ascending(bucket.tokens);
      if (sorted.length === 0) return [];
      return [
        {
          step: index === LAST_STEP_BUCKET ? `${LAST_STEP_BUCKET + 1}+` : String(index + 1),
          median: percentile(sorted, 0.5)!,
          p95: percentile(sorted, 0.95)!,
          turns: bucket.turns.size,
        },
      ];
    });
  const growthPerStep =
    contextByStep.length < 2
      ? null
      : (contextByStep.at(-1)!.median - contextByStep[0]!.median) / (contextByStep.length - 1);

  // --- tool calls
  const callsPerTurn = new Map<string, number>([...measured].map((id) => [id, 0]));
  const byTool = new Map<
    string,
    { calls: number; turns: Set<string>; failed: number; repaired: number; ms: number[]; bytes: number[]; reached: number; of: number }
  >();
  const failedByDayTool = new Map<string, number>();
  for (const call of calls) {
    callsPerTurn.set(call.turnId, (callsPerTurn.get(call.turnId) ?? 0) + 1);
    const row = byTool.get(call.tool) ?? {
      calls: 0, turns: new Set<string>(), failed: 0, repaired: 0, ms: [], bytes: [], reached: 0, of: 0,
    };
    row.calls += 1;
    row.turns.add(call.turnId);
    if (call.outcome === "failed") {
      row.failed += 1;
      const key = `${turnDay.get(call.turnId)}|${call.tool}`;
      failedByDayTool.set(key, (failedByDayTool.get(key) ?? 0) + 1);
    }
    if (call.outcome === "repaired") row.repaired += 1;
    if (call.durationMs !== null) row.ms.push(call.durationMs);
    if (call.outputBytes !== null) row.bytes.push(call.outputBytes);
    if (call.reachedProposal !== null) {
      row.of += 1;
      if (call.reachedProposal) row.reached += 1;
    }
    byTool.set(call.tool, row);
  }
  const perTurn = ascending(callsPerTurn.values());
  const tools: AiToolRow[] = [...byTool.entries()]
    .map(([tool, row]) => ({
      tool,
      calls: row.calls,
      turns: row.turns.size,
      failed: row.failed,
      repaired: row.repaired,
      medianDurationMs: median(row.ms),
      medianOutputBytes: median(row.bytes),
      reachedProposal: row.of === 0 ? null : { reached: row.reached, of: row.of },
    }))
    .sort((a, b) => b.calls - a.calls || a.tool.localeCompare(b.tool));
  const rarelyCalled = registeredTools
    .map((tool) => ({ tool, calls: byTool.get(tool)?.calls ?? 0, turns: byTool.get(tool)?.turns.size ?? 0 }))
    .filter((row) => measured.size > 0 && row.turns / measured.size < RARELY_CALLED_SHARE)
    .map(({ tool, calls: count }) => ({ tool, calls: count }))
    .sort((a, b) => a.calls - b.calls || a.tool.localeCompare(b.tool));

  // --- the worst day, named only when it stands out: at least twice the
  // window's failure rate. A uniformly bad month has no worst day to blame.
  let worstDay: AiWorstDay | null = null;
  const worst = days.reduce<AiTurnsDay | null>((best, day) => (day.failed > (best?.failed ?? 0) ? day : best), null);
  if (worst !== null && turns.length > 0 && worst.failed / worst.turns >= (2 * failedTurns) / turns.length) {
    const index = days.indexOf(worst);
    const blamed = [...failedByDayTool.entries()]
      .filter(([key]) => key.startsWith(`${index}|`))
      .sort(([a, x], [b, y]) => y - x || a.localeCompare(b))[0];
    worstDay = { day: worst.day, turns: worst.turns, failed: worst.failed, tool: blamed ? blamed[0].split("|")[1]! : null };
  }

  // --- models: per step at the model it ran on, then the classifier
  const byModel = new Map<
    string,
    { roles: Set<string>; calls: number; tokensIn: number; ms: number[]; cost: number; unpriced: number; read: number; base: number }
  >();
  const modelRow = (model: string) => {
    const row = byModel.get(model) ?? {
      roles: new Set<string>(), calls: 0, tokensIn: 0, ms: [], cost: 0, unpriced: 0, read: 0, base: 0,
    };
    byModel.set(model, row);
    return row;
  };
  for (const step of steps) {
    const row = modelRow(step.model);
    if (step.tier !== null) row.roles.add(step.tier);
    row.calls += 1;
    row.tokensIn += step.tokensIn ?? 0;
    if (step.durationMs !== null) row.ms.push(step.durationMs);
    if (step.tokensIn !== null && step.cacheReadTokens !== null) {
      row.read += step.cacheReadTokens;
      row.base += step.tokensIn;
    }
    const cost = microUsdFor(
      step.model, step.tokensIn, step.tokensOut, step.createdAt, undefined, step.cacheReadTokens, step.cacheWriteTokens,
    );
    if (cost === null) row.unpriced += 1;
    else row.cost += cost;
  }
  // The classifier is keyed apart from the turn models even when one id fills
  // both slots: *"did the classifier save more than it cost"* needs its spend
  // on its own (the schema's note on `ai_usage`).
  const classifiers = new Map<string, ReturnType<typeof modelRow>>();
  for (const turn of turns) {
    if (turn.classifierModel === null) continue;
    const row = classifiers.get(turn.classifierModel) ?? {
      roles: new Set(["classifier"]), calls: 0, tokensIn: 0, ms: [], cost: 0, unpriced: 0, read: 0, base: 0,
    };
    classifiers.set(turn.classifierModel, row);
    row.calls += 1;
    row.tokensIn += turn.classifierTokensIn ?? 0;
    const cost = microUsdFor(turn.classifierModel, turn.classifierTokensIn, turn.classifierTokensOut, turn.createdAt);
    if (cost === null) row.unpriced += 1;
    else row.cost += cost;
  }
  const toModelRow =
    (classifier: boolean) =>
    ([model, row]: [string, ReturnType<typeof modelRow>]): AiModelRow => ({
      model,
      roles: [...row.roles].sort(),
      calls: row.calls,
      tokensIn: row.tokensIn,
      medianDurationMs: classifier ? null : median(row.ms),
      costMicroUsd: row.cost,
      unpriced: row.unpriced,
      cacheReadShare: row.base === 0 ? null : row.read / row.base,
    });
  const models = [
    ...[...byModel.entries()].map(toModelRow(false)).sort((a, b) => b.calls - a.calls || a.model.localeCompare(b.model)),
    ...[...classifiers.entries()].map(toModelRow(true)).sort((a, b) => b.calls - a.calls),
  ];

  // --- the gap: turns that took steps and wrote none
  const gap = turns.filter((turn) => turn.steps > 0 && !measured.has(turn.id));
  const gapSince = gap.reduce<Date | null>((earliest, turn) => (earliest === null || turn.createdAt < earliest ? turn.createdAt : earliest), null);

  return {
    windowDays: TRAILING_WINDOW_DAYS,
    turns: turns.length,
    previousTurns: previous?.count ?? 0,
    accounts: new Set(turns.map((turn) => turn.userId)).size,
    medianStepsPerTurn: median(turns.map((turn) => turn.steps)),
    measuredTurns: measured.size,
    toolCalls: {
      total: calls.length,
      medianPerTurn: percentile(perTurn, 0.5),
      p95PerTurn: percentile(perTurn, 0.95),
      failed: calls.filter((call) => call.outcome === "failed").length,
      repaired: calls.filter((call) => call.outcome === "repaired").length,
    },
    contextPerStep:
      contextTokens.length === 0
        ? null
        : { median: percentile(contextTokens, 0.5)!, p95: percentile(contextTokens, 0.95)! },
    failedTurns,
    worstDay,
    days,
    taskClasses,
    escalatedTurns: escalated.size,
    contextByStep,
    cacheReadShare: cacheBase === 0 ? null : cacheRead / cacheBase,
    turnsOver32k: over32k.size,
    growthPerStep,
    models,
    tools,
    rarelyCalled,
    ledgerGap: { turns: gap.length, since: gapSince?.toISOString() ?? null },
  };
}
