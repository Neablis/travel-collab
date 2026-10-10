// **The eval: the live set, a real model, the real `/ask` pipeline** (M33).
//
//   pnpm --filter web eval                         prints the plan and cost cap, sends NOTHING
//   EVAL_CONFIRM=1 pnpm --filter web eval          every prompt, once (paid; capped at $0.10)
//   EVAL_CONFIRM=1 EVAL_ONLY=q-most-free,q-busiest pnpm --filter web eval
//   EVAL_CONFIRM=1 EVAL_REPEAT=3 EVAL_MAX_USD=0.25 pnpm --filter web eval
//
// What is real: admission, the intent classifier, tier selection on
// production's models (`models.json`, see `vitest.eval.config.ts`), every tool,
// the proposal builder and a migrated Postgres holding the seeded Japan trip.
// What is not: place search, which answers from a fixed stub at its port, so a
// turn that searches gets a place without a LocationIQ key or a paid lookup;
// and auth, mocked as the integration lane mocks it.
//
// No model is injected into `handleAskRequest`. That is the point of this
// lane, and the difference from `replay.int.test.ts`, which replays a
// recording to test the code around a model. This tests the model on our code.
//
// It writes a JSON report to `eval-results/` (git-ignored) and prints one line
// per check. A failed check fails the run, so a regression is a red exit code.
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { japanTripCommands } from "@tc/fixtures";
import type { TripDetail } from "@tc/contracts";
import { executeTripCommand, executeTripCommandBatch } from "@/server/commands";
import { db } from "@/server/db/client";
import { rateLimitCounters } from "@/server/db/schema";
import type { AskAnalyticsRecord } from "@/server/assistant/askAnalytics";
import type { TurnLedger } from "@/server/assistant/ledger";
import { expectationFor } from "./cases";
import { grade, reviewedChanges, type EvalCheck, type EvalTurn } from "./grade";
import { capMicroUsdFrom, dollars, turnMicroUsd, unpricedModels } from "./spend";
import { longTripCommands, type EvalTripName } from "./trips";

const ACTOR_ID = "eval-actor";

vi.mock("@/server/auth", () => ({ auth: async () => ({ user: { id: ACTOR_ID } }) }));

// Place search answers from a stub at its port, so a run needs no LocationIQ
// key and spends no lookups. The stub must not lie about geography: the first
// full run's stub put every place in Kyoto, and the model correctly refused to
// cite a "Kyoto" lunch for Shibuya, which read as a model failure. So the place
// is the query itself, at the centre of the region the trip is in (the bias the
// real search is given), with no city to contradict the question.
vi.mock("@/server/ai/assistantPorts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/ai/assistantPorts")>();
  return {
    ...actual,
    placeSearchPort: {
      search: async ({
        queries,
        region,
      }: {
        queries: readonly string[];
        region: { minLat: number; maxLat: number; minLng: number; maxLng: number } | null;
      }) =>
        queries.map((query) => ({
          query,
          places: [
            {
              name: query,
              lat: region ? (region.minLat + region.maxLat) / 2 : 35.68,
              lng: region ? (region.minLng + region.maxLng) / 2 : 139.76,
            },
          ],
        })),
    },
  };
});

const { handleAskRequest } = await import("@/server/ai/handleAskRequest");
const { upsertUser } = await import("@/server/users");
const { issueGrant } = await import("@/server/entitlements/grants");

interface LivePrompt {
  id: string;
  intent: "change" | "question";
  text: string;
  /** The trip it runs on (`trips.ts`); absent, the seeded Japan trip. */
  trip?: EvalTripName;
}

const liveSet = JSON.parse(readFileSync(join(import.meta.dirname, "live-set.json"), "utf8")) as {
  prompts: LivePrompt[];
};
const only = (process.env.EVAL_ONLY ?? "").split(",").map((id) => id.trim()).filter(Boolean);
const repeat = Math.max(1, Number(process.env.EVAL_REPEAT ?? "1") || 1);
const prompts = liveSet.prompts.filter((prompt) => only.length === 0 || only.includes(prompt.id));

// **A run spends money, so it says so before it starts and stops at a cap**
// (Mitchell, 2026-10-05: "we spent .25$ testing, we should be really clear
// when we are running eval loops"). Without EVAL_CONFIRM=1 nothing is sent: the
// run prints its plan and fails. EVAL_MAX_USD caps it (default $0.10): once the
// turns so far have spent that, the rest are skipped, not run. A configured
// model with no rate is refused, because a run cannot cap what it cannot price.
const confirmed = process.env.EVAL_CONFIRM === "1";
// Null when EVAL_MAX_USD is not a number: refused in beforeAll, never read as "no cap".
const capMicroUsd = capMicroUsdFrom(process.env.EVAL_MAX_USD);
const configuredModels = [
  process.env.AI_MODEL_CHEAP,
  process.env.AI_MODEL_MID,
  process.env.AI_MODEL_STRONG,
  process.env.AI_CLASSIFIER_MODEL,
].filter((model): model is string => typeof model === "string" && model.length > 0);
const unpriced = unpricedModels(configuredModels, new Date());
const plan =
  `eval plan: ${prompts.length} prompt(s) x ${repeat} = ${prompts.length * repeat} paid turn(s), ` +
  `cap ${capMicroUsd === null ? `invalid (EVAL_MAX_USD=${process.env.EVAL_MAX_USD})` : dollars(capMicroUsd)}, models ${[...new Set(configuredModels)].join(", ")}`;
let spentMicroUsd = 0;
let unpricedTurns = 0;

/**
 * A fresh copy of the trip `prompt` runs on, through the real command path:
 * the Japan demo trip as db:seed builds it, or a named one from `trips.ts`.
 */
async function seedTripFor(prompt: LivePrompt): Promise<{ tripId: string; detail: TripDetail }> {
  const tripId = randomUUID();
  const name = prompt.trip === "long-100" ? "100 days in Japan (eval)" : "Japan (eval)";
  const created = await executeTripCommand({ type: "CreateTrip", tripId, name }, ACTOR_ID);
  if (!created.ok) throw new Error(`seed: ${created.error.message}`);
  const commands =
    prompt.trip === "long-100" ? longTripCommands(tripId) : japanTripCommands(tripId, { startDate: "2027-04-01" });
  const seeded = await executeTripCommandBatch(commands, ACTOR_ID);
  if (!seeded.ok) throw new Error(`seed: ${seeded.error.message}`);
  return { tripId, detail: seeded.detail };
}

function chunksOf(body: string): Record<string, unknown>[] {
  return body
    .split("\n")
    .filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
    .flatMap((line) => {
      try {
        return [JSON.parse(line.slice("data: ".length)) as Record<string, unknown>];
      } catch {
        return [];
      }
    });
}

async function runTurn(
  prompt: LivePrompt,
  tripId: string,
): Promise<EvalTurn & { stepDurationsMs: (number | null)[]; providers: (string | null)[]; generationIds: (string | null)[]; microUsd: number | null }> {
  // Keyed by actor, and every turn here is the same actor (see replay.int.test.ts).
  await db.delete(rateLimitCounters);
  const records: AskAnalyticsRecord[] = [];
  // The ledger rides beside the record: where a slow turn's time went is its
  // per-step durations (M32), which the record does not carry.
  const ledgers: TurnLedger[] = [];
  const request = new Request(`http://eval/api/trips/${tripId}/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [{ id: "m1", role: "user", parts: [{ type: "text", text: prompt.text }] }],
      scope: { kind: "trip" },
    }),
  });
  const response = await handleAskRequest(request, tripId, undefined, (record, ledger) => {
    records.push(record);
    if (ledger) ledgers.push(ledger);
  });
  const body = await response.text();
  const record = records[0];
  if (record === undefined) {
    throw new Error(`no ai.ask record: HTTP ${response.status} ${body.slice(0, 300)}`);
  }
  const chunks = chunksOf(body);
  const text = chunks
    .filter((chunk) => chunk.type === "text-delta" && typeof chunk.delta === "string")
    .map((chunk) => chunk.delta as string)
    .join("");
  return {
    record,
    text,
    // A card's commands or a stored suggestion's changes (ADR-067).
    proposalCommands: reviewedChanges(chunks),
    stepDurationsMs: ledgers[0]?.stepSpend.map((step) => step.durationMs) ?? [],
    providers: ledgers[0]?.stepSpend.map((step) => step.provider) ?? [],
    generationIds: ledgers[0]?.stepSpend.map((step) => step.gatewayGenerationId) ?? [],
    microUsd: ledgers[0] ? turnMicroUsd(ledgers[0], new Date()) : null,
  };
}

interface RunRow {
  id: string;
  run: number;
  model: string;
  steps: number;
  toolCalls: string[];
  latencyMs: number;
  /** Each agent step's wall time (M32): the model's, plus that step's tool calls. */
  stepDurationsMs: (number | null)[];
  /** Which Gateway provider served each step, and its generation id (the billed cost is looked up by it). */
  providers: (string | null)[];
  generationIds: (string | null)[];
  inputTokens: number | null;
  outputTokens: number | null;
  answer: string;
  checks: EvalCheck[];
}

const rows: RunRow[] = [];

beforeAll(async () => {
  console.log(plan);
  if (capMicroUsd === null) {
    throw new Error(`EVAL_MAX_USD must be a non-negative number of dollars, got "${process.env.EVAL_MAX_USD}". Nothing was sent.`);
  }
  if (!confirmed) {
    throw new Error(`${plan}\nNothing was sent. Set EVAL_CONFIRM=1 to spend it (and EVAL_MAX_USD to change the cap).`);
  }
  if (unpriced.length > 0 && process.env.EVAL_ALLOW_UNPRICED !== "1") {
    throw new Error(`No rate in modelRates.ts for ${unpriced.join(", ")}, so this run's spend cannot be capped. Add the rate, or set EVAL_ALLOW_UNPRICED=1.`);
  }
  await upsertUser({ id: ACTOR_ID, email: null, name: null, image: null });
  await issueGrant({
    userId: ACTOR_ID,
    planId: "premium",
    planVersion: 1,
    source: "admin",
    grantedBy: "eval",
    expiresAt: null,
  });
});

afterAll(() => {
  const dir = join(import.meta.dirname, "../../../../eval-results");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  const models = {
    cheap: process.env.AI_MODEL_CHEAP,
    mid: process.env.AI_MODEL_MID,
    strong: process.env.AI_MODEL_STRONG,
    classifier: process.env.AI_CLASSIFIER_MODEL,
  };
  writeFileSync(file, `${JSON.stringify({ models, repeat, spentMicroUsd, unpricedTurns, rows }, null, 2)}\n`);
  const failed = rows.flatMap((row) => row.checks.filter((check) => !check.pass).map((check) => `${row.id}#${row.run}: ${check.name}`));
  console.log(
    [
      "",
      `eval: ${rows.length} turns, ${rows.reduce((n, row) => n + row.checks.length, 0)} checks, ${failed.length} failed`,
      `models: ${JSON.stringify(models)}`,
      `spent: ${dollars(spentMicroUsd)} of a ${capMicroUsd === null ? "invalid" : dollars(capMicroUsd)} cap${unpricedTurns > 0 ? ` (+ ${unpricedTurns} unpriced turn(s))` : ""}`,
      ...rows.map(
        (row) =>
          `  ${row.checks.every((check) => check.pass) ? "PASS" : "FAIL"} ${row.id}#${row.run}  ${row.model}  ${row.steps} steps  ` +
          `${row.toolCalls.length} calls  ${(row.latencyMs / 1000).toFixed(1)}s ` +
          `[${row.stepDurationsMs.map((ms) => (ms === null ? "?" : (ms / 1000).toFixed(1))).join(" + ")}]  ${row.inputTokens ?? "?"} in  via ${[...new Set(row.providers)].join(",") || "?"}`,
      ),
      `report: ${file}`,
    ].join("\n"),
  );
});

describe("the live set, on production's models", () => {
  for (const prompt of prompts) {
    for (let run = 1; run <= repeat; run += 1) {
      it(`${prompt.id}#${run}: ${prompt.text}`, async (context) => {
        if (capMicroUsd === null || spentMicroUsd >= capMicroUsd) {
          console.log(`    skipped: the run has spent ${dollars(spentMicroUsd)}, its cap is ${capMicroUsd === null ? "invalid" : dollars(capMicroUsd)}`);
          context.skip();
          return;
        }
        const { tripId, detail } = await seedTripFor(prompt);
        const turn = await runTurn(prompt, tripId);
        if (turn.microUsd === null) unpricedTurns += 1;
        else spentMicroUsd += turn.microUsd;
        console.log(`    cost: ${turn.microUsd === null ? "unpriced" : dollars(turn.microUsd)} (run so far ${dollars(spentMicroUsd)})`);
        const checks = grade(turn, expectationFor(prompt.id, detail)!);
        rows.push({
          id: prompt.id,
          run,
          model: turn.record.model,
          steps: turn.record.steps,
          toolCalls: turn.record.toolCalls.map((call) => call.name),
          latencyMs: turn.record.latencyMs,
          stepDurationsMs: turn.stepDurationsMs,
          providers: turn.providers,
          generationIds: turn.generationIds,
          inputTokens: turn.record.usage.inputTokens,
          outputTokens: turn.record.usage.outputTokens,
          answer: turn.text,
          checks,
        });
        for (const check of checks) console.log(`    ${check.pass ? "✓" : "✗"} ${check.name}: ${check.detail}`);
        expect(checks.filter((check) => !check.pass).map((check) => `${check.name}: ${check.detail}`)).toEqual([]);
      });
    }
  }
});
