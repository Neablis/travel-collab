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
  return aiLiveFlag();
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
