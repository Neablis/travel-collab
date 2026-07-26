import { afterEach, describe, expect, it, vi } from "vitest";

describe("aiModel", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

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
