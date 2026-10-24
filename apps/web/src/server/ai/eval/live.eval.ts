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
// and auth, mocked as the integration lane mocks it; and the clock. Every turn
// starts at the same instant, 12:30 in Tokyo on the run's date
// (`evalInstant`), so a day-of prompt meets the same hour of its trip whenever
// the run is started. Only `Date`'s origin is moved (`evalClock.ts`): it runs
// at real speed from there, so timers, fetch, deadlines and every duration and
// latency are real milliseconds; only the instants it reads are shifted.
//
// No model is injected into `handleAskRequest`. That is the point of this
// lane, and the difference from `replay.int.test.ts`, which replays a
// recording to test the code around a model. This tests the model on our code.
//
// A prompt with `"surface": "account"` (M45) is asked at the account door,
// `handleBeyondTripAskRequest`, by a fresh account holding `ACCOUNT_TRIPS` — its
// own, so the Japan trips every other prompt seeds are not counted among them.
// One with `"surface": "playbook"` (M45 D9) is asked at the same door on a
// playbook day's page: the Japan trip's first day, published by the eval
// actor, asked about by a fresh account whose own copy of the trip is "Kyoto".
// One with `"surface": "chat"` (M52) is an `@assistant` in the seeded trip's
// chat: its `chat` messages and then its own are posted there, and the turn
// runs as the chat route runs it, offered `read_chat`.
//
// It writes a JSON report to `eval-results/` (git-ignored) and prints one line
// per check. A failed check fails the run, so a regression is a red exit code.
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { japanTripCommands } from "@tc/fixtures";
import type { TripDetail } from "@tc/contracts";
import { tripNow } from "@tc/pages";
import { executeTripCommand, executeTripCommandBatch } from "@/server/commands";
import { db } from "@/server/db/client";
import { rateLimitCounters } from "@/server/db/schema";
import { writeTravelling } from "@/server/access/members";
import type { AskAnalyticsRecord } from "@/server/assistant/askAnalytics";
import type { TurnLedger } from "@/server/assistant/ledger";
import { accountExpectationFor, expectationFor, playbookExpectationFor, type SeededAccountTrip } from "./cases";
import { saveDay, setSavedDayVisibility } from "@/server/savedDays";
import { postMessage } from "@/server/chat/messages";
import type { TurnOrigin } from "@/server/assistant/defineTool";
import { grade, navigatedTo, retractedText, reviewedChanges, textBeforeToolCall, visibleText, type EvalCheck, type EvalTurn } from "./grade";
import { capMicroUsdFrom, dollars, turnSpend, unpricedModels, type TurnSpend } from "./spend";
import { ACCOUNT_TRIPS, accountTripCommands, evalInstant, japanTodayStart, longTripCommands, phaseFor, planningStart, type EvalTripName } from "./trips";
import { pinClock, type EvalClock } from "./evalClock";

const ACTOR_ID = "eval-actor";

// Who the session says is asking: the eval actor, or an account prompt's own.
const session = vi.hoisted(() => ({ userId: "eval-actor" }));
vi.mock("@/server/auth", () => ({ auth: async () => ({ user: { id: session.userId } }) }));

// Place search answers from a stub at its port (`placeStub.ts`, which says
// what it must and must not do to stay out of the grade).
vi.mock("@/server/ai/assistantPorts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/ai/assistantPorts")>();
  const { stubPlaceSearch } = await import("./placeStub");
  return { ...actual, placeSearchPort: { search: async (input: Parameters<typeof stubPlaceSearch>[0]) => stubPlaceSearch(input) } };
});

const { handleBeyondTripAskRequest, handleAskRequest } = await import("@/server/ai/handleAskRequest");
const { upsertUser } = await import("@/server/users");
const { issueGrant } = await import("@/server/entitlements/grants");

interface LivePrompt {
  id: string;
  intent: "change" | "question" | "off-topic";
  text: string;
  /** The trip it runs on (`trips.ts`); absent, the seeded Japan trip. */
  trip?: EvalTripName;
  /** `account`: asked at the account door, across `ACCOUNT_TRIPS` (M45); `playbook`: on a published day's page (D9); `chat`: an `@assistant` in the trip chat (M52). */
  surface?: "account" | "playbook" | "chat";
  /** On a `chat` prompt, what was said before it, oldest first. */
  chat?: string[];
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
// An estimated turn (a part reported no usage) is in `spentMicroUsd` at its
// estimate, so the cap counts it (KI-2026-10-13-c); `estimatedTurns` says how
// many such guesses the total holds.
let spentMicroUsd = 0;
let unpricedTurns = 0;
let estimatedTurns = 0;

// Read from the real clock as the run loads, before `Date` is pinned. The
// report carries both, since the pinned instant says nothing of when it ran.
const startedAt = Date.now();
const pinnedAt = evalInstant(startedAt);
let clock: EvalClock | undefined;

/**
 * A fresh copy of the trip `prompt` runs on, through the real command path:
 * the Japan demo trip as db:seed builds it, or a named one from `trips.ts`.
 */
async function seedTripFor(prompt: LivePrompt): Promise<{ tripId: string; detail: TripDetail }> {
  const tripId = randomUUID();
  const name = prompt.trip === "long-100" ? "100 days in Japan (eval)" : "Japan (eval)";
  const created = await executeTripCommand({ type: "CreateTrip", tripId, name }, ACTOR_ID);
  if (!created.ok) throw new Error(`seed: ${created.error.message}`);
  // `Date` is pinned to the turn's start here, so both dates follow the run.
  const commands =
    prompt.trip === "long-100"
      ? longTripCommands(tripId, planningStart(Date.now()))
      : japanTripCommands(tripId, { startDate: prompt.trip === "today" ? japanTodayStart(Date.now()) : planningStart(Date.now()) });
  const seeded = await executeTripCommandBatch(commands, ACTOR_ID);
  if (!seeded.ok) throw new Error(`seed: ${seeded.error.message}`);
  // Every stop is in Japan, so Tokyo's clock is each day's own.
  const phase = tripNow(seeded.detail, null, { at: Date.now(), deviceZone: "Asia/Tokyo" }).phase;
  if (phase !== phaseFor(prompt.trip)) {
    throw new Error(`seed: ${prompt.id}'s trip is ${phase} as its turn starts; its case is written for one ${phaseFor(prompt.trip)}`);
  }
  return { tripId, detail: seeded.detail };
}

/** The eval actor's grant, so every account is on the same plan and tiers. */
async function enrol(userId: string): Promise<void> {
  await upsertUser({ id: userId, email: null, name: null, image: null });
  await issueGrant({ userId, planId: "premium", planVersion: 1, source: "admin", grantedBy: "eval", expiresAt: null });
}

/**
 * A fresh account holding the account trips, through the real command path,
 * with the one it is not travelling on marked so as the app marks it.
 */
async function seedAccount(): Promise<{ userId: string; seeded: SeededAccountTrip[] }> {
  const userId = `eval-account-${randomUUID()}`;
  await enrol(userId);
  const seeded: SeededAccountTrip[] = [];
  for (const trip of ACCOUNT_TRIPS) {
    const tripId = randomUUID();
    const created = await executeTripCommand({ type: "CreateTrip", tripId, name: trip.name }, userId);
    if (!created.ok) throw new Error(`seed: ${created.error.message}`);
    const built = await executeTripCommandBatch(accountTripCommands(tripId, trip, planningStart(Date.now())), userId);
    if (!built.ok) throw new Error(`seed: ${built.error.message}`);
    if (!trip.travelling) {
      await writeTravelling(db, { tripId, userId, travelling: false, updatedBy: userId, now: new Date().toISOString() });
    }
    seeded.push({ detail: built.detail, travelling: trip.travelling });
  }
  return { userId, seeded };
}

/**
 * A published playbook day and an account to ask about it (M45 D9): the
 * Japan trip's first day, kept and published by the eval actor, so the asker
 * reads a stranger's day; and the asker's own copy of the trip, named "Kyoto",
 * for the add-to-trip prompt to name.
 */
async function seedPlaybook(): Promise<{ userId: string; savedDayId: string; stopTitles: string[] }> {
  const { detail } = await seedTripFor({ id: "playbook-source", intent: "question", text: "" });
  const kept = await saveDay({ name: "A day in Kyoto", dayIds: [detail.days[0]!.dayId], dateAnchors: "strip" }, detail, ACTOR_ID);
  if (!kept.ok) throw new Error(`seed: ${kept.error.message}`);
  const published = await setSavedDayVisibility(kept.value.savedDayId, ACTOR_ID, "public");
  if (published === null) throw new Error("seed: the playbook day did not publish");
  const userId = `eval-playbook-${randomUUID()}`;
  await enrol(userId);
  const tripId = randomUUID();
  const created = await executeTripCommand({ type: "CreateTrip", tripId, name: "Kyoto" }, userId);
  if (!created.ok) throw new Error(`seed: ${created.error.message}`);
  const built = await executeTripCommandBatch(japanTripCommands(tripId, { startDate: planningStart(Date.now()) }), userId);
  if (!built.ok) throw new Error(`seed: ${built.error.message}`);
  return { userId, savedDayId: kept.value.savedDayId, stopTitles: kept.value.stops.map((stop) => stop.title) };
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
  /** The trip it is asked on, or null at the door about no one trip. */
  tripId: string | null,
  /** At that door, the scope: the account's unless a playbook page is named. */
  beyondTrip: { kind: "account" } | { kind: "playbook"; page: { kind: "day"; savedDayId: string } } = { kind: "account" },
  /** On a trip, where the turn was asked: the Ask tab, or the trip chat. */
  origin: TurnOrigin = "ask",
): Promise<EvalTurn & { stepDurationsMs: (number | null)[]; providers: (string | null)[]; generationIds: (string | null)[]; spend: TurnSpend }> {
  // Keyed by actor, and every turn here is the same actor (see replay.int.test.ts).
  await db.delete(rateLimitCounters);
  const records: AskAnalyticsRecord[] = [];
  // The ledger rides beside the record: where a slow turn's time went is its
  // per-step durations (M32), which the record does not carry.
  const ledgers: TurnLedger[] = [];
  const request = new Request(tripId === null ? "http://eval/api/ask" : `http://eval/api/trips/${tripId}/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [{ id: "m1", role: "user", parts: [{ type: "text", text: prompt.text }] }],
      scope: tripId === null ? beyondTrip : { kind: "trip" },
    }),
  });
  const sink = (record: AskAnalyticsRecord, ledger?: TurnLedger) => {
    records.push(record);
    if (ledger) ledgers.push(ledger);
  };
  const response =
    tripId === null
      ? await handleBeyondTripAskRequest(request, undefined, sink)
      : await handleAskRequest(request, tripId, undefined, sink, undefined, undefined, origin);
  const body = await response.text();
  const record = records[0];
  if (record === undefined) {
    throw new Error(`no ai.ask record: HTTP ${response.status} ${body.slice(0, 300)}`);
  }
  const chunks = chunksOf(body);
  return {
    record,
    text: visibleText(chunks),
    // A card's commands or a stored suggestion's changes (ADR-067).
    proposalCommands: reviewedChanges(chunks),
    textBeforeToolCall: textBeforeToolCall(chunks),
    retracted: retractedText(chunks),
    navigations: navigatedTo(chunks),
    stepDurationsMs: ledgers[0]?.stepSpend.map((step) => step.durationMs) ?? [],
    providers: ledgers[0]?.stepSpend.map((step) => step.provider) ?? [],
    generationIds: ledgers[0]?.stepSpend.map((step) => step.gatewayGenerationId) ?? [],
    spend: ledgers[0] ? turnSpend(ledgers[0], new Date()) : { microUsd: null, estimated: ["no ledger was written for the turn"] },
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
  /** What the cap counted for the turn; null where a model had no rate. */
  microUsd: number | null;
  /** Each part that reported no usage and was charged an estimate (KI-2026-10-13-c). Empty when all were measured. */
  costEstimated: string[];
  /** Text that streamed and was taken back (KI-2026-10-12-h). Reported, never failed. */
  retracted: { parts: number; chars: number };
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
  clock = pinClock();
  clock.startTurnAt(pinnedAt);
  await enrol(ACTOR_ID);
});

afterAll(() => {
  // The report is named for when the run really happened.
  clock?.restore();
  const finishedAt = Date.now();
  const dir = join(import.meta.dirname, "../../../../eval-results");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${new Date(finishedAt).toISOString().replace(/[:.]/g, "-")}.json`);
  const models = {
    cheap: process.env.AI_MODEL_CHEAP,
    mid: process.env.AI_MODEL_MID,
    strong: process.env.AI_MODEL_STRONG,
    classifier: process.env.AI_CLASSIFIER_MODEL,
  };
  const clockReport = {
    pinnedAt: new Date(pinnedAt).toISOString(),
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: new Date(finishedAt).toISOString(),
  };
  writeFileSync(file, `${JSON.stringify({ models, repeat, spentMicroUsd, estimatedTurns, unpricedTurns, rows, ...clockReport }, null, 2)}\n`);
  const failed = rows.flatMap((row) => row.checks.filter((check) => !check.pass).map((check) => `${row.id}#${row.run}: ${check.name}`));
  console.log(
    [
      "",
      `eval: ${rows.length} turns, ${rows.reduce((n, row) => n + row.checks.length, 0)} checks, ${failed.length} failed`,
      `models: ${JSON.stringify(models)}`,
      `clock: every turn started at ${clockReport.pinnedAt} (12:30 JST); the run really ran ${clockReport.startedAt} to ${clockReport.finishedAt}`,
      `retracted: ${rows.reduce((n, row) => n + row.retracted.parts, 0)} text parts, ${rows.reduce((n, row) => n + row.retracted.chars, 0)} chars, across ${rows.filter((row) => row.retracted.parts > 0).length} turns (KI-2026-10-12-h; not a failure)`,
      `spent: ${dollars(spentMicroUsd)} of a ${capMicroUsd === null ? "invalid" : dollars(capMicroUsd)} cap${estimatedTurns > 0 ? `, ${estimatedTurns} turn(s) of it estimated` : ""}${unpricedTurns > 0 ? ` (+ ${unpricedTurns} unpriced turn(s))` : ""}`,
      ...rows.map(
        (row) =>
          `  ${row.checks.every((check) => check.pass) ? "PASS" : "FAIL"} ${row.id}#${row.run}  ${row.model}  ${row.steps} steps  ` +
          `${row.toolCalls.length} calls  ${(row.latencyMs / 1000).toFixed(1)}s ` +
          `[${row.stepDurationsMs.map((ms) => (ms === null ? "?" : (ms / 1000).toFixed(1))).join(" + ")}]  ${row.inputTokens ?? "?"} in  via ${[...new Set(row.providers)].join(",") || "?"}` +
          `  retracted ${row.retracted.parts}/${row.retracted.chars}ch`,
      ),
      `report: ${file}`,
    ].join("\n"),
  );
});

describe.skipIf(!confirmed)("the live set, on production's models", () => {
  for (const prompt of prompts) {
    for (let run = 1; run <= repeat; run += 1) {
      it(`${prompt.id}#${run}: ${prompt.text}`, async (context) => {
        if (capMicroUsd === null || spentMicroUsd >= capMicroUsd) {
          console.log(`    skipped: the run has spent ${dollars(spentMicroUsd)}, its cap is ${capMicroUsd === null ? "invalid" : dollars(capMicroUsd)}`);
          context.skip();
          return;
        }
        // Back to the pinned instant: a turn late in a long run would otherwise meet a later hour of the day.
        clock!.startTurnAt(pinnedAt);
        let turn: Awaited<ReturnType<typeof runTurn>>;
        let expected;
        if (prompt.surface === "account") {
          const { userId, seeded } = await seedAccount();
          session.userId = userId;
          try {
            turn = await runTurn(prompt, null);
          } finally {
            session.userId = ACTOR_ID;
          }
          expected = accountExpectationFor(prompt.id, seeded, userId);
        } else if (prompt.surface === "playbook") {
          const { userId, savedDayId, stopTitles } = await seedPlaybook();
          session.userId = userId;
          try {
            turn = await runTurn(prompt, null, { kind: "playbook", page: { kind: "day", savedDayId } });
          } finally {
            session.userId = ACTOR_ID;
          }
          expected = playbookExpectationFor(prompt.id, stopTitles);
        } else if (prompt.surface === "chat") {
          const { tripId, detail } = await seedTripFor(prompt);
          for (const body of [...(prompt.chat ?? []), prompt.text]) await postMessage(tripId, ACTOR_ID, { body });
          turn = await runTurn(prompt, tripId, undefined, "chat");
          expected = expectationFor(prompt.id, detail);
        } else {
          const { tripId, detail } = await seedTripFor(prompt);
          turn = await runTurn(prompt, tripId);
          expected = expectationFor(prompt.id, detail);
        }
        const { microUsd, estimated } = turn.spend;
        if (microUsd === null) unpricedTurns += 1;
        else spentMicroUsd += microUsd;
        if (microUsd !== null && estimated.length > 0) estimatedTurns += 1;
        console.log(
          `    cost: ${microUsd === null ? "unpriced" : `${estimated.length > 0 ? "~" : ""}${dollars(microUsd)}`} (run so far ${dollars(spentMicroUsd)})`,
        );
        for (const line of estimated) console.log(`    estimated: ${line}`);
        const checks = grade(turn, expected!);
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
          microUsd,
          costEstimated: estimated,
          retracted: turn.retracted,
          checks,
        });
        for (const check of checks) console.log(`    ${check.pass ? "✓" : "✗"} ${check.name}: ${check.detail}`);
        expect(checks.filter((check) => !check.pass).map((check) => `${check.name}: ${check.detail}`)).toEqual([]);
      });
    }
  }
});
