import { describe, expect, it } from "vitest";
import { resolveChatModel, resolveEmbeddingModel } from "./modelId";

describe("resolveChatModel", () => {
  it("maps a Gateway-form Anthropic id to the Anthropic provider and its bare name", () => {
    expect(resolveChatModel("anthropic/claude-haiku-5.5")).toEqual({
      provider: "anthropic",
      model: "claude-haiku-5.5",
      id: "anthropic/claude-haiku-5.5",
    });
  });

  it("throws for a chat model from any other provider", () => {
    expect(() => resolveChatModel("openai/gpt-x")).toThrow(/only anthropic/);
    expect(() => resolveChatModel("claude-haiku-5.5")).toThrow(/only anthropic/);
  });

  it("trims whitespace and a literal trailing backslash-n a pasted value carried", () => {
    expect(resolveChatModel("anthropic/claude-haiku-5.5\\n").model).toBe("claude-haiku-5.5");
    expect(resolveChatModel("  anthropic/claude-haiku-5.5 \n").id).toBe("anthropic/claude-haiku-5.5");
  });
});

describe("resolveEmbeddingModel", () => {
  it("maps openai/text-embedding-3-small to OpenAI", () => {
    expect(resolveEmbeddingModel("openai/text-embedding-3-small")).toEqual({
      provider: "openai",
      model: "text-embedding-3-small",
    });
  });

  it("throws for an embedding model from any other provider", () => {
    expect(() => resolveEmbeddingModel("cohere/embed-v4")).toThrow(/only openai/);
  });
});
