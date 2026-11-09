// Server-only: never import from UI code (would ship the provider client to
// the client bundle). The configured model handle for AI generation (ADR-015).
// The file keeps its name — ADR-019's lint wall names it — but since M59 part 4
// it reaches Anthropic directly, not through Vercel's AI Gateway.
import { createAnthropic } from "@ai-sdk/anthropic";
import { wrapLanguageModel } from "ai";
import { serverConfig } from "@/server/config";
import { resolveChatModel } from "./modelId";

export function aiModel(modelId: string = serverConfig.aiModel) {
  if (!serverConfig.anthropicApiKey) {
    throw new Error("ANTHROPIC_API_KEY not set");
  }
  const resolved = resolveChatModel(modelId);
  const model = createAnthropic({ apiKey: serverConfig.anthropicApiKey })(resolved.model);
  // The handle keeps the Gateway-form id (`anthropic/claude-…`): the ledger's
  // `turn_model`, the rate table and the metrics all key on it, and the
  // provider's bare name would make every row miss its price.
  return wrapLanguageModel({ model, middleware: {}, modelId: resolved.id });
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
