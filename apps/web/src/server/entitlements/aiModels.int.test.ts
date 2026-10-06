// **The AI models tab's aggregates** (M36 link 4), against a real database.
//
// The gate box: *"turns, tool calls a turn, context per step by `step_index`,
// per-model and per-tool rows — each seen red."*
//
// **Each test reads its own far-future month.** `aiModelsReport` aggregates
// every account, and other integration files write `ai_usage` rows at the
// real `now`; a window in 2041+ holds only the rows the test put there.
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { aiUsage, aiUsageSteps, aiUsageToolCalls } from "@/server/db/schema";
import { trailingWindowStart } from "./admin";
import { microUsdFor } from "./modelRates";
import { costPerAccount } from "./usage";
import { aiModelsReport } from "./aiModels";

const DAY = 24 * 60 * 60 * 1000;
const CHEAP = "zai/glm-5.3-flash";
const STRONG = "zai/glm-5.3";
const CLASSIFIER = "zai/glm-4.7-flash";
const FLASHX = "zai/glm-4.7-flashx";

let year = 2041;
/** A fresh month nobody else writes into, and the `now` that reads it. */
function freshNow(): Date {
  year += 1;
  return new Date(`${year}-06-30T12:00:00.000Z`);
}

interface StepSpec {
  model?: string;
  tier?: string | null;
  tokensIn?: number | null;
  cacheRead?: number | null;
  tokensOut?: number | null;
  escalated?: boolean;
  durationMs?: number | null;
}
interface CallSpec {
  tool: string;
  outcome?: string;
  durationMs?: number | null;
  outputBytes?: number | null;
  reachedProposal?: boolean | null;
}

/** One turn, its step rows and its tool-call rows, all stamped `at`. */
async function turn(
  at: Date,
  {
    userId = `dev-${randomUUID()}`,
    outcome = "completed",
    taskClass = "question",
    turnModel = CHEAP,
    classifier = null as { tokensIn: number; tokensOut: number | null } | null,
    steps = [] as StepSpec[],
    calls = [] as CallSpec[],
    stepCount,
  }: {
    userId?: string;
    outcome?: string;
    taskClass?: string;
    turnModel?: string;
    classifier?: { tokensIn: number; tokensOut: number | null } | null;
    steps?: StepSpec[];
    calls?: CallSpec[];
    /** `ai_usage.steps` when it should differ from the rows written (a ledger gap). */
    stepCount?: number;
  } = {},
): Promise<string> {
  const id = randomUUID();
  await db.insert(aiUsage).values({
    id,
    userId,
    endpoint: "ask",
    outcome,
    taskClass,
    turnModel,
    turnTokensIn: 100,
    turnTokensOut: 10,
    classifierModel: classifier ? CLASSIFIER : null,
    classifierTokensIn: classifier?.tokensIn ?? null,
    classifierTokensOut: classifier?.tokensOut ?? null,
    steps: stepCount ?? steps.length,
    planVersionRef: "plus@v1",
    latencyMs: null,
    createdAt: at,
  });
  if (steps.length > 0) {
    await db.insert(aiUsageSteps).values(
      steps.map((step, index) => ({
        turnId: id,
        stepIndex: index,
        model: step.model ?? CHEAP,
        tier: step.tier === undefined ? "cheap" : step.tier,
        tokensIn: step.tokensIn === undefined ? 1000 : step.tokensIn,
        cacheReadTokens: step.cacheRead === undefined ? null : step.cacheRead,
        cacheWriteTokens: null,
        tokensOut: step.tokensOut === undefined ? 50 : step.tokensOut,
        finishReason: "stop",
        escalated: step.escalated ?? false,
        pivoted: false,
        durationMs: step.durationMs === undefined ? 1000 : step.durationMs,
        provider: null,
        gatewayGenerationId: null,
        createdAt: at,
      })),
    );
  }
  if (calls.length > 0) {
    await db.insert(aiUsageToolCalls).values(
      calls.map((call, index) => ({
        turnId: id,
        callId: `call_${index}`,
        stepIndex: 0,
        tool: call.tool,
        outcome: call.outcome ?? "ok",
        durationMs: call.durationMs === undefined ? 10 : call.durationMs,
        inputBytes: 10,
        outputBytes: call.outputBytes === undefined ? 100 : call.outputBytes,
        reachedProposal: call.reachedProposal === undefined ? null : call.reachedProposal,
        createdAt: at,
      })),
    );
  }
  return id;
}

const daysBefore = (now: Date, days: number) => new Date(now.getTime() - days * DAY);
/** UTC midnight of the day `days` before `now`'s — a day bucket's label. */
const midnightBefore = (now: Date, days: number) =>
  new Date(Math.floor(now.getTime() / DAY) * DAY - days * DAY).toISOString();

describe("turns over the trailing 30 days", () => {
  it("counts turns and accounts in the window, the span before it for the delta, and nothing older", async () => {
    const now = freshNow();
    const userA = `dev-${randomUUID()}`;
    await turn(daysBefore(now, 1), { userId: userA, steps: [{}, {}] });
    await turn(daysBefore(now, 5), { userId: userA, steps: [{}, {}, {}, {}], outcome: "error" });
    await turn(daysBefore(now, 29), { steps: [{}], taskClass: "edit" });
    // The previous window — counted for the delta only. The second is 29.5 ×
    // 24h ago less an hour, on the calendar day before the window's first.
    await turn(daysBefore(now, 45), { steps: [{}], calls: [{ tool: "read_trip" }] });
    await turn(new Date(Date.parse(midnightBefore(now, 29)) - 60 * 60 * 1000), { steps: [{}] });
    // Older than both windows, with steps and a call — none of it may count.
    await turn(daysBefore(now, 61), { steps: [{ tokensIn: 99_999 }], calls: [{ tool: "read_trip" }] });
    // ai-live off: spends nothing, scripted calls.
    await turn(daysBefore(now, 2), { turnModel: "simulated/no-op", steps: [{}], calls: [{ tool: "read_trip" }] });

    const report = await aiModelsReport([], now);

    expect(report.turns).toBe(3);
    expect(report.previousTurns).toBe(2);
    // The simulated turn's step row is not a measured turn either.
    expect(report.measuredTurns).toBe(3);
    expect(report.accounts).toBe(2);
    expect(report.medianStepsPerTurn).toBe(2);
    expect(report.failedTurns).toBe(1);
    expect(report.taskClasses).toEqual({ question: 2, change: 1, compose: 0 });
    // The 61-day-old turn's step and call, and the simulated one's, stay out.
    expect(report.tools).toEqual([]);
    expect(report.contextPerStep?.p95).toBeLessThan(99_999);
    // Thirty UTC calendar days, oldest first, today the last; a turn lands on
    // the day its bar is labelled with.
    expect(report.days).toHaveLength(30);
    expect(report.days[0]!.day).toBe(midnightBefore(now, 29));
    expect(report.days.at(-1)!.day).toBe(midnightBefore(now, 0));
    expect(report.days.reduce((sum, day) => sum + day.turns, 0)).toBe(3);
    expect(report.days.at(-2)).toMatchObject({ day: midnightBefore(now, 1), turns: 1, failed: 0 });
    expect(report.days.at(-6)).toMatchObject({ day: midnightBefore(now, 5), turns: 1, failed: 1 });
  });

  it("compares the window with the same span before it, so flat traffic reads as no change", async () => {
    // Noon: the window is 29.5 days long, today being half gone.
    const now = freshNow();
    // A turn every 12 hours, back past both windows.
    for (let k = 0; k < 120; k += 1) await turn(new Date(now.getTime() - (6 + 12 * k) * 60 * 60 * 1000));

    const report = await aiModelsReport([], now);

    expect(report.turns).toBe(59);
    expect(report.previousTurns).toBe(59);
  });
});

describe("tool calls a turn", () => {
  it("is a median and p95 over measured turns, a turn with no calls included", async () => {
    const now = freshNow();
    await turn(daysBefore(now, 1), { steps: [{}] });
    await turn(daysBefore(now, 2), {
      steps: [{}],
      calls: [{ tool: "read_trip" }, { tool: "read_day", outcome: "failed" }],
    });
    await turn(daysBefore(now, 3), {
      steps: [{}],
      calls: [{ tool: "read_trip" }, { tool: "read_trip" }, { tool: "AddActivity", outcome: "repaired" }, { tool: "read_day" }],
    });
    // Calls and no step rows: its calls count, but it is no measured turn, so
    // it is no sample of calls a turn either.
    await turn(daysBefore(now, 4), { calls: Array.from({ length: 6 }, () => ({ tool: "read_trip" })) });

    const report = await aiModelsReport([], now);

    expect(report.measuredTurns).toBe(3);
    expect(report.toolCalls).toEqual({
      total: 12,
      medianPerTurn: 2,
      // percentile_cont over [0, 2, 4]: 2 + (4 − 2) × 0.9.
      p95PerTurn: 3.8,
      failed: 1,
      repaired: 1,
    });
  });
});

describe("context size by step", () => {
  it("buckets by step_index, 1 to 7 and then 8+, with turns that got that far", async () => {
    const now = freshNow();
    // Nine steps: index 7 and 8 are both the 8+ column.
    const long = Array.from({ length: 9 }, (_, i) => ({ tokensIn: 1000 * (i + 1), cacheRead: 500 }));
    await turn(daysBefore(now, 1), { steps: long });
    await turn(daysBefore(now, 2), { steps: [{ tokensIn: 3000, cacheRead: 0 }, { tokensIn: 40_000, cacheRead: 0 }] });

    const report = await aiModelsReport([], now);

    expect(report.contextByStep.map((c) => [c.step, c.median, c.turns])).toEqual([
      ["1", 2000, 2],
      ["2", 21_000, 2],
      ["3", 3000, 1],
      ["4", 4000, 1],
      ["5", 5000, 1],
      ["6", 6000, 1],
      ["7", 7000, 1],
      // One value per turn, its deepest step: 9k, not the 8k and 9k of both.
      ["8+", 9000, 1],
    ]);
    // 2k at step 1 to 9k at 8+, over seven columns between.
    expect(report.growthPerStep).toBe(1000);
    expect(report.contextByStep[0]!.p95).toBeCloseTo(2900);
    // Every step: 11 rows, 1k…9k, 3k and 40k.
    expect(report.contextPerStep?.median).toBe(5000);
    expect(report.turnsOver32k).toBe(1);
    // 9 × 500 cached of (45k + 43k) input.
    expect(report.cacheReadShare).toBeCloseTo(4500 / 88_000);
  });
});

describe("the models table", () => {
  it("prices each step at the model it ran on, and keeps the classifier on its own row", async () => {
    const now = freshNow();
    const at = daysBefore(now, 3);
    await turn(at, {
      classifier: { tokensIn: 200, tokensOut: 5 },
      steps: [
        { model: CHEAP, tier: "cheap", tokensIn: 4000, tokensOut: 100, durationMs: 1000 },
        { model: STRONG, tier: "strong", tokensIn: 6000, tokensOut: 300, escalated: true, durationMs: 4000 },
      ],
    });
    await turn(at, {
      classifier: { tokensIn: 300, tokensOut: 5 },
      steps: [{ model: CHEAP, tier: "cheap", tokensIn: 2000, tokensOut: 50, durationMs: 3000 }],
    });
    // A step model with no published rate: counted and not priced, so the turn
    // is priced at its own totals on its turn model — Financial's fallback.
    await turn(at, { steps: [{ model: "acme/unrated", tier: "mid", tokensIn: 10, tokensOut: 1 }] });

    const report = await aiModelsReport([], now);
    const price = (model: string, tokensIn: number, tokensOut: number) => microUsdFor(model, tokensIn, tokensOut, at)!;

    expect(report.escalatedTurns).toBe(1);
    expect(report.models).toEqual([
      {
        model: CHEAP,
        roles: ["cheap"],
        calls: 2,
        tokensIn: 6000,
        medianDurationMs: 2000,
        costMicroUsd: price(CHEAP, 4000, 100) + price(CHEAP, 2000, 50) + price(CHEAP, 100, 10),
        unpriced: 0,
        turnPriced: 1,
        cacheReadShare: null,
      },
      {
        model: "acme/unrated",
        roles: ["mid"],
        calls: 1,
        tokensIn: 10,
        medianDurationMs: 1000,
        costMicroUsd: 0,
        unpriced: 1,
        turnPriced: 0,
        cacheReadShare: null,
      },
      {
        model: STRONG,
        roles: ["strong"],
        calls: 1,
        tokensIn: 6000,
        medianDurationMs: 4000,
        costMicroUsd: price(STRONG, 6000, 300),
        unpriced: 0,
        turnPriced: 0,
        cacheReadShare: null,
      },
      {
        model: CLASSIFIER,
        roles: ["classifier"],
        calls: 2,
        tokensIn: 500,
        medianDurationMs: null,
        costMicroUsd: price(CLASSIFIER, 200, 5) + price(CLASSIFIER, 300, 5),
        unpriced: 0,
        turnPriced: 0,
        cacheReadShare: null,
      },
    ]);
    expect(report.models[0]!.costMicroUsd).toBeGreaterThan(0);
    expect(report.unpricedTurns).toBe(0);
  });

  it("sums to what Financial's cost column sums for the same turns, gap and null usage included", async () => {
    const now = freshNow();
    const at = daysBefore(now, 3);
    const userId = `dev-${randomUUID()}`;
    // Every step priced: per step, at the model each ran on.
    await turn(at, {
      userId,
      classifier: { tokensIn: 200, tokensOut: 5 },
      steps: [
        { model: CHEAP, tokensIn: 4000, tokensOut: 100 },
        { model: STRONG, tier: "strong", tokensIn: 6000, tokensOut: 300 },
      ],
    });
    // A step the provider reported no usage for: the turn's own totals, at
    // `turn_model`, and the priced step beside it adds nothing of its own.
    await turn(at, { userId, turnModel: CHEAP, steps: [{ model: STRONG, tokensIn: 5000 }, { tokensIn: null }] });
    // A ledger-gap turn: no step rows at all, priced at `turn_model` — a model
    // that ran no step in the window, so its row is cost and nothing else.
    await turn(at, { userId, turnModel: FLASHX, stepCount: 2 });
    // Unpriceable either way: Financial's `unpriced`, nothing in any row.
    await turn(at, { userId, turnModel: "acme/unrated", steps: [{ model: "acme/unrated" }] });
    // Priced steps and a classifier with no reported usage: the whole turn is
    // unpriced, as `microUsdForRow` leaves it — its steps' cost too.
    await turn(at, { userId, classifier: { tokensIn: 100, tokensOut: null }, steps: [{ tokensIn: 7000 }] });
    // Inside Financial's 30 × 24h and before the first calendar day (noon now,
    // so that starts 29.5 days back): priced here, drawn in no bar or count.
    const early = daysBefore(now, 29.6);
    await turn(early, { userId, steps: [{ model: CHEAP, tokensIn: 3000, tokensOut: 80 }] });
    // ai-live off: Financial counts it, and no rate prices it.
    await turn(at, { userId, turnModel: "simulated/no-op", steps: [{ model: "simulated/no-op" }] });

    const report = await aiModelsReport([], now);
    const financial = (await costPerAccount(trailingWindowStart(now))).find((row) => row.userId === userId)!;
    const price = (model: string, tokensIn: number, tokensOut: number) => microUsdFor(model, tokensIn, tokensOut, at)!;

    expect(report.models.reduce((sum, row) => sum + row.costMicroUsd, 0)).toBe(financial.microUsd);
    expect(report.unpricedTurns).toBe(financial.unpriced);
    expect(financial).toMatchObject({ requests: 7, unpriced: 3 });
    // Neither extra turn is in the calendar window's counts.
    expect(report.turns).toBe(5);
    expect(report.models.map((row) => row.model)).not.toContain("simulated/no-op");
    expect(report.models.find((row) => row.model === FLASHX)).toMatchObject({
      calls: 0,
      turnPriced: 1,
      costMicroUsd: price(FLASHX, 100, 10),
    });
    expect(report.models.find((row) => row.model === STRONG)).toMatchObject({
      calls: 2,
      turnPriced: 0,
      costMicroUsd: price(STRONG, 6000, 300),
    });
    expect(report.models.find((row) => row.model === CHEAP)).toMatchObject({
      calls: 3,
      unpriced: 1,
      turnPriced: 1,
      costMicroUsd: price(CHEAP, 4000, 100) + price(CHEAP, 100, 10) + microUsdFor(CHEAP, 3000, 80, early)!,
    });
  });
});

describe("the tool-calls table", () => {
  it("has one row per tool, and reached-a-proposal only for tools that can propose", async () => {
    const now = freshNow();
    await turn(daysBefore(now, 1), {
      steps: [{}],
      calls: [
        { tool: "read_trip", durationMs: 30, outputBytes: 1000 },
        { tool: "AddActivity", outcome: "repaired", durationMs: 50, outputBytes: 40, reachedProposal: true },
      ],
    });
    await turn(daysBefore(now, 2), {
      steps: [{}],
      calls: [
        { tool: "read_trip", durationMs: 10, outputBytes: 3000 },
        { tool: "read_trip", outcome: "failed", durationMs: 20, outputBytes: null },
        { tool: "AddActivity", outcome: "failed", durationMs: 70, outputBytes: 20, reachedProposal: false },
      ],
    });
    // Measured, calls nothing: in the denominator of "in turns".
    for (let i = 0; i < 100; i += 1) await turn(daysBefore(now, 3), { steps: [{}] });

    const report = await aiModelsReport(["read_trip", "AddActivity", "delete_day", "set_budget"], now);

    expect(report.tools).toEqual([
      {
        tool: "read_trip",
        calls: 3,
        turns: 2,
        failed: 1,
        repaired: 0,
        medianDurationMs: 20,
        medianOutputBytes: 2000,
        reachedProposal: null,
      },
      {
        tool: "AddActivity",
        calls: 2,
        turns: 2,
        failed: 1,
        repaired: 1,
        medianDurationMs: 60,
        medianOutputBytes: 30,
        reachedProposal: { reached: 1, of: 2 },
      },
    ]);
    // 2 of 102 measured turns is ~2%: read_trip and AddActivity clear the 1%
    // bar, the two registered tools nobody called do not.
    expect(report.rarelyCalled).toEqual([
      { tool: "delete_day", calls: 0 },
      { tool: "set_budget", calls: 0 },
    ]);
  });

  it("counts a tool's turns among measured turns only, the denominator the tab divides by", async () => {
    const now = freshNow();
    await turn(daysBefore(now, 1), { steps: [{}], calls: [{ tool: "read_trip" }] });
    await turn(daysBefore(now, 2), { steps: [{}] });
    // Calls and no step rows: its calls are calls, but it is no measured turn.
    await turn(daysBefore(now, 3), { calls: [{ tool: "read_trip" }, { tool: "read_trip" }] });

    const report = await aiModelsReport([], now);

    expect(report.measuredTurns).toBe(2);
    expect(report.tools).toMatchObject([{ tool: "read_trip", calls: 3, turns: 1 }]);
  });
});

describe("almost never called", () => {
  it("lists registered tools under 1% of measured turns, fewest calls first, not by name", async () => {
    const now = freshNow();
    await turn(daysBefore(now, 1), { steps: [{}], calls: [{ tool: "read_trip" }, { tool: "move_day" }, { tool: "move_day" }] });
    await turn(daysBefore(now, 2), { steps: [{}], calls: [{ tool: "read_trip" }, { tool: "set_budget" }] });
    for (let i = 0; i < 99; i += 1) await turn(daysBefore(now, 3), { steps: [{}] });

    const report = await aiModelsReport(["read_trip", "move_day", "set_budget", "delete_day"], now);

    // 1 of 101 measured turns each; read_trip's 2 of 101 clears the bar.
    expect(report.measuredTurns).toBe(101);
    expect(report.rarelyCalled).toEqual([
      { tool: "delete_day", calls: 0 },
      { tool: "set_budget", calls: 1 },
      { tool: "move_day", calls: 2 },
    ]);
  });
});

describe("the worst day", () => {
  it("names the day at twice the window's failure rate, and the tool that failed most that day", async () => {
    const now = freshNow();
    // 3 of 5 failed three days ago.
    await turn(daysBefore(now, 3), { outcome: "error", calls: [{ tool: "read_day", outcome: "failed" }] });
    await turn(daysBefore(now, 3), {
      outcome: "error",
      calls: [{ tool: "read_day", outcome: "failed" }, { tool: "read_trip", outcome: "failed" }],
    });
    await turn(daysBefore(now, 3), { outcome: "error" });
    await turn(daysBefore(now, 3));
    await turn(daysBefore(now, 3));
    // About 1 in 100 elsewhere — and more failed calls on another day, which
    // must not be blamed for this one.
    await turn(daysBefore(now, 10), { outcome: "error" });
    await turn(daysBefore(now, 10), {
      calls: Array.from({ length: 5 }, () => ({ tool: "AddActivity", outcome: "failed" })),
    });
    for (let i = 0; i < 98; i += 1) await turn(daysBefore(now, 1 + (i % 20) + 4));

    const report = await aiModelsReport([], now);

    expect(report.turns).toBe(105);
    expect(report.worstDay).toEqual({ day: midnightBefore(now, 3), turns: 5, failed: 3, tool: "read_day" });
  });

  it("is null when the worst day is under twice the window's rate", async () => {
    const now = freshNow();
    // 3 of 20 (15%) against 5 of 60 overall (~8.3%): worse, not twice as bad.
    for (let i = 0; i < 20; i += 1) await turn(daysBefore(now, 2), { outcome: i < 3 ? "error" : "completed" });
    for (let i = 0; i < 40; i += 1) await turn(daysBefore(now, 6), { outcome: i < 2 ? "error" : "completed" });

    const report = await aiModelsReport([], now);

    expect(report.failedTurns).toBe(5);
    expect(report.worstDay).toBeNull();
  });
});

describe("the ledger gap", () => {
  it("counts turns that took steps and wrote no step rows, from the earliest", async () => {
    const now = freshNow();
    await turn(daysBefore(now, 1), { steps: [{}] });
    // Took two steps, wrote none: the child write failed.
    await turn(daysBefore(now, 2), { stepCount: 2 });
    await turn(daysBefore(now, 4), { stepCount: 1 });
    // Took no step at all (failed before the agent ran): nothing missing.
    await turn(daysBefore(now, 3), { stepCount: 0, outcome: "error" });

    const report = await aiModelsReport([], now);

    expect(report.turns).toBe(4);
    expect(report.ledgerGap).toEqual({ turns: 2, since: daysBefore(now, 4).toISOString() });
  });

  it("is zero, and the report empty, with no turns", async () => {
    const report = await aiModelsReport(["read_trip"], freshNow());
    expect(report.turns).toBe(0);
    expect(report.ledgerGap).toEqual({ turns: 0, since: null });
    expect(report.rarelyCalled).toEqual([]);
    expect(report.contextPerStep).toBeNull();
  });
});
