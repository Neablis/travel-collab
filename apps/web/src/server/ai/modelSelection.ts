// The single place the ai-live flag is read. handleAiRequest asks this which
// model to use; it does not know a flag exists.
import type { LanguageModel } from "ai";
import { aiLiveFlag } from "@/server/flags";
import { aiClassifierModel, aiModel } from "@/server/ai/gateway";
import { simulatedModel } from "@/server/ai/simulatedModel";
import type { AiSurface } from "@/server/ai/context";

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
export async function aiLive(): Promise<boolean> {
  if (process.env.AI_LIVE !== undefined) return process.env.AI_LIVE === "true";
  // `aiLiveFlag()`'s own `defaultValue: false` only covers a throw/undefined
  // from INSIDE the SDK's `decide` — it does not cover `readOverrides` /
  // `decryptOverrides` throwing earlier in `getRun()`, which happens when
  // FLAGS_SECRET is unset or malformed AND a `vercel-flag-overrides` cookie is
  // present (reachable locally, and on Vercel until FLAGS_SECRET is
  // configured there). Without this catch that throw propagates out of
  // aiLive() as an unhandled rejection, producing an opaque 500 instead of
  // the degrade-to-simulated guarantee this file and ADR-019 document.
  try {
    return await aiLiveFlag();
  } catch {
    return false; // unreachable/misconfigured Flags service ⇒ simulated, never spending
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
  | { outcome: "live"; model: LanguageModel; classifierModel: LanguageModel }
  | { outcome: "simulated"; model: LanguageModel; classifierModel: LanguageModel }
  | { outcome: "denied"; reason: string };

// The HTTP contract for a `denied` outcome, defined once here so every caller
// (today's /ai endpoint, M16's /ask endpoint) renders the same refusal rather
// than each inventing its own shape. 403, not 402: 402 asserts a payment
// relationship that does not exist yet.
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
export type AiEntitlementCheck = (actor: AiActor) => boolean | Promise<boolean>;
const EVERYONE_IS_ENTITLED: AiEntitlementCheck = () => true;

// `aiModel()`/`aiClassifierModel()` are called ONLY on the live branch — they
// construct the gateway client that carries AI_GATEWAY_API_KEY, and throw when
// that key is unset. Calling either eagerly would both spend-enable the off
// path and break simulated mode on a deployment that has no key at all.
// Enforced by a test.
//
// `isEntitled` is a test seam, not a real parameter callers pass — it exists
// so `denied`, currently unreachable in production, can still be exercised by
// a test (M16's gate requires this).
export async function selectAiModel(
  actor: AiActor,
  isEntitled: AiEntitlementCheck = EVERYONE_IS_ENTITLED,
): Promise<ModelSelection> {
  if (!(await isEntitled(actor))) {
    return { outcome: "denied", reason: "AI is not available for this account." };
  }
  if (!(await aiLive())) {
    // ONE simulated instance, used for both. The classification call and the
    // turn are the same surface, and `simulatedModel`'s per-instance latch is
    // written on that assumption. Neither reaches a provider — which is the
    // property the second model id must not quietly break, so it has a test.
    const simulated = simulatedModel(actor.surface);
    return { outcome: "simulated", model: simulated, classifierModel: simulated };
  }
  return { outcome: "live", model: aiModel(), classifierModel: aiClassifierModel() };
}
