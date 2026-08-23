import { describe, expect, it } from "vitest";
import { simulatedModel, SIMULATED_MODEL_ID } from "@/server/ai/simulatedModel";

// `simulatedModel` returns `LanguageModel`, which is `string | LanguageModelV4`
// — so `.doGenerate` is not reachable on the union — and LanguageModelV4 itself
// is not importable, because @ai-sdk/provider is not a direct dependency of
// apps/web. Narrow through one local structural type instead of fighting the
// union at every call site. `doGenerate` reads none of its options, so `{}`
// tests exactly as much as reconstructing LanguageModelV4CallOptions would.
type Call = { type: string; toolName: string; input: string; toolCallId: string };
type Generated = { content: Call[]; finishReason: { unified: string; raw: undefined } };
type Probe = {
  specificationVersion: string;
  modelId: string;
  doGenerate: (options: unknown) => Promise<Generated>;
  doStream: (options: unknown) => Promise<unknown>;
};

const probe = (surface: "page" | "board" | "combined") => simulatedModel(surface) as unknown as Probe;
const callsOf = (result: Generated) => result.content.filter((c) => c.type === "tool-call");

describe("simulatedModel", () => {
  it("identifies itself so meta.model.requested is honest", () => {
    expect(probe("board")).toMatchObject({ specificationVersion: "v4", modelId: SIMULATED_MODEL_ID });
    expect(SIMULATED_MODEL_ID).toBe("simulated/no-op");
  });

  it("emits two AddDay and three AddActivity calls for the board surface", async () => {
    const result = await probe("board").doGenerate({});
    expect(callsOf(result).map((c) => c.toolName)).toEqual([
      "AddDay",
      "AddDay",
      "AddActivity",
      "AddActivity",
      "AddActivity",
    ]);
    expect(result.finishReason).toEqual({ unified: "tool-calls", raw: undefined });
  });

  it("emits no location and no cost, so nothing reaches the geocoder or the wallet", async () => {
    const result = await probe("board").doGenerate({});
    for (const call of callsOf(result)) {
      const input = JSON.parse(call.input) as Record<string, unknown>;
      expect(input).not.toHaveProperty("location");
      expect(input).not.toHaveProperty("cost");
    }
  });

  it("emits one compose_page call for the page surface", async () => {
    const calls = callsOf(await probe("page").doGenerate({}));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.toolName).toBe("compose_page");
    const input = JSON.parse(calls[0]!.input) as { title: string; blocks: unknown[] };
    expect(input.title).toBeTruthy();
    expect(input.blocks.length).toBeGreaterThan(0);
  });

  // The 32-step budget makes this the difference between one batch and 32.
  it("stops after the first step instead of re-emitting forever", async () => {
    const model = probe("board");
    await model.doGenerate({});
    const second = await model.doGenerate({});
    expect(second.finishReason).toEqual({ unified: "stop", raw: undefined });
    expect(callsOf(second)).toHaveLength(0);
  });

  it("gives each tool call a distinct id", async () => {
    const ids = callsOf(await probe("board").doGenerate({})).map((c) => c.toolCallId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("refuses to stream rather than pretending to", async () => {
    await expect(probe("board").doStream({})).rejects.toThrow(/does not stream/);
  });
});
