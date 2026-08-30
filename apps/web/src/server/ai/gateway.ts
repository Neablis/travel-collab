// Server-only: never import from UI code (would ship the gateway client to
// the client bundle). Configured Vercel AI Gateway model handle for Wave 5
// AI generation (ADR-015).
import { createGateway } from "@ai-sdk/gateway";
import { serverConfig } from "@/server/config";

export function aiModel(modelId: string = serverConfig.aiModel) {
  if (!serverConfig.aiGatewayApiKey) {
    throw new Error("AI_GATEWAY_API_KEY not set");
  }
  const gateway = createGateway({ apiKey: serverConfig.aiGatewayApiKey });
  return gateway(modelId);
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
