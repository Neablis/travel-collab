// **Gate 2: quality parity at lower cost for plan retrieval** (RAG stack, Part 5).
//
// For each of the 10 queries in `planRetrieval.gate2.dataset.ts`, three arms:
// - **Arm A (baseline):** strong tier, NO examples — today's path.
// - **Arm B (retrieval):** strong tier, WITH examples from `getPlanExamples`.
// - **Arm C (tier drop):** mid tier, WITH examples.
//
// Quality is judged by an LLM judge (cheap tier) comparing B vs A and C vs A
// on completeness, specificity, coherence, and relevance. Input AND output
// tokens are counted per arm (examples add input tokens; M48 warns that output
// savings alone don't prove a cheaper turn).
//
// **Prompt proxy (known limitation).** The arms use a representative plan
// prompt — the same query, the same instruction, the example blocks rendered
// exactly as the serving path renders them (`renderPrompt(formatExampleBlocks(...))`)
// — but NOT the full production turn prompt (which carries trip scope, posture,
// standing, clock, etc. via `instructionBlocks`). The ONLY variable between A
// and B is the example block, so the eval honestly measures the example effect;
// but a PASS licenses the mechanism, not the exact production token numbers.
// The runbook records this.
//
// **Verdict:** PASS if quality(B) ≥ quality(A) AND (output tokens(B) ≤ 0.75 ×
// output tokens(A) OR quality(C) ≥ quality(A)). The stack ships only on PASS.
// Total tokens are reported alongside so the cost thesis stays honest.
//
// **Modes:**
// - **Production (`GATE2_PRODUCTION=1`):** uses the already-backfilled database
//   (Mitchell's Neon). Retrieval runs against real data. This is the supported
//   path — Mitchell runs it.
// - **Fixture (default, not yet implemented):** would seed the 19 content
//   bundles + Japan fixture trip and embed via the real sweep, like Gate 1's
//   fixture mode. Currently the eval expects a pre-seeded database; without
//   one, the zero-examples guard fails the run loudly rather than measuring
//   nothing.
//
// **The money.** 10 queries × 3 arms = 30 plan generations (strong/mid tiers,
// plan-length outputs), plus 20 judge calls (cheap tier). This is DOLLARS, not
// cents — the run prints the plan first and refuses without `GATE2_CONFIRM=1`.
// Mitchell runs paid evals himself; this file never runs one unconfirmed.
//
// Usage:
//   GATE2_PRODUCTION=1 GATE2_USER_ID=<id> GATE2_CONFIRM=1 \
//     TRAVEL_COLLAB_EVAL_KEY=<key> DATABASE_URL=<neon-url> \
//     pnpm --filter web eval:run -- planRetrieval.gate2
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generateText } from "ai";
import { createGateway } from "@ai-sdk/gateway";
import { serverConfig } from "@/server/config";
import { renderPrompt } from "@/server/assistant/prompt";
import { getPlanExamples, formatExampleBlocks } from "@/server/ai/planExamples";
import { GATE2_DATASET } from "./planRetrieval.gate2.dataset";
import { buildJudgePrompt, buildPlanPrompt, extractVerdict } from "./planRetrieval.gate2.judge";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PRODUCTION = process.env.GATE2_PRODUCTION === "1";
// The actor must be explicit: a default "eval-actor" matches no owner_id or
// trip_memberships rows, silently measuring public-only examples instead of
// the real corpus. Fail loud.
const ACTOR_ID = process.env.GATE2_USER_ID;
if (!ACTOR_ID) {
  throw new Error("GATE2_USER_ID is not set. The eval's retrieval is privacy-filtered; without a real user id it would silently measure the wrong corpus.");
}
const CONFIRMED = process.env.GATE2_CONFIRM === "1";
// The bar: 25% fewer output tokens.
const TOKEN_REDUCTION_BAR = 0.25;

// Model ids come from serverConfig.aiModelTiers (ADR-019: no literals in
// kernel code). The eval reads the tier models the same way production does.
const STRONG_MODEL = serverConfig.aiModelTiers.strong;
const MID_MODEL = serverConfig.aiModelTiers.mid;
const CHEAP_MODEL = serverConfig.aiModelTiers.cheap;

// ---------------------------------------------------------------------------
// Eval
// ---------------------------------------------------------------------------

describe("gate 2: quality parity at lower cost", () => {
  it(
    "retrieval holds quality while cutting output tokens ≥25% or enabling a tier drop",
    async () => {
      // The money gate: print the plan, refuse without confirmation.
      const plan = `gate 2 plan: ${GATE2_DATASET.length} querie(s) x 3 arms (strong, strong+examples, mid+examples) + ${GATE2_DATASET.length * 2} judge calls (cheap tier). Production: ${PRODUCTION}.`;
      console.log(plan);
      if (!CONFIRMED) {
        throw new Error(`${plan}\nNothing was sent. Set GATE2_CONFIRM=1 to spend it.`);
      }

      const gateway = createGateway({ apiKey: serverConfig.aiGatewayApiKey });
      const reportDir = join(process.cwd(), "eval-results");
      mkdirSync(reportDir, { recursive: true });

      const rows: Array<{
        id: string;
        query: string;
        armA: { inTokens: number; outTokens: number; text: string };
        armB: { inTokens: number; outTokens: number; text: string; examples: number };
        armC: { inTokens: number; outTokens: number; text: string };
        judgeAB: string;
        judgeAC: string;
        outTokenReduction: number;
        totalTokenReduction: number;
      }> = [];

      for (const { id, query } of GATE2_DATASET) {
        // Retrieval: the real path (flag must be on in this env — getPlanExamples
        // is flag-gated, and the runbook's command sets RAG_PLAN_RETRIEVAL=1).
        // Fail the run on zero examples: an empty retrieval makes arm B
        // byte-identical to arm A, and the gate would measure nothing.
        const examples = await getPlanExamples({ question: query, userId: ACTOR_ID });
        if (examples.length === 0) {
          throw new Error(
            `gate 2: query ${id} retrieved zero examples — the gate would measure nothing. ` +
              `Check RAG_PLAN_RETRIEVAL=1, GATE2_USER_ID, and that the corpus is embedded.`,
          );
        }
        // Render the example blocks exactly as the serving path does.
        const exampleText = renderPrompt(formatExampleBlocks(examples));

        // Arm A: baseline — no examples.
        const resultA = await generateText({
          model: gateway(STRONG_MODEL),
          prompt: buildPlanPrompt(query, null),
        });
        // Arm B: same tier, with examples.
        const resultB = await generateText({
          model: gateway(STRONG_MODEL),
          prompt: buildPlanPrompt(query, exampleText),
        });
        // Arm C: cheaper tier, with examples (tier-drop test).
        const resultC = await generateText({
          model: gateway(MID_MODEL),
          prompt: buildPlanPrompt(query, exampleText),
        });

        const aIn = resultA.usage?.inputTokens ?? 0;
        const aOut = resultA.usage?.outputTokens ?? 0;
        const bIn = resultB.usage?.inputTokens ?? 0;
        const bOut = resultB.usage?.outputTokens ?? 0;
        const cIn = resultC.usage?.inputTokens ?? 0;
        const cOut = resultC.usage?.outputTokens ?? 0;

        // Judge B vs A, randomizing position (cheap-tier judges show position
        // bias). Deterministic per query id so reruns are comparable.
        const swapAB = hashForOrder(id) % 2 === 1;
        const judgeAB = await generateText({
          model: gateway(CHEAP_MODEL),
          prompt: swapAB
            ? buildJudgePrompt(query, resultB.text, resultA.text)
            : buildJudgePrompt(query, resultA.text, resultB.text),
        });
        const rawAB = extractVerdict(judgeAB.text);
        // Map back: if swapped, the judge's "A" was our B.
        const verdictAB = swapAB
          ? rawAB === "A_BETTER" ? "B_BETTER" : rawAB === "B_BETTER" ? "A_BETTER" : rawAB
          : rawAB;

        // Judge C vs A (tier drop), same position randomization.
        const swapAC = hashForOrder(id + ":c") % 2 === 1;
        const judgeAC = await generateText({
          model: gateway(CHEAP_MODEL),
          prompt: swapAC
            ? buildJudgePrompt(query, resultC.text, resultA.text)
            : buildJudgePrompt(query, resultA.text, resultC.text),
        });
        const rawAC = extractVerdict(judgeAC.text);
        const verdictAC = swapAC
          ? rawAC === "A_BETTER" ? "B_BETTER" : rawAC === "B_BETTER" ? "A_BETTER" : rawAC
          : rawAC;

        // An unparseable judge fails the run — for a ship-gate, silence must
        // not count as parity.
        if (verdictAB === "UNPARSEABLE" || verdictAC === "UNPARSEABLE") {
          throw new Error(
            `gate 2: query ${id} judge output unparseable (AB=${rawAB}, AC=${rawAC}) — failing rather than counting silence as parity.`,
          );
        }

        const outTokenReduction = aOut > 0 ? (aOut - bOut) / aOut : 0;
        const totalA = aIn + aOut;
        const totalB = bIn + bOut;
        const totalTokenReduction = totalA > 0 ? (totalA - totalB) / totalA : 0;

        console.log(
          `  ${id} out A=${aOut} B=${bOut} C=${cOut} ` +
            `in A=${aIn} B=${bIn} ` +
            `outReduction=${(outTokenReduction * 100).toFixed(1)}% totalReduction=${(totalTokenReduction * 100).toFixed(1)}% ` +
            `judge(B/A)=${verdictAB} judge(C/A)=${verdictAC}`,
        );

        rows.push({
          id,
          query,
          armA: { inTokens: aIn, outTokens: aOut, text: resultA.text },
          armB: { inTokens: bIn, outTokens: bOut, text: resultB.text, examples: examples.length },
          armC: { inTokens: cIn, outTokens: cOut, text: resultC.text },
          judgeAB: verdictAB,
          judgeAC: verdictAC,
          outTokenReduction,
          totalTokenReduction,
        });
      }

      // Aggregate. The bar is on OUTPUT tokens (the agreed Gate 2 definition),
      // but total tokens are reported so the cost thesis is honest: examples
      // add input tokens, and a PASS on output alone with a total-token
      // increase would be a false cost claim.
      const avgOutReduction = rows.reduce((s, r) => s + r.outTokenReduction, 0) / rows.length;
      const avgTotalReduction = rows.reduce((s, r) => s + r.totalTokenReduction, 0) / rows.length;
      // Quality parity: B is at parity if the judge never rates A strictly better.
      const parityB = rows.every((r) => r.judgeAB !== "A_BETTER");
      // Tier drop: C matches A if the judge never rates A strictly better than C.
      const tierDrop = rows.every((r) => r.judgeAC !== "A_BETTER");

      const pass = parityB && (avgOutReduction >= TOKEN_REDUCTION_BAR || tierDrop);

      const report = {
        gate: 2,
        queries: rows.length,
        avgOutTokenReduction: avgOutReduction,
        avgTotalTokenReduction: avgTotalReduction,
        tokenBar: TOKEN_REDUCTION_BAR,
        qualityParityB: parityB,
        tierDropC: tierDrop,
        verdict: pass ? "PASS" : "FAIL",
        note: "Prompt proxy: arms use a representative plan prompt, not the full production turn prompt (see runbook). Output-token bar is the agreed Gate 2 definition; total tokens reported for cost honesty.",
        rows: rows.map((r) => ({
          id: r.id,
          query: r.query,
          inTokensA: r.armA.inTokens,
          outTokensA: r.armA.outTokens,
          inTokensB: r.armB.inTokens,
          outTokensB: r.armB.outTokens,
          inTokensC: r.armC.inTokens,
          outTokensC: r.armC.outTokens,
          outTokenReduction: r.outTokenReduction,
          totalTokenReduction: r.totalTokenReduction,
          examples: r.armB.examples,
          judgeAB: r.judgeAB,
          judgeAC: r.judgeAC,
        })),
      };
      const reportPath = join(reportDir, `gate2-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
      writeFileSync(reportPath, JSON.stringify(report, null, 2));
      console.log(`\ngate 2: ${rows.length} queries, avg output-token reduction ${(avgOutReduction * 100).toFixed(1)}% (total ${(avgTotalReduction * 100).toFixed(1)}%) — ${pass ? "PASS" : "FAIL"} (bar ${TOKEN_REDUCTION_BAR * 100}%)`);
      console.log(`quality parity (B vs A): ${parityB}, tier drop (C vs A): ${tierDrop}`);
      console.log(`report: ${reportPath}`);

      expect(pass).toBe(true);
    },
    600_000, // 10 min timeout: 50 model calls
  );
});

/**
 * Deterministic small hash for judge position randomization. Not cryptographic;
 * only needs to vary per query id so reruns are comparable.
 */
function hashForOrder(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}
