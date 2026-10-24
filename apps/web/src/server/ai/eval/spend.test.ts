import { describe, expect, it } from "vitest";
import type { TurnLedger } from "@/server/assistant/ledger";
import { microUsdFor } from "@/server/entitlements/modelRates";
import { MAX_STEP_OUTPUT_TOKENS } from "@/server/ai/handleAskRequest";
import { capMicroUsdFrom, DEFAULT_CAP_MICRO_USD, dollars, turnSpend, UNREPORTED_INPUT_TOKENS, unpricedModels } from "./spend";

const AT = new Date("2026-10-05T12:00:00Z");

function ledger(
  steps: { model: string; tokensIn: number | null; tokensOut: number | null; cacheRead?: number }[],
  classifier: TurnLedger["cost"]["classifier"],
  turnTokensIn: number | null = null,
): TurnLedger {
  return {
    cost: {
      turnId: "t1", userId: "u", endpoint: "ask", outcome: "completed", taskClass: "question", classifierCertainty: null,
      turn: { model: steps[0]?.model ?? "x", tokensIn: turnTokensIn, tokensOut: null },
      classifier, steps: steps.length, planVersionRef: null, latencyMs: 1, planExamples: null,
    },
    capacity: [],
    toolCalls: [],
    stepSpend: steps.map((step, index) => ({
      index, model: step.model, tier: null, tokensIn: step.tokensIn, cacheReadTokens: step.cacheRead ?? 0,
      cacheWriteTokens: 0, tokensOut: step.tokensOut, finishReason: "stop", escalated: false, pivoted: false, durationMs: 1,
      provider: null, gatewayGenerationId: null,
    })),
  };
}

// The cap is only as good as this number, so it is the ledger's own price,
// not a second rule: per step at the model each ran on, plus the classifier.
const turnMicroUsd = (turn: TurnLedger, at: Date) => turnSpend(turn, at).microUsd;

describe("turnSpend", () => {
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

  // KI-2026-10-13-c: a step on a priced model that reported no usage was
  // null, and the runner added null to nothing — the cap never saw it.
  const OPUS = "anthropic/claude-opus-5.5";
  // Opus has a rate from 2026-10-10 on.
  const LATER = new Date("2026-10-20T12:00:00Z");
  const opus = (tokensIn: number, tokensOut: number) => microUsdFor(OPUS, tokensIn, tokensOut, LATER)!;

  it("charges a step that reported no usage the turn's unattributed input and the step output ceiling, and says so", () => {
    const turn = ledger(
      [
        { model: OPUS, tokensIn: 5_000, tokensOut: 100 },
        { model: OPUS, tokensIn: null, tokensOut: null },
      ],
      null,
      20_000,
    );
    expect(turnSpend(turn, LATER)).toEqual({
      microUsd: opus(5_000, 100) + opus(15_000, MAX_STEP_OUTPUT_TOKENS),
      estimated: [`step 2 (${OPUS}) reported no usage; charged 15000 in / ${MAX_STEP_OUTPUT_TOKENS} out`],
    });
  });

  // A turn total that leaves nothing over (the steps it summed were only the
  // reported ones) must not price the silent step's input at zero.
  it("charges at least the largest input another step reported", () => {
    const turn = ledger(
      [
        { model: OPUS, tokensIn: 12_000, tokensOut: 100 },
        { model: OPUS, tokensIn: null, tokensOut: 80 },
      ],
      null,
      12_000,
    );
    expect(turnSpend(turn, LATER).microUsd).toBe(opus(12_000, 100) + opus(12_000, 80));
  });

  it("charges the input ceiling when nothing in the turn says how large a step was", () => {
    const { microUsd, estimated } = turnSpend(
      ledger([{ model: OPUS, tokensIn: null, tokensOut: null }], { model: "zai/glm-4.7-flash", tokensIn: null, tokensOut: null }),
      LATER,
    );
    expect(microUsd).toBe(
      opus(UNREPORTED_INPUT_TOKENS, MAX_STEP_OUTPUT_TOKENS) + microUsdFor("zai/glm-4.7-flash", UNREPORTED_INPUT_TOKENS, MAX_STEP_OUTPUT_TOKENS, LATER)!,
    );
    expect(estimated).toHaveLength(2);
    expect(estimated[1]).toMatch(/^the classifier \(zai\/glm-4\.7-flash\) reported no usage/);
  });

  it("estimates nothing for a turn that reported everything", () => {
    expect(turnSpend(ledger([{ model: OPUS, tokensIn: 5_000, tokensOut: 100 }], null, 5_000), LATER).estimated).toEqual([]);
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
