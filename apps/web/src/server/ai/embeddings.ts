// Server-only: never import from UI code (would ship the gateway client to
// the client bundle). One embedding call through the Vercel AI Gateway,
// for the plan-retrieval RAG stack.
import { createGateway } from "@ai-sdk/gateway";
import { embed } from "ai";
import { serverConfig } from "@/server/config";

/** The dimension `text-embedding-3-small` produces, and `day_embeddings.embedding` is sized for. */
export const EMBEDDING_DIMENSIONS = 1536;

/**
 * Embed one text into a 1536-dimension vector, or null when the provider
 * cannot be reached in time.
 *
 * **The contract is fail-open, like the retrieval query beside it.** This
 * function returns `null` — never throws — on anything the provider does:
 * a timeout, a 4xx/5xx, a malformed response, a wrong-dimensioned vector.
 * Every one of those is logged, and the caller (Part 4's serving path)
 * treats `null` as "no examples this turn", which is today's behaviour
 * exactly. The turn must never be more expensive for having tried.
 *
 * It throws only on programmer errors: empty text (nothing to embed), and
 * a missing `AI_GATEWAY_API_KEY` (a deployment misconfiguration — the same
 * throw `aiModel()` makes, so the two stay greppable together).
 *
 * Why this does not go through `@/server/ai/gateway`: that module is the
 * ADR-019 chokepoint for *language* models, and the lint wall permits only
 * `modelSelection.ts` to import it. An embedding model is a different job —
 * no tier, no simulated-model seam — so it builds its own Gateway client
 * with the same key check, rather than widening the wall's one hole.
 *
 * @param text The chunk or query to embed. Must be non-empty.
 * @returns The embedding, or null when the provider failed (logged).
 */
export async function embedText(text: string): Promise<number[] | null> {
  if (text.trim() === "") {
    throw new Error("embedText: cannot embed empty text");
  }
  if (!serverConfig.aiGatewayApiKey) {
    throw new Error("AI_GATEWAY_API_KEY not set");
  }
  const modelId = serverConfig.embeddingModel;
  const gateway = createGateway({ apiKey: serverConfig.aiGatewayApiKey });
  try {
    const { embedding } = await embed({
      model: gateway.embeddingModel(modelId),
      value: text,
      abortSignal: AbortSignal.timeout(serverConfig.embeddingTimeoutMs),
    });
    if (embedding.length !== EMBEDDING_DIMENSIONS) {
      console.error("rag: embedding provider returned wrong dimensions", {
        modelId,
        expected: EMBEDDING_DIMENSIONS,
        actual: embedding.length,
      });
      return null;
    }
    return embedding;
  } catch (error) {
    // Fail-open: the provider is down, slow, rate-limiting, or answered
    // garbage. The log is the record; the turn goes on without examples.
    console.error("rag: embedding failed, continuing without retrieval", {
      modelId,
      error,
    });
    return null;
  }
}
