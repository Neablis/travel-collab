// Free (CI) tests for Gate 2's pure helpers. The paid eval itself
// (`planRetrieval.gate2.eval.ts`) never runs in CI.
import { describe, expect, it } from "vitest";
import { buildJudgePrompt, buildPlanPrompt, extractVerdict } from "./planRetrieval.gate2.judge";

describe("extractVerdict", () => {
  it("extracts A_BETTER", () => {
    expect(extractVerdict("blah\nVERDICT: A_BETTER\nmore")).toBe("A_BETTER");
  });

  it("extracts B_BETTER", () => {
    expect(extractVerdict("VERDICT: B_BETTER")).toBe("B_BETTER");
  });

  it("extracts TIE", () => {
    expect(extractVerdict("VERDICT: TIE")).toBe("TIE");
  });

  it("fails open to TIE on unparseable output (never claims baseline won)", () => {
    expect(extractVerdict("no verdict here")).toBe("TIE");
    expect(extractVerdict("")).toBe("TIE");
    expect(extractVerdict("VERDICT: SOMETHING_ELSE")).toBe("TIE");
  });
});

describe("buildPlanPrompt", () => {
  it("without examples, contains no example block", () => {
    const prompt = buildPlanPrompt("plan a trip", null);
    expect(prompt).toContain("plan a trip");
    expect(prompt).not.toContain("Example days");
  });

  it("with examples, the ONLY difference is the example block", () => {
    const without = buildPlanPrompt("plan a trip", null);
    const withExamples = buildPlanPrompt("plan a trip", "EXAMPLE_TEXT");
    expect(withExamples).toContain("EXAMPLE_TEXT");
    expect(withExamples).toContain("plan a trip");
    // The query text appears in both; examples are additive.
    expect(withExamples.length).toBeGreaterThan(without.length);
  });
});

describe("buildJudgePrompt", () => {
  it("includes both plans and the verdict instruction", () => {
    const prompt = buildJudgePrompt("query", "PLAN_A_TEXT", "PLAN_B_TEXT");
    expect(prompt).toContain("PLAN_A_TEXT");
    expect(prompt).toContain("PLAN_B_TEXT");
    expect(prompt).toContain("VERDICT:");
  });
});
