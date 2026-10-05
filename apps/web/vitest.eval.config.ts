import { defineConfig } from "vitest/config";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

// **The eval lane** (M33): the live set against a REAL model, through the real
// `/ask` pipeline, on a private Postgres. `pnpm --filter web eval`.
//
// It is not in CI and not in `pnpm check`: every turn is a paid model call.
// It refuses to start without `TRAVEL_COLLAB_EVAL_KEY`, a Gateway key kept for
// evals so their spend never lands on production's key.
const envLocalPath = path.resolve(__dirname, ".env.local");
if (existsSync(envLocalPath)) process.loadEnvFile(envLocalPath);

const evalKey = process.env.TRAVEL_COLLAB_EVAL_KEY ?? "";
if (!evalKey) {
  throw new Error("TRAVEL_COLLAB_EVAL_KEY is not set. The eval calls a real model and uses its own Gateway key.");
}

// Production's models, per tier, from `models.json` (read from what production
// actually ran). An `EVAL_MODEL_<TIER>` variable overrides one, which is how a
// candidate model is compared against production's.
type Tier = "cheap" | "mid" | "strong" | "classifier";
const models = JSON.parse(readFileSync(path.resolve(__dirname, "src/server/ai/eval/models.json"), "utf8")) as {
  tiers: Record<Tier, { model: string | null }>;
};
const UNCONFIGURED = "unconfigured/no-production-model-for-this-tier";
const modelFor = (tier: Tier): string =>
  process.env[`EVAL_MODEL_${tier.toUpperCase()}`] || models.tiers[tier].model || UNCONFIGURED;

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    include: ["src/**/*.eval.ts"],
    fileParallelism: false,
    setupFiles: ["./src/test-support/evalNetworkGuard.setup.ts"],
    // A whole-trip plan on the strong tier is allowed four minutes; the run
    // is sequential, so the file needs the sum.
    testTimeout: 300_000,
    hookTimeout: 120_000,
    reporters: ["default"],
    env: {
      AI_LIVE: "true",
      AI_GATEWAY_API_KEY: evalKey,
      AI_MODEL_CHEAP: modelFor("cheap"),
      AI_MODEL_MID: modelFor("mid"),
      AI_MODEL_STRONG: modelFor("strong"),
      AI_CLASSIFIER_MODEL: modelFor("classifier"),
      API_TOKEN_PEPPER: process.env.API_TOKEN_PEPPER || "eval-pepper-not-a-real-key",
      CACHE_DRIVER: "off",
    },
  },
});
