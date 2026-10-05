import { describe, expect, it } from "vitest";
import type { TurnLedger } from "@/server/assistant/ledger";
import { microUsdFor } from "@/server/entitlements/modelRates";
import { capMicroUsdFrom, DEFAULT_CAP_MICRO_USD, dollars, turnMicroUsd, unpricedModels } from "./spend";

const AT = new Date("2026-10-05T12:00:00Z");

function ledger(steps: { model: string; tokensIn: number | null; tokensOut: number | null; cacheRead?: number }[], classifier: TurnLedger["cost"]["classifier"]): TurnLedger {
  return {
    cost: {
      turnId: "t1", userId: "u", endpoint: "ask", outcome: "completed", taskClass: "question",
      turn: { model: steps[0]?.model ?? "x", tokensIn: null, tokensOut: null },
      classifier, steps: steps.length, planVersionRef: null, latencyMs: 1,
    },
    capacity: [],
    toolCalls: [],
    stepSpend: steps.map((step, index) => ({
      index, model: step.model, tier: null, tokensIn: step.tokensIn, cacheReadTokens: step.cacheRead ?? 0,
      cacheWriteTokens: 0, tokensOut: step.tokensOut, finishReason: "stop", escalated: false, pivoted: false, durationMs: 1,
    })),
  };
}

// The cap is only as good as this number, so it is the ledger's own price,
// not a second rule: per step at the model each ran on, plus the classifier.
describe("turnMicroUsd", () => {
  it("prices each step at its own model, cached reads at the cached rate, and adds the classifier", () => {
    const turn = ledger(
      [
        { model: "zai/glm-4.7-flashx", tokensIn: 5_000, tokensOut: 100, cacheRead: 4_000 },
        { model: "zai/glm-5.3", tokensIn: 8_000, tokensOut: 500 },
      ],
      { model: "zai/glm-4.7-flash", tokensIn: 300, tokensOut: 40 },
    );
    const expected =
      microUsdFor("zai/glm-4.7-flashx", 5_000, 100, AT, undefined, 4_000, 0)! +
      microUsdFor("zai/glm-5.3", 8_000, 500, AT, undefined, 0, 0)! +
      microUsdFor("zai/glm-4.7-flash", 300, 40, AT)!;
    expect(turnMicroUsd(turn, AT)).toBe(expected);
    expect(expected).toBeGreaterThan(0);
  });

  it("is null, not zero, when any part has no rate", () => {
    expect(turnMicroUsd(ledger([{ model: "nobody/unpriced", tokensIn: 10, tokensOut: 10 }], null), AT)).toBeNull();
    expect(
      turnMicroUsd(ledger([{ model: "zai/glm-5.3-flash", tokensIn: 10, tokensOut: 10 }], { model: "nobody/unpriced", tokensIn: 1, tokensOut: 1 }), AT),
    ).toBeNull();
  });
});

describe("unpricedModels", () => {
  it("names each configured model with no rate, once", () => {
    expect(unpricedModels(["zai/glm-5.3-flash", "nobody/unpriced", "nobody/unpriced"], AT)).toEqual(["nobody/unpriced"]);
    expect(unpricedModels(["zai/glm-4.7-flashx", "zai/glm-5.3", "zai/glm-4.7-flash"], AT)).toEqual([]);
  });
});

describe("dollars", () => {
  it("reads micro-dollars as dollars", () => {
    expect(dollars(250_000)).toBe("$0.2500");
    expect(dollars(1_234)).toBe("$0.0012");
  });
});

// A cap that parses to NaN is no cap: `spent >= NaN` is never true, so every
// turn would run and be paid (CodeRabbit, PR 327). Refused, never defaulted.
describe("capMicroUsdFrom", () => {
  it("reads dollars as micro-dollars, and defaults only when unset", () => {
    expect(capMicroUsdFrom("0.25")).toBe(250_000);
    expect(capMicroUsdFrom("0")).toBe(0);
    expect(capMicroUsdFrom(undefined)).toBe(DEFAULT_CAP_MICRO_USD);
    expect(capMicroUsdFrom(" ")).toBe(DEFAULT_CAP_MICRO_USD);
  });

  it("refuses a value that is not a finite, non-negative number", () => {
    for (const raw of ["abc", "$0.10", "-1", "Infinity", "NaN"]) expect(capMicroUsdFrom(raw), raw).toBeNull();
  });
});
