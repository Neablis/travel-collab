// The single place the ai-live flag is read. handleAiRequest asks this which
// model to use; it does not know a flag exists.
import type { LanguageModel } from "ai";
import { aiLiveFlag } from "@/server/flags";
import { aiModel } from "@/server/ai/gateway";
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

// `aiModel()` is called ONLY on the live branch — it constructs the gateway
// client that carries AI_GATEWAY_API_KEY, and it throws when that key is unset.
// Calling it eagerly would both spend-enable the off path and break simulated
// mode on a deployment that has no key at all. Enforced by a test.
export async function selectAiModel(
  surface: AiSurface,
): Promise<{ model: LanguageModel; simulated: boolean }> {
  return (await aiLive())
    ? { model: aiModel(), simulated: false }
    : { model: simulatedModel(surface), simulated: true };
}
