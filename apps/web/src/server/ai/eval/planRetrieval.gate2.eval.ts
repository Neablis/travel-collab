// **Gate 2: quality parity at lower cost for plan retrieval** (RAG stack, Part 5).
//
// For each of the 10 queries in `planRetrieval.gate2.dataset.ts`, three arms:
// - **Arm A (baseline):** strong tier, NO examples — today's path.
// - **Arm B (retrieval):** strong tier, WITH examples from `getPlanExamples`.
// - **Arm C (tier drop):** mid tier, WITH examples.
//
// Quality is judged by an LLM judge (cheap tier) comparing B vs A and C vs A
// on completeness, specificity, coherence, and relevance. Output tokens are
// counted from each generation.
//
// **Verdict:** PASS if quality(B) ≥ quality(A) AND (tokens(B) ≤ 0.75 × tokens(A)
// OR quality(C) ≥ quality(A)). The stack ships only on PASS.
//
// **Modes:**
// - **Production (`GATE2_PRODUCTION=1`):** uses the already-backfilled database
//   (Mitchell's Neon). Retrieval runs against real data. This is how Mitchell
//   runs it.
// - **Fixture (default):** seeds the 19 content bundles + Japan fixture trip,
//   embeds via the real sweep, then runs. Slower, for development.
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
const ACTOR_ID = process.env.GATE2_USER_ID ?? "eval-actor";
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
        armA: { tokens: number; text: string };
        armB: { tokens: number; text: string; examples: number };
        armC: { tokens: number; text: string };
        judgeAB: string;
        judgeAC: string;
        tokenReduction: number;
      }> = [];

      for (const { id, query } of GATE2_DATASET) {
        // Retrieval: the real path (flag must be on in this env, or call
        // retrieveDayChunks directly — getPlanExamples is flag-gated).
        const examples = await getPlanExamples({ question: query, userId: ACTOR_ID });
        // Render the example blocks exactly as the serving path does.
        const exampleText =
          examples.length > 0 ? renderPrompt(formatExampleBlocks(examples)) : null;

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

        const tokensA = resultA.usage?.outputTokens ?? 0;
        const tokensB = resultB.usage?.outputTokens ?? 0;
        const tokensC = resultC.usage?.outputTokens ?? 0;

        // Judge B vs A.
        const judgeAB = await generateText({
          model: gateway(CHEAP_MODEL),
          prompt: buildJudgePrompt(query, resultA.text, resultB.text),
        });
        // Judge C vs A (tier drop).
        const judgeAC = await generateText({
          model: gateway(CHEAP_MODEL),
          prompt: buildJudgePrompt(query, resultA.text, resultC.text),
        });

        const verdictAB = extractVerdict(judgeAB.text);
        const verdictAC = extractVerdict(judgeAC.text);
        const tokenReduction = tokensA > 0 ? (tokensA - tokensB) / tokensA : 0;

        console.log(
          `  ${id} tokens A=${tokensA} B=${tokensB} C=${tokensC} ` +
            `reduction=${(tokenReduction * 100).toFixed(1)}% judge(B/A)=${verdictAB} judge(C/A)=${verdictAC}`,
        );

        rows.push({
          id,
          query,
          armA: { tokens: tokensA, text: resultA.text },
          armB: { tokens: tokensB, text: resultB.text, examples: examples.length },
          armC: { tokens: tokensC, text: resultC.text },
          judgeAB: verdictAB,
          judgeAC: verdictAC,
          tokenReduction,
        });
      }

      // Aggregate.
      const avgReduction = rows.reduce((s, r) => s + r.tokenReduction, 0) / rows.length;
      // Quality parity: B is at parity if the judge never rates A strictly better.
      const parityB = rows.every((r) => r.judgeAB !== "A_BETTER");
      // Tier drop: C matches A if the judge never rates A strictly better than C.
      const tierDrop = rows.every((r) => r.judgeAC !== "A_BETTER");

      const pass = parityB && (avgReduction >= TOKEN_REDUCTION_BAR || tierDrop);

      const report = {
        gate: 2,
        queries: rows.length,
        avgTokenReduction: avgReduction,
        tokenBar: TOKEN_REDUCTION_BAR,
        qualityParityB: parityB,
        tierDropC: tierDrop,
        verdict: pass ? "PASS" : "FAIL",
        rows: rows.map((r) => ({
          id: r.id,
          query: r.query,
          tokensA: r.armA.tokens,
          tokensB: r.armB.tokens,
          tokensC: r.armC.tokens,
          tokenReduction: r.tokenReduction,
          examples: r.armB.examples,
          judgeAB: r.judgeAB,
          judgeAC: r.judgeAC,
        })),
      };
      const reportPath = join(reportDir, `gate2-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
      writeFileSync(reportPath, JSON.stringify(report, null, 2));
      console.log(`\ngate 2: ${rows.length} queries, avg token reduction ${(avgReduction * 100).toFixed(1)}% — ${pass ? "PASS" : "FAIL"} (bar ${TOKEN_REDUCTION_BAR * 100}%)`);
      console.log(`quality parity (B vs A): ${parityB}, tier drop (C vs A): ${tierDrop}`);
      console.log(`report: ${reportPath}`);

      expect(pass).toBe(true);
    },
    600_000, // 10 min timeout: 50 model calls
  );
});
