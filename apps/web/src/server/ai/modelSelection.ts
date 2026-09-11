// The single place the ai-live flag is read. `handleAskRequest` asks this which
// model to use; it does not know a flag exists.
import type { LanguageModel } from "ai";
import { aiLiveFlag } from "@/server/flags";
import { serverConfig } from "@/server/config";
import { aiClassifierModel, aiModel } from "@/server/ai/gateway";
import { simulatedModel } from "@/server/ai/simulatedModel";
import type { AiSurface } from "@/server/ai/context";
import { MODEL_TIERS, type ModelTier, type TierModels } from "@/server/assistant/taskClass";
import {
  permitEverything,
  type EntitlementResolver,
  type ResolvedEntitlements,
} from "@/server/assistant/entitlements";

// May THIS request's caller cause a real model call. Every caller that only
// needs the answer uses this; `aiLiveMode()` below is the same decision with
// its provenance attached, for the one caller that needs to know how much the
// answer is worth.
//
// Per-user since the 2026-09-08 amendment to ADR-019: with `identify` on the
// flag (server/flagEntities.ts), two callers of this function in the same
// deployment can legitimately get different answers.
export async function aiLive(): Promise<boolean> {
  return (await aiLiveMode()).live;
}

// The same decision, plus WHERE it came from — because the two sources do not
// carry the same weight once the flag is per-user targetable:
//
//   * `"env"` — AI_LIVE decided it. Global, and true of every caller on this
//     server, because the flag was never consulted for anyone.
//   * `"flag"` — Vercel Flags decided it, FOR THE CALLER OF THIS REQUEST. A
//     targeting rule can answer differently for the next person, so this says
//     nothing about anyone else.
//
// `GET /api/health/ai-mode` reports it so its one consumer — e2e's
// global.setup.ts, which refuses to run a suite that could bill a real model —
// can tell a guarantee from a sample of one. Anonymous "not live" stopped being
// evidence about the signed-in test user the moment targeting existed.
export type AiLiveMode = { live: boolean; source: "env" | "flag" };

// AI_LIVE short-circuits the flag entirely. It has to live here rather than in
// the flag's own `decide`, because the Flags SDK treats an explicit `decide` as
// an override of the adapter — a decide returning undefined falls to
// `defaultValue`, not through to Vercel — so "env var, else ask Vercel" is not
// expressible inside the declaration.
//
// Strictly "true" and nothing else: a typo must fail toward not spending money.
//
// LOCAL AND CI ONLY. On Vercel this variable is unset and the flag is the sole
// source of truth. See .env.example.
export async function aiLiveMode(): Promise<AiLiveMode> {
  if (process.env.AI_LIVE !== undefined) {
    return { live: process.env.AI_LIVE === "true", source: "env" };
  }
  // `aiLiveFlag()`'s own `defaultValue: false` only covers a throw/undefined
  // from INSIDE the SDK's `decide` — it does not cover `readOverrides` /
  // `decryptOverrides` throwing earlier in `getRun()`, which happens when
  // FLAGS_SECRET is unset or malformed AND a `vercel-flag-overrides` cookie is
  // present (reachable locally, and on Vercel until FLAGS_SECRET is
  // configured there). Nor does it cover `identify` throwing: the SDK resolves
  // entities BEFORE the code path that applies `defaultValue` (verified in
  // flags@4.3.0, dist/next.js — `getEntities` runs ahead of `applyResult`), so
  // a failed session read escapes the flag the same way. Without this catch any
  // of those propagates out of aiLive() as an unhandled rejection, producing an
  // opaque 500 instead of the degrade-to-simulated guarantee this file and
  // ADR-019 document.
  try {
    return { live: await aiLiveFlag(), source: "flag" };
  } catch {
    // Unreachable/misconfigured Flags service, or an unidentifiable caller
    // ⇒ simulated, never spending.
    return { live: false, source: "flag" };
  }
}

// Warn once at module load if AI_LIVE is set anywhere on Vercel — this
// escape hatch is local/CI-only (see aiLive()'s doc comment above and
// .env.example); on Vercel it silently makes the ai-live flag's dashboard and
// Toolbar controls inert, which is easy to miss without a loud signal.
if (process.env.VERCEL && process.env.AI_LIVE !== undefined) {
  console.warn(
    "AI_LIVE is set in a Vercel environment — this overrides the ai-live flag entirely. " +
      "This should never happen outside local dev/CI. See .env.example.",
  );
}

// Who is asking, and for what. `userId` is carried even though nothing reads
// it yet (ADR-019's 2026-08-25 amendment §3): the day a pro-tier check exists
// it lands inside `isEntitled` below, not as a signature change that would
// touch every caller again.
export interface AiActor {
  surface: AiSurface;
  userId: string;
}

// `live`/`simulated` decide WHICH model answers; `denied` means none does.
// Three outcomes, not a boolean pair — collapsing `denied` into `simulated`
// would mean a user without access gets a fabricated plan that mutates their
// trip instead of a refusal (ADR-019 amendment §3).
//
// `classifierModel` is the /ask pre-turn intent classifier's model
// (askIntent.ts). It rides along on the SELECTION rather than being fetched
// where it is used, because a second model is a second way to reach a
// provider: carried here it inherits every property this function already
// guarantees — the flag, the entitlement check, and the single gateway
// chokepoint — instead of needing them restated at the call site.
export type ModelSelection =
  | { outcome: "live"; models: TierModels; classifierModel: LanguageModel; entitlements: ResolvedEntitlements }
  | { outcome: "simulated"; models: TierModels; classifierModel: LanguageModel; entitlements: ResolvedEntitlements }
  | { outcome: "denied"; reason: string };

// `TierModels` itself is the kernel's (assistant/taskClass.ts) — the slot names
// belong to the thing that routes, and this module is where a slot becomes an
// id. Re-exported so a caller reading a `ModelSelection` has one import.
export type { TierModels };

/**
 * **The resolved tier map, as ids** — what `GET /api/health/ai-mode` reports.
 *
 * Today that endpoint answers *whether* AI is live and not *what* is running,
 * so "which models is production actually on?" is answerable only by reading
 * environment variables in a dashboard. That is exactly how a compiled default
 * goes unnoticed: `config.ts` compiles `anthropic/claude-haiku-4-5` while
 * production sets `AI_MODEL` to `deepseek/deepseek-v4-flash-0731`, and M20
 * link 5 records that gap already costing one estimate an order of magnitude.
 * One field, and the question becomes answerable from outside.
 *
 * The classifier rides along for the same reason it rides along on a
 * `ModelSelection`: a second model id is a second thing that can be wrong about
 * what is running.
 */
export function resolvedTierMap(): Record<ModelTier | "classifier", string> {
  return { ...serverConfig.aiModelTiers, classifier: serverConfig.aiClassifierModel };
}

// Built EAGERLY on the live branch rather than lazily, and that is deliberate:
// *"never constructs a gateway client, of either kind, when the flag is off"*
// is a promise about what this function DOES, and a lazy map would satisfy that
// test by doing nothing at all on either branch. Three `createGateway` calls
// where there was one is an object each, no network and no key read beyond the
// one `aiModel` already performs.
function tierModels(build: (modelId: string) => LanguageModel): TierModels {
  const models = {} as Record<ModelTier, LanguageModel>;
  for (const tier of MODEL_TIERS) models[tier] = build(serverConfig.aiModelTiers[tier]);
  return models;
}

// The HTTP contract for a `denied` outcome, defined once here so /ask's two
// halves (the turn and the approval) render the same refusal rather than each
// inventing its own shape. 403, not 402: 402 asserts a payment relationship
// that does not exist yet.
export const AI_NOT_ENTITLED_CODE = "ai-not-entitled";

export function deniedResponse(reason: string): Response {
  return Response.json({ error: reason, code: AI_NOT_ENTITLED_CODE }, { status: 403 });
}

// No entitlement source exists yet — there is no account tier anywhere in the
// product (M15 owns the account menu). Every actor is entitled until one
// exists, so this default keeps `denied` unreachable in production while the
// type and the branch are real. Callers never override this outside tests;
// M16/M15 wiring a real check in later is a change inside this function, not
// a new parameter every caller has to learn about.
//
// **Widened by P5 from `(actor) => boolean` to a `ResolvedEntitlements`
// resolver** (ADR-043 decision 5, spec §7c). A boolean cannot express what M20
// needs of this port: `has(capability)` for the SET a plan grants,
// `ceilings` for the per-user numbers admission needs, and `planVersionRef`
// for which version was pinned. It is `async` and resolved per request because
// M20 requires it — *"a downgrade must bite before a token refreshes"* — so the
// answer comes from the database and never off the session. The name stays so
// that M20 link 4, which names this port, still finds it.
//
// The default still permits everything and caps nothing, so behaviour is
// unchanged (entitlements.ts).
export type AiEntitlementCheck = EntitlementResolver;

// `aiModel()`/`aiClassifierModel()` are called ONLY on the live branch — they
// construct the gateway client that carries AI_GATEWAY_API_KEY, and throw when
// that key is unset. Calling either eagerly would both spend-enable the off
// path and break simulated mode on a deployment that has no key at all.
// Enforced by a test.
//
// `isEntitled` is a test seam, not a real parameter callers pass — it exists
// so `denied`, currently unreachable in production, can still be exercised by
// a test (M16's gate requires this).
//
// **`ai.ask` is what is asked for here, and it is the effect axis** (spec §7c):
// M20's entitlement vocabulary maps onto §2's effects, `ai.ask` onto `read`. An
// account without it is refused at THIS stage and never reaches tools at all,
// which is why the refusal belongs here rather than in the tool filter.
export async function selectAiModel(
  actor: AiActor,
  isEntitled: AiEntitlementCheck = permitEverything,
): Promise<ModelSelection> {
  const entitlements = await isEntitled(actor);
  if (!entitlements.has("ai.ask")) {
    return { outcome: "denied", reason: "AI is not available for this account." };
  }
  if (!(await aiLive())) {
    // ONE instance, used for every tier and for the classifier. The
    // classification call and the turn are the same turn as far as this model
    // is concerned — it decides which shape to answer with from the prompt it
    // is handed, never from instance state (simulatedModel.ts). Neither reaches
    // a provider, which is the property the second model id must not quietly
    // break, so it has a test; the same is now true of the third, fourth and
    // fifth.
    const simulated = simulatedModel();
    return {
      outcome: "simulated",
      models: tierModels(() => simulated),
      classifierModel: simulated,
      entitlements,
    };
  }
  return {
    outcome: "live",
    models: tierModels((modelId) => aiModel(modelId)),
    classifierModel: aiClassifierModel(),
    entitlements,
  };
}
