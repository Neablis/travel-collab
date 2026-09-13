// **The cost ledger** (M20 link 9), against a real database.
//
// Four gate boxes live here: one row per request including a failure, no
// dollars stored, re-pricing history at two rates, and no content on the row.
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { aiUsage } from "@/server/db/schema";
import type { TurnLedger } from "@/server/assistant/ledger";
import { microUsdFor, rateAt } from "./modelRates";
import { costPerAccount, microUsdForRow, recordAiUsage, topSpenders, usageFor } from "./usage";

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
      ...overrides,
    },
    capacity: [],
    toolCalls: [],
  };
}

async function rowsFor(userId: string) {
  return db.select().from(aiUsage).where(eq(aiUsage.userId, userId));
}

describe("every AI request writes one row", () => {
  it("writes the turn and the classifier as separate spends", async () => {
    const entry = ledger();
    expect(await recordAiUsage(entry)).toBe(true);
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
      expect(await recordAiUsage(entry)).toBe(true);
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
    await recordAiUsage(entry);
    const [row] = await rowsFor(entry.cost.userId);
    expect(row!.turnTokensIn).toBeNull();
    expect(row!.turnTokensOut).toBeNull();
  });

  // No classification round-trip was made — a bare "yes go ahead"
  // short-circuits it, and a page turn is never classified. All three columns
  // are null together, so nothing prices a call that did not happen.
  it("leaves the classifier columns null when no classification ran", async () => {
    const entry = ledger({ classifier: null });
    await recordAiUsage(entry);
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
    await expect(recordAiUsage(entry)).resolves.toBe(false);
  });
});

describe("the row carries no content", () => {
  // The gate box: *"`ai_usage` carries no question text and no trip content."*
  // Asserted against the COLUMNS rather than against a sample row, so it stays
  // true for a row nobody wrote in this test.
  it("has no column a question or a trip could be written to", async () => {
    const entry = ledger();
    await recordAiUsage(entry);
    const [row] = await rowsFor(entry.cost.userId);
    expect(Object.keys(row!).sort()).toEqual(
      [
        "classifierModel",
        "classifierTokensIn",
        "classifierTokensOut",
        "createdAt",
        "endpoint",
        "id",
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
});

describe("re-pricing history", () => {
  // **The gate box, proven by re-deriving a known month at two different
  // rates.** The stored row does not move; the answer does.
  it("changes what past usage cost without touching a stored row", async () => {
    const entry = ledger();
    await recordAiUsage(entry, new Date("2026-08-20T00:00:00Z"));
    const [row] = await rowsFor(entry.cost.userId);
    const before = { ...row! };

    const atAugust = microUsdForRow(row!, new Date("2026-08-20T00:00:00Z"));
    // The one live record: 3,363 in + 512 out on the turn, 198 + 49 on the
    // classifier. At $0.13/$0.26 and $0.07/$0.40 per MTok that is ~$0.0006 —
    // six ten-thousandths of a dollar, which is the number the milestone
    // measured and the number `Money` would have rounded to zero.
    expect(atAugust).toBe(
      Math.round((3363 * 130_000 + 512 * 260_000) / 1_000_000) +
        Math.round((198 * 70_000 + 49 * 400_000) / 1_000_000),
    );
    expect(atAugust).toBeGreaterThan(0);
    expect(atAugust).toBeLessThan(1000); // under one cent, in micro-dollars

    // A rate that predates every published entry prices nothing — and answers
    // `null` rather than zero, because a row nobody can price must not
    // silently contribute nothing to a total.
    expect(microUsdForRow(row!, new Date("2026-01-01T00:00:00Z"))).toBeNull();
    expect(rateAt(TURN_MODEL, new Date("2026-01-01T00:00:00Z"))).toBeNull();

    // **And the row is byte-identical afterwards.** Re-pricing reads; it never
    // writes.
    const [after] = await rowsFor(entry.cost.userId);
    expect(after).toEqual(before);
  });

  // A model with no published rate is unpriceable, and that is reported rather
  // than folded into a total as zero — the same defect class as a dollar
  // column, arriving by a different door.
  it("reports an unpriced row rather than counting it as free", async () => {
    const userId = `dev-${randomUUID()}`;
    await recordAiUsage(ledger({ userId, turn: { model: "vendor/unknown-9", tokensIn: 900, tokensOut: 100 } }));
    await recordAiUsage(ledger({ userId }));
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
    for (let i = 0; i < 3; i += 1) await recordAiUsage(ledger({ userId: heavy }));
    await recordAiUsage(ledger({ userId: light }));

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
