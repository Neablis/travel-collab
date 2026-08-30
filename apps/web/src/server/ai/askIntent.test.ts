// The pre-turn classifier (askIntent.ts).
//
// Everything here is about the ASYMMETRY the module is built on: a question
// wrongly given write tools costs ~3,400 tokens, a change request wrongly
// denied them cannot act at all. So the interesting cases are not "does it
// classify correctly" — they are "what does it do when it can't", and the
// answer has to be `write` every time.
import { describe, expect, it } from "vitest";
import type { LanguageModel } from "ai";
import { ASK_INTENT_INSTRUCTION, classifyAskIntent, isAskIntentCall } from "@/server/ai/askIntent";

// The slice of a call the assertions below read. Structural for the same
// reason `simulatedModel` is: LanguageModelV4CallOptions lives in a package
// apps/web does not depend on.
interface SeenCall {
  tools?: unknown;
  prompt?: readonly { role?: string; content?: unknown }[];
  maxOutputTokens?: number;
  abortSignal?: AbortSignal;
}

/** A model that answers with `text`, and records what it was asked with. */
function modelSaying(text: string) {
  const seen: SeenCall[] = [];
  const model = {
    specificationVersion: "v4",
    provider: "test",
    modelId: "test/classifier",
    supportedUrls: {},
    doGenerate: async (options: SeenCall) => {
      seen.push(options);
      // What a real provider does: the signal reaches `fetch`, and an aborted
      // one throws before a byte goes out. Without this the abort test below
      // would assert our own call site rather than the behaviour.
      options.abortSignal?.throwIfAborted();
      return {
        content: [{ type: "text", text }],
        finishReason: { unified: "stop", raw: undefined },
        usage: {
          inputTokens: { total: 151, noCache: 151, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 1, text: undefined, reasoning: undefined },
        },
        warnings: [],
      };
    },
  } as unknown as LanguageModel;
  return { model, seen };
}

function modelThatThrows(err: unknown) {
  return {
    specificationVersion: "v4",
    provider: "test",
    modelId: "test/classifier",
    supportedUrls: {},
    doGenerate: async () => {
      throw err;
    },
  } as unknown as LanguageModel;
}

describe("classifyAskIntent", () => {
  it("narrows to read-only on an unambiguous question", async () => {
    const { model } = modelSaying("question");
    const result = await classifyAskIntent(model, "How is the trip looking?");
    expect(result).toMatchObject({ intent: "question", verdict: "question", failedOpen: false });
  });

  it("keeps the write half on an unambiguous change request", async () => {
    const { model } = modelSaying("write");
    const result = await classifyAskIntent(model, "Add a coffee stop to day 2");
    expect(result).toMatchObject({ intent: "write", verdict: "write", failedOpen: false });
  });

  // Leniency stops at the word: casing and punctuation are the model being a
  // model, not the model being wrong.
  it("reads `Question.` and `WRITE` as the words they are", async () => {
    expect((await classifyAskIntent(modelSaying("Question.").model, "q")).intent).toBe("question");
    expect((await classifyAskIntent(modelSaying(" WRITE\n").model, "q")).intent).toBe("write");
    expect((await classifyAskIntent(modelSaying("Question.").model, "q")).failedOpen).toBe(false);
  });

  // The load-bearing rule, in the three shapes it can arrive in.
  describe("fails open to the full tool set", () => {
    it("when the model answers with something unrecognised", async () => {
      const result = await classifyAskIntent(modelSaying("It depends on what you mean.").model, "hmm");
      expect(result.intent).toBe("write");
      expect(result.failedOpen).toBe(true);
      // The words themselves are kept: "answered a paragraph" and "answered
      // `writes`" are different problems with the same verdict.
      expect(result.verdict).toBe("It depends on what you mean.");
    });

    it("when the model answers with nothing at all", async () => {
      const result = await classifyAskIntent(modelSaying("").model, "hmm");
      expect(result).toMatchObject({ intent: "write", failedOpen: true });
    });

    it("when the call throws, without propagating the throw", async () => {
      const promise = classifyAskIntent(modelThatThrows(new Error("gateway exploded")), "Add a stop");
      await expect(promise).resolves.toMatchObject({ intent: "write", failedOpen: true });
      expect((await promise).verdict).toContain("gateway exploded");
    });

    // A cost optimisation must not be able to break a turn — including on a
    // rejection that cannot even be turned into a string.
    it("when the thrown value has no usable string form", async () => {
      const hostile = Object.create(null) as object;
      await expect(classifyAskIntent(modelThatThrows(hostile), "Add a stop")).resolves.toMatchObject({
        intent: "write",
        failedOpen: true,
      });
    });

    it("when the request was already aborted", async () => {
      const controller = new AbortController();
      controller.abort();
      await expect(
        classifyAskIntent(modelSaying("question").model, "How is the trip looking?", controller.signal),
      ).resolves.toMatchObject({ intent: "write", failedOpen: true });
    });
  });

  // The whole point of the call: ~85% of a step's fixed input cost is tool
  // schemas, so a classification that carried them would buy nothing. Asserted
  // on what the model was actually handed, not on the call site.
  it("sends no tools and one short instruction", async () => {
    const { model, seen } = modelSaying("question");
    await classifyAskIntent(model, "How is the trip looking?");

    expect(seen).toHaveLength(1);
    const call = seen[0]!;
    expect(call.tools ?? []).toEqual([]);
    expect(call.maxOutputTokens).toBeLessThanOrEqual(8);
    const system = (call.prompt ?? []).filter((m) => m.role === "system").map((m) => String(m.content));
    // The instruction is re-sent on every turn; a ceiling on it is a ceiling
    // on the saving. 600 characters is roughly 150 tokens — the budget the
    // measurement in askIntent.ts assumes.
    expect(system.join("\n").length).toBeLessThan(600);
  });

  it("records the classification's own cost and latency", async () => {
    const { model } = modelSaying("question");
    const result = await classifyAskIntent(model, "How is the trip looking?", undefined, stepClock());
    expect(result.usage).toEqual({ inputTokens: 151, outputTokens: 1, totalTokens: 152 });
    expect(result.latencyMs).toBe(10);
  });

  // The marker is how the flag-off path recognises a classification call
  // (simulatedModel.ts). Round-tripped here so it cannot be reworded on one
  // side only — the same protection `askScopeLine`/`parseAskScope` has.
  it("marks its own instruction recognisably", () => {
    expect(isAskIntentCall(ASK_INTENT_INSTRUCTION)).toBe(true);
    expect(isAskIntentCall("You are the travel-collab trip assistant.")).toBe(false);
  });
});

/** 10ms per read, so a latency assertion is a fact rather than a range. */
function stepClock(): () => number {
  let t = 0;
  return () => (t += 10);
}
