// Server-only: never import from UI code (would ship the gateway client to
// the client bundle). Configured Vercel AI Gateway model handle for Wave 5
// AI generation (ADR-015).
import { createGateway } from "@ai-sdk/gateway";
import { serverConfig } from "@/server/config";

export function aiModel() {
  if (!serverConfig.aiGatewayApiKey) {
    throw new Error("AI_GATEWAY_API_KEY not set");
  }
  const gateway = createGateway({ apiKey: serverConfig.aiGatewayApiKey });
  return gateway(serverConfig.aiModel);
}
