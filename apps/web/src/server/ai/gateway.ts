// Server-only: never import from UI code (would ship the gateway client to
// the client bundle). Configured Vercel AI Gateway model handle for Wave 5
// AI generation (ADR-015).
import { createGateway } from "@ai-sdk/gateway";
import { defaultSettingsMiddleware, wrapLanguageModel, type LanguageModel } from "ai";
import { serverConfig } from "@/server/config";

export function aiModel(modelId: string = serverConfig.aiModel) {
  if (!serverConfig.aiGatewayApiKey) {
    throw new Error("AI_GATEWAY_API_KEY not set");
  }
  const gateway = createGateway({ apiKey: serverConfig.aiGatewayApiKey });
  return pinnedToOwnKey(gateway(modelId));
}

/**
 * The providers a model id may be served by, when the Gateway must not choose
 * — or null, to let it choose.
 *
 * **An Anthropic model is pinned to Anthropic** (2026-10-10). The Gateway sells
 * one Claude model through several providers (Anthropic, Vertex, Bedrock) and
 * picks one per request, but our own key (BYOK) is an ANTHROPIC key: a request
 * the Gateway routes to Vertex runs on Vercel's credits, at Vercel's price,
 * while the credit the key holds sits unused. Verified by hand the same day: a
 * Haiku call pinned this way came back `is_byok: true`, `provider_name:
 * "anthropic"`, `total_cost: 0` on the Gateway's own record.
 */
export function pinnedProvidersFor(modelId: string): string[] | null {
  return modelId.startsWith("anthropic/") ? ["anthropic"] : null;
}

/**
 * `model`, with `pinnedProvidersFor` applied to every call made through it —
 * the agent's steps, a step that switches tier, and the classifier alike,
 * because they all reach a model through `aiModel`. The pin is a default
 * merged under each call's own `providerOptions`, so the agent's
 * `gateway.caching` survives beside it.
 */
export function pinnedToOwnKey<M extends Exclude<LanguageModel, string>>(model: M): M {
  const only = pinnedProvidersFor(model.modelId);
  if (only === null) return model;
  return wrapLanguageModel({
    model,
    middleware: defaultSettingsMiddleware({ settings: { providerOptions: { gateway: { only } } } }),
  }) as unknown as M;
}

/**
 * The model handle for the pre-turn intent classifier (askIntent.ts).
 *
 * A second model ID, not a second way to reach a provider: it goes through
 * `aiModel` above, so the key check and the client that carries the key stay
 * in exactly one function. Both are still reachable only from
 * `modelSelection.ts` — ADR-019's chokepoint, enforced by the lint wall.
 */
export function aiClassifierModel() {
  return aiModel(serverConfig.aiClassifierModel);
}
