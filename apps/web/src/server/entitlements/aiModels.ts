// **The AI models tab's one read** (M36 link 4) — the ledger M31 built, per
// turn, per step and per tool call, which no admin surface read until now.
//
// **Thirty UTC calendar days, today the last and so far, and the same span
// before them for one number** (D10): the turns delta. Calendar days rather
// than `now − 30 × 24h`, so a bar's label is the day its turns happened on — a
// now-anchored bucket straddles two dates and the chart would name the wrong
// one for half of it. **Except cost**, which is Financial's window exactly
// (`trailingWindowStart`, `now − 30 × 24h`): up to a day longer at the start,
// and a models table that read the calendar window would not add up to
// Financial's column by as much as a day of spend.
//
// **Tool calls are aggregated in SQL; steps are read as rows.** A tool-call
// row is only ever counted, and `percentile_cont` is the median the `ai-usage`
// skill takes, so nothing is gained by shipping every call here. Steps have to
// be priced in TypeScript — the rate record is a committed file
// (`modelRates.ts`), for the reason `costPerAccount` gives — and each step is
// rounded on its own, so summing tokens in SQL first would move the total off
// Financial's. The step volume is the one the console already reads on every
// load: `costPerAccount` selects every step in the same window, Financial's.
//
// **A step or tool call belongs to the window its TURN is in**, joined on
// `ai_usage.id`, so a turn is never half in and half out. The writer stamps
// all three rows with one `now`, so the two readings agree except across a
// replayed write, where the turn's own time is the honest one.
//
// **Simulated turns are left out of every count** (`turn_model =
// 'simulated/…'`, ai-live off), as the `ai-usage` skill's queries leave them
// out: they spend nothing and their tool calls are scripted, so they would
// dilute every rate on this tab with a number nobody's question produced.
// **They are priced, though**, because `costPerAccount` prices every row: no
// rate is published for `simulated/…`, so each is one of `unpricedTurns`, as
// it is one of Financial's `unpriced`.
//
// **Cost is Financial's rule, turn by turn** (D10, `microUsdForRow`): per step
// at the model each ran on when every step prices, else the turn's own totals
// at `turn_model` — carried on that model's row — and a turn that cannot be
// priced either way, or whose classifier cannot, adds nothing anywhere. So the
// models' costs sum to what `costPerAccount` sums over its window, and
// `unpricedTurns` is its `unpriced` (`aiModels.int.test.ts`). **No dollars stored and no `Money`**
// (`usage.noMoney.test.ts`): micro-dollars throughout. **No content either**
// (D7): nothing here selects a column a question or an answer could be in,
// because there is none.
import { and, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { aiUsage, aiUsageSteps, aiUsageToolCalls } from "@/server/db/schema";
import { microUsdFor } from "./modelRates";
import { TRAILING_WINDOW_DAYS, trailingWindowStart } from "./admin";

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

/** One UTC calendar day of turns, oldest first. `day` is its midnight, ISO-8601. */
export interface AiTurnsDay {
  day: string;
  turns: number;
  failed: number;
}

/**
 * One column of *Context size by step*: input tokens at that step. The *8+*
 * column takes one value per turn, its deepest step's, so a turn of twenty
 * steps weighs no more than a turn of eight.
 */
export interface AiContextStep {
  /** `"1"`…`"7"`, then `"8+"` — 1-based, as the design labels it. */
  step: string;
  median: number;
  p95: number;
  /** Turns that got this far — that have a step row in this column. */
  turns: number;
}

/**
 * One model's row in *Models*. Its counts are the calendar window's, like the
 * rest of the tab; its cost and `turnPriced` are Financial's window.
 */
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
  /** What Financial's rule puts on this model — see the module comment. */
  costMicroUsd: number;
  /**
   * Calls with no published rate or no reported usage. A step's turn is then
   * priced at its turn level (`turnPriced`, on the turn model's row); a
   * classifier call's turn is not priced at all (`unpricedTurns`).
   */
  unpriced: number;
  /**
   * Turns priced at their own totals and carried here as their `turn_model`:
   * a step could not be priced, or the turn wrote no step rows.
   */
  turnPriced: number;
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
  /** Turns in the span of the same length just before the window. */
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
  /**
   * First-to-last column rise in median input, over the columns between —
   * an average slope across turn populations that thin out step by step, not
   * one turn's growth. `null` under two columns.
   */
  growthPerStep: number | null;
  models: AiModelRow[];
  /**
   * Turns in Financial's window neither rule could price — its `unpriced`,
   * simulated turns included — so every cost is a floor.
   */
  unpricedTurns: number;
  tools: AiToolRow[];
  /** Registered tools called in under 1% of measured turns, fewest calls first. */
  rarelyCalled: { tool: string; calls: number }[];
  /**
   * Turns that took steps (`steps > 0`) and have no step row: the child write
   * failed (it is a second transaction, `recordTurnLedger`). Turn counts are
   * right, and so is cost — it falls back to the turn row, as Financial's
   * does; tool and context numbers undercount. `since` is the earliest.
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
 * The AI models tab's whole read, for the 30 UTC days ending with `now`'s —
 * its costs for Financial's 30 × 24 hours to `now`.
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
  const today = Math.floor(now.getTime() / DAY_MS) * DAY_MS;
  const since = new Date(today - (TRAILING_WINDOW_DAYS - 1) * DAY_MS);
  // As long as the current window, today's part-day included: a full thirty
  // days against twenty-nine and a part would read flat traffic as a decline.
  const previousSince = new Date(since.getTime() - (now.getTime() - since.getTime()));
  const inWindow = and(gte(aiUsage.createdAt, since), lt(aiUsage.createdAt, now), notSimulated);
  // Financial's window, simulated turns and all: what `costPerAccount` prices.
  // It starts at or before `since`, so it holds every counted turn too.
  const inPricing = and(gte(aiUsage.createdAt, trailingWindowStart(now)), lt(aiUsage.createdAt, now));
  const call = aiUsageToolCalls;

  const [priced, pricedSteps, toolRows, turnCallRows, failedRows, [previous]] = await Promise.all([
    db
      .select({
        id: aiUsage.id,
        userId: aiUsage.userId,
        outcome: aiUsage.outcome,
        taskClass: aiUsage.taskClass,
        turnModel: aiUsage.turnModel,
        turnTokensIn: aiUsage.turnTokensIn,
        turnTokensOut: aiUsage.turnTokensOut,
        steps: aiUsage.steps,
        classifierModel: aiUsage.classifierModel,
        classifierTokensIn: aiUsage.classifierTokensIn,
        classifierTokensOut: aiUsage.classifierTokensOut,
        createdAt: aiUsage.createdAt,
      })
      .from(aiUsage)
      .where(inPricing),
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
      })
      .from(aiUsageSteps)
      .innerJoin(aiUsage, eq(aiUsage.id, aiUsageSteps.turnId))
      .where(inPricing),
    // One row per tool. `percentile_cont` skips nulls and is null over none,
    // which is what a duration or a size nobody measured should do. `turns`
    // counts measured turns only — the tab divides it by `measuredTurns`.
    db
      .select({
        tool: call.tool,
        calls: sql<number>`count(*)::int`,
        turns: sql<number>`(count(DISTINCT ${call.turnId}) FILTER (WHERE EXISTS (SELECT 1 FROM ${aiUsageSteps} WHERE ${aiUsageSteps.turnId} = ${call.turnId})))::int`,
        failed: sql<number>`(count(*) FILTER (WHERE ${call.outcome} = 'failed'))::int`,
        repaired: sql<number>`(count(*) FILTER (WHERE ${call.outcome} = 'repaired'))::int`,
        medianDurationMs: sql<number | null>`percentile_cont(0.5) WITHIN GROUP (ORDER BY ${call.durationMs})`,
        medianOutputBytes: sql<number | null>`percentile_cont(0.5) WITHIN GROUP (ORDER BY ${call.outputBytes})`,
        reached: sql<number>`(count(*) FILTER (WHERE ${call.reachedProposal}))::int`,
        of: sql<number>`count(${call.reachedProposal})::int`,
      })
      .from(call)
      .innerJoin(aiUsage, eq(aiUsage.id, call.turnId))
      .where(inWindow)
      .groupBy(call.tool),
    // Calls a turn: one row per turn that called anything.
    db
      .select({ turnId: call.turnId, calls: sql<number>`count(*)::int` })
      .from(call)
      .innerJoin(aiUsage, eq(aiUsage.id, call.turnId))
      .where(inWindow)
      .groupBy(call.turnId),
    // Which tool failed in which turn — only the pairs that did, for naming
    // the worst day's tool. This and the read above were one row per tool a
    // turn called, ~73k rows at 20k turns shipped to count two things that
    // are a turn's total and the rare failure (M36 perf pass).
    db
      .select({
        turnId: call.turnId,
        tool: call.tool,
        failed: sql<number>`(count(*) FILTER (WHERE ${call.outcome} = 'failed'))::int`,
      })
      .from(call)
      .innerJoin(aiUsage, eq(aiUsage.id, call.turnId))
      .where(and(inWindow, eq(call.outcome, "failed")))
      .groupBy(call.turnId, call.tool),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(aiUsage)
      .where(and(gte(aiUsage.createdAt, previousSince), lt(aiUsage.createdAt, since), notSimulated)),
  ]);

  // The counted turns: the calendar window, simulated ones out.
  const turns = priced.filter(
    (turn) => turn.createdAt >= since && !turn.turnModel.startsWith("simulated/"),
  );
  const counted = new Set(turns.map((turn) => turn.id));
  const steps = pricedSteps.filter((step) => counted.has(step.turnId));

  const turnDay = new Map(
    turns.map((turn) => [turn.id, Math.floor((turn.createdAt.getTime() - since.getTime()) / DAY_MS)]),
  );

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
  const stepsByTurn = new Map<string, (typeof steps)[number][]>();
  for (const step of pricedSteps) {
    const list = stepsByTurn.get(step.turnId) ?? [];
    list.push(step);
    stepsByTurn.set(step.turnId, list);
  }
  const measured = new Set(steps.map((step) => step.turnId));
  const escalated = new Set(steps.filter((step) => step.escalated).map((step) => step.turnId));
  const over32k = new Set(
    steps.filter((step) => (step.tokensIn ?? 0) > LONG_CONTEXT_TOKENS).map((step) => step.turnId),
  );
  const contextTokens = ascending(steps.flatMap((step) => (step.tokensIn === null ? [] : [step.tokensIn])));
  const buckets = new Map<number, { tokens: number[]; turns: Set<string> }>();
  // The 8+ column's one value per turn: its deepest step that reported input.
  const deepest = new Map<string, { stepIndex: number; tokensIn: number }>();
  let cacheRead = 0;
  let cacheBase = 0;
  for (const step of steps) {
    const index = Math.min(step.stepIndex, LAST_STEP_BUCKET);
    const bucket = buckets.get(index) ?? { tokens: [], turns: new Set<string>() };
    bucket.turns.add(step.turnId);
    buckets.set(index, bucket);
    if (step.tokensIn !== null) {
      if (index < LAST_STEP_BUCKET) bucket.tokens.push(step.tokensIn);
      else if (step.stepIndex > (deepest.get(step.turnId)?.stepIndex ?? -1)) {
        deepest.set(step.turnId, { stepIndex: step.stepIndex, tokensIn: step.tokensIn });
      }
    }
    if (step.tokensIn !== null && step.cacheReadTokens !== null) {
      cacheRead += step.cacheReadTokens;
      cacheBase += step.tokensIn;
    }
  }
  for (const { tokensIn } of deepest.values()) buckets.get(LAST_STEP_BUCKET)!.tokens.push(tokensIn);
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

  // --- tool calls. Calls a turn is over measured turns only, the same
  // denominator as *in turns*: a turn with calls and no step rows cannot come
  // from the writer (both go in one transaction), and if one ever did, it would
  // be a turn in no other per-step number on this tab.
  const callsPerTurn = new Map<string, number>([...measured].map((id) => [id, 0]));
  const failedByDayTool = new Map<string, number>();
  for (const row of turnCallRows) {
    if (measured.has(row.turnId)) callsPerTurn.set(row.turnId, callsPerTurn.get(row.turnId)! + row.calls);
  }
  for (const row of failedRows) {
    const key = `${turnDay.get(row.turnId)}|${row.tool}`;
    failedByDayTool.set(key, (failedByDayTool.get(key) ?? 0) + row.failed);
  }
  const perTurn = ascending(callsPerTurn.values());
  const tools: AiToolRow[] = toolRows
    .map((row) => ({
      tool: row.tool,
      calls: row.calls,
      turns: row.turns,
      failed: row.failed,
      repaired: row.repaired,
      medianDurationMs: row.medianDurationMs,
      medianOutputBytes: row.medianOutputBytes,
      reachedProposal: row.of === 0 ? null : { reached: row.reached, of: row.of },
    }))
    .sort((a, b) => b.calls - a.calls || a.tool.localeCompare(b.tool));
  const byTool = new Map(tools.map((row) => [row.tool, row]));
  const rarelyCalled = registeredTools
    .map((tool) => ({ tool, calls: byTool.get(tool)?.calls ?? 0, turns: byTool.get(tool)?.turns ?? 0 }))
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

  // --- models: counts per step at the model it ran on, then the classifier;
  // counted turns only. Cost over every turn Financial prices — a row a turn
  // outside the counts reaches carries cost and nothing else.
  type ModelTally = {
    roles: Set<string>; calls: number; tokensIn: number; ms: number[];
    cost: number; unpriced: number; turnPriced: number; read: number; base: number;
  };
  const tally = (roles: string[] = []): ModelTally => ({
    roles: new Set(roles), calls: 0, tokensIn: 0, ms: [], cost: 0, unpriced: 0, turnPriced: 0, read: 0, base: 0,
  });
  const byModel = new Map<string, ModelTally>();
  const modelRow = (model: string) => {
    const row = byModel.get(model) ?? tally();
    byModel.set(model, row);
    return row;
  };
  // The classifier is keyed apart from the turn models even when one id fills
  // both slots: *"did the classifier save more than it cost"* needs its spend
  // on its own (the schema's note on `ai_usage`).
  const classifiers = new Map<string, ModelTally>();
  const classifierRow = (model: string) => {
    const row = classifiers.get(model) ?? tally(["classifier"]);
    classifiers.set(model, row);
    return row;
  };
  let unpricedTurns = 0;
  for (const turn of priced) {
    // Priced at the TURN's date, as `costPerAccount` prices it — one turn,
    // one rate lookup, even across a replayed step write.
    const at = turn.createdAt;
    const turnSteps = stepsByTurn.get(turn.id) ?? [];
    const stepCosts = turnSteps.map((step) =>
      microUsdFor(step.model, step.tokensIn, step.tokensOut, at, undefined, step.cacheReadTokens, step.cacheWriteTokens),
    );
    const classifierCost =
      turn.classifierModel === null
        ? null
        : microUsdFor(turn.classifierModel, turn.classifierTokensIn, turn.classifierTokensOut, at);
    if (counted.has(turn.id)) {
      turnSteps.forEach((step, i) => {
        const row = modelRow(step.model);
        if (step.tier !== null) row.roles.add(step.tier);
        row.calls += 1;
        row.tokensIn += step.tokensIn ?? 0;
        if (step.durationMs !== null) row.ms.push(step.durationMs);
        if (step.tokensIn !== null && step.cacheReadTokens !== null) {
          row.read += step.cacheReadTokens;
          row.base += step.tokensIn;
        }
        if (stepCosts[i] === null) row.unpriced += 1;
      });
      if (turn.classifierModel !== null) {
        const row = classifierRow(turn.classifierModel);
        row.calls += 1;
        row.tokensIn += turn.classifierTokensIn ?? 0;
        if (classifierCost === null) row.unpriced += 1;
      }
    }
    // `microUsdForRow`, attributed: every step priced → each at its model;
    // else the turn's totals at `turn_model`; else, or with an unpriceable
    // classifier, nothing — a turn partly unknown is not its known part.
    const perStep = turnSteps.length > 0 && stepCosts.every((cost) => cost !== null);
    const turnLevel = perStep
      ? null
      : microUsdFor(turn.turnModel, turn.turnTokensIn, turn.turnTokensOut, at);
    if ((!perStep && turnLevel === null) || (turn.classifierModel !== null && classifierCost === null)) {
      unpricedTurns += 1;
      continue;
    }
    if (perStep) turnSteps.forEach((step, i) => (modelRow(step.model).cost += stepCosts[i]!));
    else {
      const row = modelRow(turn.turnModel);
      row.cost += turnLevel!;
      row.turnPriced += 1;
    }
    if (turn.classifierModel !== null) classifierRow(turn.classifierModel).cost += classifierCost!;
  }
  const toModelRow =
    (isClassifier: boolean) =>
    ([model, row]: [string, ModelTally]): AiModelRow => ({
      model,
      roles: [...row.roles].sort(),
      calls: row.calls,
      tokensIn: row.tokensIn,
      medianDurationMs: isClassifier ? null : median(row.ms),
      costMicroUsd: row.cost,
      unpriced: row.unpriced,
      turnPriced: row.turnPriced,
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
      total: tools.reduce((sum, row) => sum + row.calls, 0),
      medianPerTurn: percentile(perTurn, 0.5),
      p95PerTurn: percentile(perTurn, 0.95),
      failed: tools.reduce((sum, row) => sum + row.failed, 0),
      repaired: tools.reduce((sum, row) => sum + row.repaired, 0),
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
    unpricedTurns,
    tools,
    rarelyCalled,
    ledgerGap: { turns: gap.length, since: gapSince?.toISOString() ?? null },
  };
}
