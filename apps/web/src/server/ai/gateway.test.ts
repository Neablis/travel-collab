import { afterEach, describe, expect, it, vi } from "vitest";

// `serverConfig` reads process.env once at module load, so every case here
// stubs the env and re-imports. `DATABASE_URL` is set by vitest.setup.ts —
// config.ts throws without it.
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("aiModel", () => {
  it("throws when AI_GATEWAY_API_KEY is unset", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "");
    const { aiModel } = await import("./gateway");
    expect(() => aiModel()).toThrow("AI_GATEWAY_API_KEY not set");
  });

  it("returns a model handle when AI_GATEWAY_API_KEY is set", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "test-key");
    const { aiModel } = await import("./gateway");
    expect(aiModel()).toBeDefined();
  });
});

// The classifier's model id is configurable SEPARATELY from the answer
// model's, and Mitchell's explicit call is that nothing changes until he sets
// the var. That makes the defaulting the load-bearing part of this feature,
// not the override — so it is asserted on the resolved model id rather than on
// "a handle came back".
describe("aiClassifierModel", () => {
  async function classifierId(env: Record<string, string | undefined>) {
    vi.stubEnv("AI_GATEWAY_API_KEY", "test-key");
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    const { aiClassifierModel } = await import("./gateway");
    return aiClassifierModel().modelId;
  }

  it("defaults to AI_MODEL, so setting AI_MODEL alone still moves both", async () => {
    await expect(classifierId({ AI_MODEL: "vendor/answer-model", AI_CLASSIFIER_MODEL: undefined })).resolves.toBe(
      "vendor/answer-model",
    );
  });

  it("falls back to the same built-in default when neither is set", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "test-key");
    vi.stubEnv("AI_MODEL", undefined);
    vi.stubEnv("AI_CLASSIFIER_MODEL", undefined);
    // Both imports come AFTER the stubs: `serverConfig` reads the env once at
    // module load, and importing it first would cache a config built from the
    // real environment.
    const { serverConfig } = await import("@/server/config");
    const { aiClassifierModel } = await import("./gateway");
    // Against `serverConfig.aiModel` rather than the literal, so the assertion
    // is "the same default", which is the property, not "this string".
    expect(aiClassifierModel().modelId).toBe(serverConfig.aiModel);
  });

  it("uses AI_CLASSIFIER_MODEL when it is set, leaving the answer model alone", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "test-key");
    vi.stubEnv("AI_MODEL", "vendor/answer-model");
    vi.stubEnv("AI_CLASSIFIER_MODEL", "vendor/tiny-classifier");
    const { aiModel, aiClassifierModel } = await import("./gateway");
    expect(aiClassifierModel().modelId).toBe("vendor/tiny-classifier");
    expect(aiModel().modelId).toBe("vendor/answer-model");
  });

  // A second model id must not become a second door to the provider: it goes
  // through `aiModel`, so it inherits the key check rather than restating it.
  it("throws the same missing-key error as the answer model", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "");
    vi.stubEnv("AI_CLASSIFIER_MODEL", "vendor/tiny-classifier");
    const { aiClassifierModel } = await import("./gateway");
    expect(() => aiClassifierModel()).toThrow("AI_GATEWAY_API_KEY not set");
  });
});

// The BYOK pin (2026-10-10): our key is an Anthropic key, and a Claude call the
// Gateway routes to Vertex or Bedrock runs on Vercel's credits instead. Asserted
// on what the provider is HANDED, through a recording model, so the merge with
// a call's own options is part of what is tested.
describe("pinnedToOwnKey", () => {
  function recording(modelId: string) {
    const seen: { providerOptions?: unknown }[] = [];
    const model = {
      specificationVersion: "v4",
      provider: "gateway",
      modelId,
      supportedUrls: {},
      doGenerate: async (options: { providerOptions?: unknown }) => {
        seen.push(options);
        return {
          content: [{ type: "text", text: "ok" }],
          finishReason: { unified: "stop", raw: undefined },
          usage: {
            inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
            outputTokens: { total: 1, text: undefined, reasoning: undefined },
          },
          warnings: [],
        };
      },
    };
    return { model, seen };
  }

  it("pins an Anthropic model to Anthropic, keeping the call's own gateway options", async () => {
    const { generateText } = await import("ai");
    const { pinnedToOwnKey } = await import("./gateway");
    const { model, seen } = recording("anthropic/claude-haiku-5.5");
    const pinned = pinnedToOwnKey(model as never);
    await generateText({ model: pinned, prompt: "hi", providerOptions: { gateway: { caching: "auto" } } });

    expect(seen[0]!.providerOptions).toEqual({ gateway: { only: ["anthropic"], caching: "auto" } });
    expect((pinned as { modelId: string }).modelId).toBe("anthropic/claude-haiku-5.5");
  });

  it("leaves any other model to the Gateway's own routing", async () => {
    const { generateText } = await import("ai");
    const { pinnedToOwnKey } = await import("./gateway");
    const { model, seen } = recording("zai/glm-5.3-flash");
    await generateText({ model: pinnedToOwnKey(model as never), prompt: "hi" });

    expect(seen[0]!.providerOptions).toBeUndefined();
  });
});
