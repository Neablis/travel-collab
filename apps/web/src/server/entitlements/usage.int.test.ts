// **The cost ledger** (M20 link 9), against a real database.
//
// Four gate boxes live here: one row per request including a failure, no
// dollars stored, re-pricing history at two rates, and no content on the row.
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { eq, getTableColumns } from "drizzle-orm";
import { db } from "@/server/db/client";
import { aiUsage, aiUsageSteps, aiUsageToolCalls } from "@/server/db/schema";
import type { TurnLedger } from "@/server/assistant/ledger";
import { microUsdFor, rateAt, type ModelRate } from "./modelRates";
import { costPerAccount, microUsdForRow, recordTurnLedger, topSpenders, usageFor } from "./usage";
import { microUsdFor as priceOf } from "./modelRates";

const TURN_MODEL = "deepseek/deepseek-v4-flash-0731";
const CLASSIFIER_MODEL = "zai/glm-4.7-flash";

function ledger(overrides: Partial<TurnLedger["cost"]> = {}): TurnLedger {
  return {
    cost: {
      userId: `dev-${randomUUID()}`,
      endpoint: "ask",
      outcome: "completed",
      taskClass: "question",
      turn: { model: TURN_MODEL, tokensIn: 3363, tokensOut: 512 },
      classifier: { model: CLASSIFIER_MODEL, tokensIn: 198, tokensOut: 49 },
      steps: 2,
      planVersionRef: "plus@v1",
      turnId: null,
      latencyMs: null,
      ...overrides,
    },
    capacity: [],
    toolCalls: [],
    stepSpend: [],
  };
}

async function rowsFor(userId: string) {
  return db.select().from(aiUsage).where(eq(aiUsage.userId, userId));
}

describe("a turn's step and tool-call rows (M31 Phase 1)", () => {
  function withRows(turnId: string): TurnLedger {
    const base = ledger({ turnId });
    return {
      ...base,
      stepSpend: [0, 1].map((index) => ({
        index,
        model: index === 0 ? TURN_MODEL : "zai/glm-4.7-flash",
        tier: index === 0 ? "low" : "mid",
        tokensIn: 4000,
        cacheReadTokens: 3000,
        cacheWriteTokens: 0,
        tokensOut: 50,
        finishReason: index === 0 ? "tool-calls" : "stop",
        escalated: index === 1,
        pivoted: false,
        durationMs: index === 0 ? 161_000 : 1_200,
      })),
      toolCalls: [
        {
          callId: "c1",
          name: "add_activity",
          ms: 12,
          ok: true,
          outcome: "repaired",
          stepIndex: 0,
          inputBytes: 120,
          outputBytes: 40,
          reachedProposal: true,
        },
        {
          callId: "c2",
          name: "set_trip_name",
          ms: null,
          ok: false,
          outcome: "refused-by-grant",
          stepIndex: 0,
          inputBytes: null,
          outputBytes: null,
          reachedProposal: null,
        },
      ],
    };
  }

  // A durable runtime replays a step and re-emits its events; the ledger must
  // upsert rather than append, or every replay double-counts a turn's spend.
  it("writes one turn, its steps and its calls, however many times it is written", async () => {
    const turnId = randomUUID();
    expect(await recordTurnLedger(withRows(turnId))).toBe(true);
    expect(await recordTurnLedger(withRows(turnId))).toBe(true);

    expect(await db.select().from(aiUsage).where(eq(aiUsage.id, turnId))).toHaveLength(1);
    const steps = await db.select().from(aiUsageSteps).where(eq(aiUsageSteps.turnId, turnId));
    expect(
      steps.map((step) => [step.stepIndex, step.model, step.cacheReadTokens, step.escalated, step.durationMs]).sort(),
    ).toEqual([
      [0, TURN_MODEL, 3000, false, 161_000],
      [1, "zai/glm-4.7-flash", 3000, true, 1_200],
    ]);
    const calls = await db.select().from(aiUsageToolCalls).where(eq(aiUsageToolCalls.turnId, turnId));
    expect(calls.map((call) => [call.callId, call.outcome, call.durationMs, call.reachedProposal]).sort()).toEqual([
      ["c1", "repaired", 12, true],
      ["c2", "refused-by-grant", null, null],
    ]);
  });

  // A replay carries the latest measurement, so the second write's values win
  // for every measured column — each row updated to ITS OWN new values, which
  // a multi-row upsert only does if it reads `excluded`.
  it("updates each row to the values of the latest write", async () => {
    const turnId = randomUUID();
    await recordTurnLedger(withRows(turnId));
    const again = withRows(turnId);
    await recordTurnLedger({
      ...again,
      stepSpend: again.stepSpend.map((step) => ({ ...step, tokensOut: step.index === 0 ? 7 : 9, durationMs: 5 })),
      toolCalls: again.toolCalls.map((call) => (call.callId === "c1" ? { ...call, ms: 99 } : call)),
    });
    const steps = await db.select().from(aiUsageSteps).where(eq(aiUsageSteps.turnId, turnId));
    expect(steps.map((step) => [step.stepIndex, step.tokensOut, step.durationMs]).sort()).toEqual([
      [0, 7, 5],
      [1, 9, 5],
    ]);
    const calls = await db.select().from(aiUsageToolCalls).where(eq(aiUsageToolCalls.turnId, turnId));
    expect(calls.map((call) => [call.callId, call.durationMs]).sort()).toEqual([
      ["c1", 99],
      ["c2", null],
    ]);
  });
});

// The review of #301: the billing row must survive anything the telemetry
// rows do, and a provider that reuses a call id inside one turn is one thing
// they can do.
describe("the billing row is independent of the step and tool-call rows", () => {
  it("writes the turn, and one row for a call id the provider reused", async () => {
    const turnId = randomUUID();
    const entry: TurnLedger = {
      ...ledger({ turnId }),
      toolCalls: ["first", "second"].map((label, index) => ({
        callId: "call_0",
        name: "read_day",
        ms: index + 1,
        ok: true,
        outcome: "ok" as const,
        stepIndex: index,
        inputBytes: null,
        outputBytes: label.length,
        reachedProposal: null,
      })),
    };
    expect(await recordTurnLedger(entry)).toBe(true);
    expect(await db.select().from(aiUsage).where(eq(aiUsage.id, turnId))).toHaveLength(1);
    const calls = await db.select().from(aiUsageToolCalls).where(eq(aiUsageToolCalls.turnId, turnId));
    expect(calls.map((call) => call.durationMs)).toEqual([2]);
  });

  it("keeps the billing row when the child rows cannot be written", async () => {
    const turnId = randomUUID();
    const entry: TurnLedger = {
      ...ledger({ turnId }),
      // A model id longer than nothing Postgres refuses is hard to find, so
      // the child write is made to fail on a step index no integer column
      // can hold.
      stepSpend: [
        { index: 2 ** 40, model: TURN_MODEL, tier: null, tokensIn: 1, cacheReadTokens: 0, cacheWriteTokens: 0, tokensOut: 1, finishReason: "stop", escalated: false, pivoted: false, durationMs: null },
      ],
    };
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await recordTurnLedger(entry)).toBe(false);
    } finally {
      error.mockRestore();
    }
    expect(await db.select().from(aiUsage).where(eq(aiUsage.id, turnId))).toHaveLength(1);
  });
});

// KI-2026-09-17-c: a turn admitted on the cheap tier that escalates runs its
// later steps on the escalation model. Priced at `turn_model`, every step is
// billed at the cheap rate; priced from its step rows, each step is billed at
// the model that ran it.
describe("an escalated turn is priced at the models that ran it", () => {
  it("prices from the step rows when the turn has them", async () => {
    const userId = `dev-${randomUUID()}`;
    const at = new Date("2026-10-04T00:00:00Z");
    const turnId = randomUUID();
    const entry: TurnLedger = {
      ...ledger({ userId, turnId, classifier: null, steps: 2, turn: { model: TURN_MODEL, tokensIn: 2000, tokensOut: 200 } }),
      stepSpend: [
        { index: 0, model: TURN_MODEL, tier: "low", tokensIn: 1000, cacheReadTokens: 0, cacheWriteTokens: 0, tokensOut: 100, finishReason: "tool-calls", escalated: false, pivoted: false, durationMs: null },
        { index: 1, model: "anthropic/claude-haiku-4-5", tier: "mid", tokensIn: 1000, cacheReadTokens: 0, cacheWriteTokens: 0, tokensOut: 100, finishReason: "stop", escalated: true, pivoted: false, durationMs: null },
      ],
    };
    await recordTurnLedger(entry, at);

    const mine = (await costPerAccount(new Date(at.getTime() - 1000))).find((c) => c.userId === userId)!;
    const perStep = priceOf(TURN_MODEL, 1000, 100, at)! + priceOf("anthropic/claude-haiku-4-5", 1000, 100, at)!;
    const asAdmitted = priceOf(TURN_MODEL, 2000, 200, at)!;
    expect(mine.microUsd).toBe(perStep);
    // And it is not what the old single-model pricing said.
    expect(mine.microUsd).toBeGreaterThan(asAdmitted);
  });

  // A step the provider reported no usage for must not turn a priceable turn
  // into an unpriced one; the turn's own totals still price it (review of #301).
  it("falls back to the turn's own totals when a step has no usage", async () => {
    const userId = `dev-${randomUUID()}`;
    const at = new Date("2026-10-05T00:00:00Z");
    const entry: TurnLedger = {
      ...ledger({ userId, turnId: randomUUID(), classifier: null, turn: { model: TURN_MODEL, tokensIn: 2000, tokensOut: 200 } }),
      stepSpend: [
        { index: 0, model: TURN_MODEL, tier: "low", tokensIn: 2000, cacheReadTokens: 0, cacheWriteTokens: 0, tokensOut: 200, finishReason: "tool-calls", escalated: false, pivoted: false, durationMs: null },
        { index: 1, model: TURN_MODEL, tier: "low", tokensIn: null, cacheReadTokens: null, cacheWriteTokens: null, tokensOut: null, finishReason: "stop", escalated: false, pivoted: false, durationMs: null },
      ],
    };
    await recordTurnLedger(entry, at);
    const mine = (await costPerAccount(new Date(at.getTime() - 1000))).find((c) => c.userId === userId)!;
    expect(mine.unpriced).toBe(0);
    expect(mine.microUsd).toBe(priceOf(TURN_MODEL, 2000, 200, at)!);
  });
});

describe("every AI request writes one row", () => {
  it("writes the turn and the classifier as separate spends", async () => {
    const entry = ledger();
    expect(await recordTurnLedger(entry)).toBe(true);
    const [row] = await rowsFor(entry.cost.userId);
    expect(row).toMatchObject({
      endpoint: "ask",
      outcome: "completed",
      taskClass: "question",
      turnModel: TURN_MODEL,
      turnTokensIn: 3363,
      turnTokensOut: 512,
      classifierModel: CLASSIFIER_MODEL,
      classifierTokensIn: 198,
      classifierTokensOut: 49,
      steps: 2,
      planVersionRef: "plus@v1",
    });
  });

  // **The gate box: a request that fails partway still writes a row**, because
  // the round-trips already made were already paid for. Both failure outcomes,
  // because `abort` is the one a reader is most likely to assume is free — the
  // user closed the rail, and the provider had already been paid.
  it("writes a row for a turn that failed and for one that was aborted", async () => {
    for (const outcome of ["error", "abort"] as const) {
      const entry = ledger({ outcome, turn: { model: TURN_MODEL, tokensIn: 1332, tokensOut: 0 } });
      expect(await recordTurnLedger(entry)).toBe(true);
      const [row] = await rowsFor(entry.cost.userId);
      expect(row!.outcome).toBe(outcome);
      // And it is priced, not skipped: those input tokens were spent.
      expect(microUsdForRow(row!)).toBeGreaterThan(0);
    }
  });

  // Null is "the provider reported no usage", and it must survive the round
  // trip as null. Zero is a measurement, and a rate join has to tell them
  // apart — a turn nobody measured is not a free turn.
  it("stores an unmeasured turn as null rather than as zero", async () => {
    const entry = ledger({ turn: { model: TURN_MODEL, tokensIn: null, tokensOut: null } });
    await recordTurnLedger(entry);
    const [row] = await rowsFor(entry.cost.userId);
    expect(row!.turnTokensIn).toBeNull();
    expect(row!.turnTokensOut).toBeNull();
  });

  // No classification round-trip was made — a bare "yes go ahead"
  // short-circuits it, and a page turn is never classified. All three columns
  // are null together, so nothing prices a call that did not happen.
  it("leaves the classifier columns null when no classification ran", async () => {
    const entry = ledger({ classifier: null });
    await recordTurnLedger(entry);
    const [row] = await rowsFor(entry.cost.userId);
    expect(row!.classifierModel).toBeNull();
    expect(row!.classifierTokensIn).toBeNull();
    expect(row!.classifierTokensOut).toBeNull();
  });

  // Never throws: this hangs off a response already reaching the user, so a
  // telemetry fault must not stop an answer mid-sentence.
  it("reports failure rather than throwing when the write cannot land", async () => {
    // `endpoint` is `text` with no constraint, so the write that cannot land is
    // one with an oversized value for a column that does have a bound.
    const entry = ledger({ userId: "x".repeat(20) });
    entry.cost.steps = Number.MAX_SAFE_INTEGER; // out of int4 range
    await expect(recordTurnLedger(entry)).resolves.toBe(false);
  });
});

describe("the row carries no content", () => {
  // The gate box: *"`ai_usage` carries no question text and no trip content."*
  // Asserted against the COLUMNS rather than against a sample row, so it stays
  // true for a row nobody wrote in this test.
  it("has no column a question or a trip could be written to", async () => {
    const entry = ledger();
    await recordTurnLedger(entry);
    const [row] = await rowsFor(entry.cost.userId);
    expect(Object.keys(row!).sort()).toEqual(
      [
        "classifierModel",
        "classifierTokensIn",
        "classifierTokensOut",
        "createdAt",
        "endpoint",
        "id",
        "latencyMs",
        "outcome",
        "planVersionRef",
        "steps",
        "taskClass",
        "turnModel",
        "turnTokensIn",
        "turnTokensOut",
        "userId",
      ].sort(),
    );
    for (const key of Object.keys(row!)) {
      expect(key).not.toMatch(/question|prompt|message|text|content|trip|answer|day|activity/i);
    }
  });

  // The same gate, on the per-step and per-tool rows M31 Phase 1 added. A
  // tool call's arguments and result are exactly the content this table must
  // not hold, so the row carries their sizes and nothing else.
  it("has no content column on the step or tool-call rows either", () => {
    expect(Object.keys(getTableColumns(aiUsageSteps)).sort()).toEqual(
      [
        "cacheReadTokens",
        "cacheWriteTokens",
        "createdAt",
        "durationMs",
        "escalated",
        "finishReason",
        "model",
        "pivoted",
        "stepIndex",
        "tier",
        "tokensIn",
        "tokensOut",
        "turnId",
      ].sort(),
    );
    expect(Object.keys(getTableColumns(aiUsageToolCalls)).sort()).toEqual(
      [
        "callId",
        "createdAt",
        "durationMs",
        "inputBytes",
        "outcome",
        "outputBytes",
        "reachedProposal",
        "stepIndex",
        "tool",
        "turnId",
      ].sort(),
    );
    for (const key of [...Object.keys(getTableColumns(aiUsageSteps)), ...Object.keys(getTableColumns(aiUsageToolCalls))]) {
      expect(key).not.toMatch(/question|prompt|message|text|content|trip|answer|activity|args|result/i);
    }
  });
});

describe("re-pricing history", () => {
  // **The gate box, proven by re-deriving a known month at two different
  // rates.** The stored row does not move; the answer does.
  // **Two published rates for one model, and the same stored row priced at
  // both.** The first version of this compared a priced date with a date that
  // returned `null`, which proves only that an unpriceable row is unpriceable —
  // it never showed a later rate CHANGING a non-null historical cost, which is
  // the whole of the gate box ("proven by re-deriving a known month at two
  // different rates"). Caught by CodeRabbit on PR #174.
  //
  // The two-entry history is supplied by the test rather than added to
  // `modelRates.ts`: that file is a truthful append-only record of rates that
  // really applied, and inventing a rate change in it to make a test pass is
  // exactly the kind of edit it exists to make visible.
  const TWO_RATES: ModelRate[] = [
    {
      model: TURN_MODEL,
      effectiveFrom: "2026-08-16",
      inputMicroUsdPerMTok: 130_000,
      outputMicroUsdPerMTok: 260_000,
    },
    {
      model: TURN_MODEL,
      effectiveFrom: "2026-09-01",
      inputMicroUsdPerMTok: 260_000,
      outputMicroUsdPerMTok: 520_000,
    },
    {
      model: CLASSIFIER_MODEL,
      effectiveFrom: "2026-08-16",
      inputMicroUsdPerMTok: 70_000,
      outputMicroUsdPerMTok: 400_000,
    },
  ];

  it("changes what past usage cost without touching a stored row", async () => {
    const entry = ledger();
    await recordTurnLedger(entry, new Date("2026-08-20T00:00:00Z"));
    const [row] = await rowsFor(entry.cost.userId);
    const before = { ...row! };

    const atAugust = microUsdForRow(row!, new Date("2026-08-20T00:00:00Z"), TWO_RATES);
    const atSeptember = microUsdForRow(row!, new Date("2026-09-13T00:00:00Z"), TWO_RATES);

    // Both real numbers, and DIFFERENT: the turn model doubled on 2026-09-01
    // while the classifier's rate did not move, so the September figure is the
    // August one plus the turn's own cost again.
    expect(atAugust).toBeGreaterThan(0);
    expect(atSeptember).toBeGreaterThan(0);
    expect(atSeptember).not.toBe(atAugust);
    // Each leg rounds ONCE, so September is not August doubled: the turn's own
    // figure is 570.31 → 570 in August and 1140.62 → 1141 in September. Writing
    // it as `turnAtAugust * 2` gave 1140 and failed by one — which is the
    // rounding this ledger stores integers to avoid arguing about, showing up
    // in the test that measures it.
    const turnAtAugust = Math.round((3363 * 130_000 + 512 * 260_000) / 1_000_000);
    const turnAtSeptember = Math.round((3363 * 260_000 + 512 * 520_000) / 1_000_000);
    const classifier = Math.round((198 * 70_000 + 49 * 400_000) / 1_000_000);
    expect(atAugust).toBe(turnAtAugust + classifier);
    expect(atSeptember).toBe(turnAtSeptember + classifier);

    // `rateAt` picks the NEWEST entry on or before the date, not the first or
    // the last in the list.
    expect(rateAt(TURN_MODEL, new Date("2026-08-31T00:00:00Z"), TWO_RATES)!.effectiveFrom).toBe("2026-08-16");
    expect(rateAt(TURN_MODEL, new Date("2026-09-01T00:00:00Z"), TWO_RATES)!.effectiveFrom).toBe("2026-09-01");

    // The one live record against the COMMITTED rates: ~$0.0006, six
    // ten-thousandths of a dollar — the number the milestone measured, and the
    // number `Money` would have rounded to zero.
    const committed = microUsdForRow(row!, new Date("2026-09-13T00:00:00Z"));
    expect(committed).toBe(turnAtAugust + classifier);
    expect(committed).toBeLessThan(1000);

    // A date predating every published rate prices nothing — and answers `null`
    // rather than zero, because a row nobody can price must not silently
    // contribute nothing to a total.
    expect(microUsdForRow(row!, new Date("2026-01-01T00:00:00Z"))).toBeNull();
    expect(rateAt(TURN_MODEL, new Date("2026-01-01T00:00:00Z"))).toBeNull();

    // **And the row is byte-identical afterwards.** Re-pricing reads; it never
    // writes.
    const [after] = await rowsFor(entry.cost.userId);
    expect(after).toEqual(before);
  });

  // **An unmeasured token count is unpriceable, not free.** `microUsdFor` used
  // to coerce `null` to `0`, which reported a request nobody measured as
  // costing nothing — the same "a number that understates and looks precise"
  // failure the whole no-`Money` rule exists to prevent. Caught by CodeRabbit
  // on PR #174.
  it("prices an unmeasured turn as null rather than as free", async () => {
    const entry = ledger({ turn: { model: TURN_MODEL, tokensIn: null, tokensOut: null } });
    await recordTurnLedger(entry);
    const [row] = await rowsFor(entry.cost.userId);
    expect(microUsdForRow(row!)).toBeNull();

    // A measured ZERO is different, and still prices as zero.
    const measured = ledger({
      turn: { model: TURN_MODEL, tokensIn: 0, tokensOut: 0 },
      classifier: null,
    });
    await recordTurnLedger(measured);
    const [zeroRow] = await rowsFor(measured.cost.userId);
    expect(microUsdForRow(zeroRow!)).toBe(0);
  });

  // A model with no published rate is unpriceable, and that is reported rather
  // than folded into a total as zero — the same defect class as a dollar
  // column, arriving by a different door.
  it("reports an unpriced row rather than counting it as free", async () => {
    const userId = `dev-${randomUUID()}`;
    await recordTurnLedger(ledger({ userId, turn: { model: "vendor/unknown-9", tokensIn: 900, tokensOut: 100 } }));
    await recordTurnLedger(ledger({ userId }));
    const since = new Date(Date.now() - 60 * 60 * 1000);
    const [account] = (await costPerAccount(since)).filter((a) => a.userId === userId);
    expect(account!.requests).toBe(2);
    expect(account!.unpriced).toBe(1);
    expect(account!.microUsd).toBeGreaterThan(0);
  });

  it("prices a turn at the newest rate on or before its date", () => {
    expect(rateAt(TURN_MODEL, new Date("2026-08-15T00:00:00Z"))).toBeNull();
    expect(rateAt(TURN_MODEL, new Date("2026-08-16T00:00:00Z"))!.inputMicroUsdPerMTok).toBe(130_000);
    expect(microUsdFor(TURN_MODEL, 1_000_000, 0, new Date("2026-09-13T00:00:00Z"))).toBe(130_000);
  });
});

describe("what the console reads", () => {
  it("ranks accounts by what they cost over a window", async () => {
    const heavy = `dev-${randomUUID()}`;
    const light = `dev-${randomUUID()}`;
    for (let i = 0; i < 3; i += 1) await recordTurnLedger(ledger({ userId: heavy }));
    await recordTurnLedger(ledger({ userId: light }));

    const since = new Date(Date.now() - 60 * 60 * 1000);
    const ranked = await costPerAccount(since);
    const heavyIndex = ranked.findIndex((a) => a.userId === heavy);
    const lightIndex = ranked.findIndex((a) => a.userId === light);
    expect(heavyIndex).toBeLessThan(lightIndex);
    expect(ranked[heavyIndex]!.requests).toBe(3);
    expect(ranked[heavyIndex]!.microUsd).toBe(3 * ranked[lightIndex]!.microUsd);

    expect((await topSpenders(since, 1)).length).toBe(1);
    expect(await usageFor(light)).toHaveLength(1);
  });
});
