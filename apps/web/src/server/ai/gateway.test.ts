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
