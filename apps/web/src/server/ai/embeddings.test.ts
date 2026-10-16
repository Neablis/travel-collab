import { afterEach, describe, expect, it, vi } from "vitest";

// `serverConfig` reads process.env once at module load, so every case here
// stubs the env and re-imports — the same pattern as gateway.test.ts.
// DATABASE_URL and API_TOKEN_PEPPER are set by vitest.setup.ts; only the
// AI_GATEWAY_API_KEY and embedding knobs are stubbed per case.

// The whole point of this seam: the network never gets touched. The fake
// below stands in for the Gateway's embedding model, so the REAL `embed`
// from the `ai` package still runs against it — including its retry logic —
// while no request leaves the process (the network guard would fail one).
//
// `vi.hoisted`: a mock factory runs before the module body, so the knobs it
// reads must be hoisted too — a plain `let` here is a runtime error.
const seam = vi.hoisted(() => ({
  behavior: "ok" as "ok" | "throw" | "hang" | "wrong-dims",
  receivedModelId: undefined as string | undefined,
}));

vi.mock("@ai-sdk/gateway", () => ({
  createGateway: () => ({
    embeddingModel: (modelId: string) => {
      seam.receivedModelId = modelId;
      return {
        specificationVersion: "v3",
        provider: "test-gateway",
        modelId,
        doEmbed: async ({
          values,
          abortSignal,
        }: {
          values: string[];
          abortSignal?: AbortSignal;
        }) => {
          // Plain Errors are not retried by the AI SDK (only APICallError /
          // GatewayError with isRetryable are), so this path is fast.
          if (seam.behavior === "throw") throw new Error("provider exploded");
          if (seam.behavior === "hang") {
            // Never resolves; the AbortSignal.timeout in embedText is what
            // ends it. Honours the signal so the test does not leak a timer.
            await new Promise<never>((_, reject) => {
              abortSignal?.addEventListener(
                "abort",
                () => reject(new DOMException("the operation was aborted", "AbortError")),
                { once: true },
              );
            });
          }
          const dims = seam.behavior === "wrong-dims" ? 10 : 1536;
          return {
            embeddings: values.map((_, i) =>
              Array.from({ length: dims }, (_, j) => (i + j + 1) / dims),
            ),
          };
        },
      };
    },
  }),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  seam.behavior = "ok";
  seam.receivedModelId = undefined;
});

async function embedTextWithEnv(env: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  // Both imports come AFTER the stubs: `serverConfig` reads the env once at
  // module load, and importing it first would cache a config built from the
  // real environment.
  const { serverConfig } = await import("@/server/config");
  const { embedText } = await import("./embeddings");
  return { embedText, serverConfig };
}

describe("embedText", () => {
  it("returns a 1536-dim embedding for text", async () => {
    const { embedText, serverConfig } = await embedTextWithEnv({
      AI_GATEWAY_API_KEY: "test-key",
    });
    const embedding = await embedText("a food day in Tokyo");
    expect(embedding).not.toBeNull();
    expect(embedding).toHaveLength(1536);
    expect(embedding!.every((n) => typeof n === "number")).toBe(true);
    // The model id comes from config, never from kernel code (ADR-019):
    // asserted against the resolved value, not a literal.
    expect(seam.receivedModelId).toBe(serverConfig.embeddingModel);
  });

  it("honours AI_EMBEDDING_MODEL when set, leaving the default alone otherwise", async () => {
    const { embedText, serverConfig } = await embedTextWithEnv({
      AI_GATEWAY_API_KEY: "test-key",
      AI_EMBEDDING_MODEL: "vendor/other-embeddings",
    });
    await embedText("hello");
    expect(serverConfig.embeddingModel).toBe("vendor/other-embeddings");
    expect(seam.receivedModelId).toBe("vendor/other-embeddings");
  });

  it("returns null when the provider throws (fail-open)", async () => {
    seam.behavior = "throw";
    const { embedText } = await embedTextWithEnv({ AI_GATEWAY_API_KEY: "test-key" });
    await expect(embedText("a food day in Tokyo")).resolves.toBeNull();
  });

  it("returns null when the provider hangs past the timeout (fail-open)", async () => {
    seam.behavior = "hang";
    const { embedText } = await embedTextWithEnv({
      AI_GATEWAY_API_KEY: "test-key",
      AI_EMBEDDING_TIMEOUT_MS: "50",
    });
    await expect(embedText("a food day in Tokyo")).resolves.toBeNull();
  }, 10_000);

  it("returns null when the provider answers with the wrong dimensions", async () => {
    seam.behavior = "wrong-dims";
    const { embedText } = await embedTextWithEnv({ AI_GATEWAY_API_KEY: "test-key" });
    await expect(embedText("a food day in Tokyo")).resolves.toBeNull();
  });

  it("throws on empty text — a programmer error, not a provider failure", async () => {
    const { embedText } = await embedTextWithEnv({ AI_GATEWAY_API_KEY: "test-key" });
    await expect(embedText("")).rejects.toThrow("empty");
    await expect(embedText("   ")).rejects.toThrow("empty");
  });

  it("throws when AI_GATEWAY_API_KEY is unset, like aiModel does", async () => {
    const { embedText } = await embedTextWithEnv({ AI_GATEWAY_API_KEY: "" });
    await expect(embedText("hello")).rejects.toThrow("AI_GATEWAY_API_KEY not set");
  });
});
