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

  it("fails LOUD on unparseable output (never counts silence as parity)", () => {
    expect(extractVerdict("no verdict here")).toBe("UNPARSEABLE");
    expect(extractVerdict("")).toBe("UNPARSEABLE");
    expect(extractVerdict("VERDICT: SOMETHING_ELSE")).toBe("UNPARSEABLE");
  });

  it("anchored: a hypothetical mention in the explanation does not misparse", () => {
    expect(extractVerdict("this is not VERDICT: A_BETTER because the plans tie\nVERDICT: TIE")).toBe("TIE");
  });
});

describe("buildPlanPrompt", () => {
  it("without examples, contains no example block", () => {
    const prompt = buildPlanPrompt("plan a trip", null);
    expect(prompt).toContain("plan a trip");
    expect(prompt).not.toContain("Example days");
  });

  it("with examples, the ONLY difference is the spliced example block", () => {
    const without = buildPlanPrompt("plan a trip", null);
    const exampleBlock =
      "\n\nHere are example days from similar trips. Adapt them to the request — do not copy them verbatim, and the user's request wins if there's a conflict:\n\nEXAMPLE_TEXT\n";
    const withExamples = buildPlanPrompt("plan a trip", "EXAMPLE_TEXT");
    // Exact splice: removing the example block must yield the baseline.
    expect(withExamples.replace(exampleBlock, "")).toBe(without);
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
