// The pre-turn classifier (askIntent.ts).
//
// Everything here is about the ASYMMETRY the module is built on: a question
// wrongly given write tools costs ~3,400 tokens, a change request wrongly
// denied them cannot act at all. So the interesting cases are not "does it
// classify correctly" — they are "what does it do when it can't", and the
// answer has to be `write` every time.
import { describe, expect, it } from "vitest";
import type { LanguageModel } from "ai";
import {
  ASK_INTENT_INSTRUCTION,
  askIntentVerdictText,
  classifyAskIntent,
  isAskIntentCall,
  isBareAgreement,
  type AskIntent,
} from "@/server/ai/askIntent";

// The slice of a call the assertions below read. Structural for the same
// reason `simulatedModel` is: LanguageModelV4CallOptions lives in a package
// apps/web does not depend on.
interface SeenCall {
  tools?: unknown;
  prompt?: readonly { role?: string; content?: unknown }[];
  maxOutputTokens?: number;
  abortSignal?: AbortSignal;
  responseFormat?: { type?: string; schema?: unknown };
}

/**
 * A model that emits `text` verbatim, and records what it was asked with.
 *
 * `text` is what the provider puts on the wire, NOT a verdict: since the
 * verdict became a schema (KI-88) the interesting inputs are the ones that are
 * not valid JSON for it, and those have to be spelled out literally.
 */
function modelSaying(text: string, finishReason = "stop") {
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
        finishReason: { unified: finishReason, raw: undefined },
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

/**
 * A model that fills in the structured verdict properly.
 *
 * Built through `askIntentVerdictText` on purpose: that is the same function
 * `simulatedModel` emits through, so every green assertion below is also a
 * round-trip of the wire shape the flag-off path — the only path any Vercel
 * environment runs — produces. If an SDK upgrade moved `Output.choice` off
 * `{ result }`, this file goes red rather than the deployment going quiet.
 */
function modelReturning(intent: AskIntent) {
  return modelSaying(askIntentVerdictText(intent));
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
    const { model } = modelReturning("question");
    const result = await classifyAskIntent(model, "How is the trip looking?");
    expect(result).toMatchObject({ intent: "question", failedOpen: false });
    // The RAW structured verdict, not the parsed enum — `intent` already
    // carries that, and this field's job is to stay useful when they disagree.
    expect(result.verdict).toBe('{"result":"question"}');
  });

  it("keeps the write half on an unambiguous change request", async () => {
    const { model } = modelReturning("write");
    const result = await classifyAskIntent(model, "Add a coffee stop to day 2");
    expect(result).toMatchObject({ intent: "write", failedOpen: false });
  });

  // Which model gave the verdict, so a deployment that has pointed
  // AI_CLASSIFIER_MODEL somewhere else can be judged on its own records rather
  // than on the answer model's name.
  it("records the model that classified", async () => {
    const result = await classifyAskIntent(modelReturning("question").model, "How is the trip looking?");
    expect(result.model).toBe("test/classifier");
    // The rule short-circuits before any model exists to name.
    expect((await classifyAskIntent(modelReturning("question").model, "yes")).model).toBeNull();
  });

  // The load-bearing rule, in the three shapes it can arrive in.
  describe("fails open to the full tool set", () => {
    // **KI-88, the observed one.** 2026-08-29, live preview, `ai-live` on,
    // `deepseek/deepseek-v4-flash-0731`: "What day risks being too draining or
    // complicated?" classified `write` with `verdict: ""` because the model
    // spent its whole 8-token budget reasoning and emitted no text. Step 1
    // then cost 4,906 tokens — the full 15-tool payload, the entire saving
    // gone. Structured output does not make this impossible (a budget can
    // still run out), it makes it a MISS rather than a misread: the field is
    // never populated, so the turn fails open loudly instead of the SDK
    // handing us an empty string to guess at.
    it("when the output budget ran out before the model filled the field in", async () => {
      const { model } = modelSaying("", "length");
      const result = await classifyAskIntent(model, "What day risks being too draining or complicated?");
      expect(result).toMatchObject({ intent: "write", failedOpen: true });
      // And it must not report the call as free. KI-88 read as costless for
      // hours precisely because the fail-open branch threw the usage away.
      expect(result.usage.inputTokens).toBe(151);
    });

    it("when the model answers in prose instead of the schema", async () => {
      const result = await classifyAskIntent(modelSaying("It depends on what you mean.").model, "hmm");
      expect(result.intent).toBe("write");
      expect(result.failedOpen).toBe(true);
      // The text itself survives the throw — it is the whole diagnosis of a
      // model whose output style this classifier cannot use.
      expect(result.verdict).toContain("It depends on what you mean.");
    });

    // Valid JSON, wrong value. The schema is what rejects it now; nothing
    // downstream normalises or guesses.
    it("when the model returns a value the schema does not allow", async () => {
      const result = await classifyAskIntent(modelSaying('{"result":"maybe"}').model, "hmm");
      expect(result).toMatchObject({ intent: "write", failedOpen: true });
      expect(result.verdict).toContain("maybe");
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
        classifyAskIntent(modelReturning("question").model, "How is the trip looking?", [], controller.signal),
      ).resolves.toMatchObject({ intent: "write", failedOpen: true });
    });
  });

  // The whole point of the call: ~85% of a step's fixed input cost is tool
  // schemas, so a classification that carried them would buy nothing. Asserted
  // on what the model was actually handed, not on the call site.
  it("sends no tools and one short instruction", async () => {
    const { model, seen } = modelReturning("question");
    await classifyAskIntent(model, "How is the trip looking?");

    expect(seen).toHaveLength(1);
    const call = seen[0]!;
    expect(call.tools ?? []).toEqual([]);
    const system = (call.prompt ?? []).filter((m) => m.role === "system").map((m) => String(m.content));
    // The instruction is re-sent on every turn; a ceiling on it is a ceiling
    // on the saving. 600 characters is roughly 150 tokens — the budget the
    // measurement in askIntent.ts assumes.
    expect(system.join("\n").length).toBeLessThan(600);
  });

  // The Fix that closed KI-88, asserted on what the PROVIDER is handed rather
  // than on our call site: the two words are a constraint the model is given,
  // not a string we hope it echoes.
  it("constrains the answer to the two verdicts with a response schema", async () => {
    const { model, seen } = modelReturning("question");
    await classifyAskIntent(model, "How is the trip looking?");

    const format = seen[0]!.responseFormat;
    expect(format?.type).toBe("json");
    expect(JSON.stringify(format?.schema)).toContain('"enum":["question","write"]');
  });

  // The budget has to hold a reasoning preamble AND the answer — an 8-token
  // ceiling is what KI-88 actually was. It is still a ceiling, because an
  // unbounded output on an operator-configured model is a cost hole.
  it("budgets enough output for a model that reasons before it answers", async () => {
    const { model, seen } = modelReturning("question");
    await classifyAskIntent(model, "How is the trip looking?");
    expect(seen[0]!.maxOutputTokens).toBeGreaterThan(64);
    expect(seen[0]!.maxOutputTokens).toBeLessThanOrEqual(1024);
  });

  it("records the classification's own cost and latency", async () => {
    const { model } = modelReturning("question");
    const result = await classifyAskIntent(model, "How is the trip looking?", [], undefined, stepClock());
    expect(result.usage).toEqual({ inputTokens: 151, outputTokens: 1, totalTokens: 152 });
    expect(result.latencyMs).toBe(10);
  });

  // ---------------------------------------------------------------------
  // The turn that writes is often the one that says least
  // ---------------------------------------------------------------------

  // Mitchell's live thread, 2026-08-29, verbatim. The first message read the
  // trip and proposed nothing; "Yes go ahead" made ten write calls. Classified
  // in isolation it is a question — reasonably — and the assistant would have
  // had no tool to act with on the one turn that mattered.
  const MITCHELL_REQUEST =
    "Lets fit the day trip into that day, feel free to remove any conflicting events, we can leave in the morning, hit up the temple and eat lunch in nara after seeing the deer park, and be back in kyoto that night";
  const MITCHELL_ASSISTANT =
    "I've drafted 8 changes for day 3 — removing the two afternoon stops that clash and adding the Nara temple, the deer park and lunch. Nothing is applied yet.";

  describe("a bare agreement", () => {
    it("keeps the write tools for “Yes go ahead”, without calling a model at all", async () => {
      const { model, seen } = modelReturning("question");
      const result = await classifyAskIntent(model, "Yes go ahead", [
        { role: "user", text: MITCHELL_REQUEST },
        { role: "assistant", text: MITCHELL_ASSISTANT },
      ]);

      expect(result).toMatchObject({ intent: "write", source: "affirmation", failedOpen: false });
      // The rule is the point: a model that confidently answered "question"
      // to three bare words would have been believed.
      expect(seen).toHaveLength(0);
    });

    it("recognises the short agreements people actually type", () => {
      for (const agreement of ["yes", "Yes.", "yep", "ok", "Okay!", "sure", "do it", "go ahead", "yes please", "sounds good", "perfect, go ahead", "Yes, apply them"]) {
        expect(isBareAgreement(agreement)).toBe(true);
      }
    });

    // The rule has to stop where a real instruction starts, or it stops being
    // a rule about agreement and becomes a second classifier.
    it("leaves anything longer than an agreement to the model", () => {
      for (const message of [
        "yes, but move the temple to day 4 first",
        "which day has the most free time?",
        MITCHELL_REQUEST,
        "",
      ]) {
        expect(isBareAgreement(message)).toBe(false);
      }
    });
  });

  describe("conversational context", () => {
    it("shows the classifier the two messages before this one", async () => {
      const { model, seen } = modelReturning("write");
      await classifyAskIntent(model, "and the same for day 4?", [
        { role: "user", text: MITCHELL_REQUEST },
        { role: "assistant", text: MITCHELL_ASSISTANT },
      ]);

      const user = (seen[0]!.prompt ?? []).filter((m) => m.role === "user");
      const text = JSON.stringify(user);
      expect(text).toContain("Lets fit the day trip into that day");
      expect(text).toContain("I've drafted 8 changes for day 3");
      expect(text).toContain("and the same for day 4?");
      // Still no tools. That is where the ~3,400 tokens live, and context is
      // prose — the whole reason this stayed affordable.
      expect(seen[0]!.tools ?? []).toEqual([]);
    });

    it("truncates a long prior message rather than re-spending the saving", async () => {
      const { model, seen } = modelReturning("write");
      await classifyAskIntent(model, "and day 4?", [{ role: "assistant", text: "x".repeat(5000) }]);
      const prompt = JSON.stringify(seen[0]!.prompt);
      expect(prompt).toContain("…");
      // 300 characters a message, so a paragraph-long answer cannot cost more
      // than about 75 tokens of the ~150-token call.
      const longestRun = Math.max(...prompt.match(/x+/g)!.map((run) => run.length));
      expect(longestRun).toBe(300);
    });

    it("records the input it classified, so a bad verdict is separable from a bad input", async () => {
      const withContext = await classifyAskIntent(modelReturning("write").model, "and day 4?", [
        { role: "assistant", text: MITCHELL_ASSISTANT },
      ]);
      expect(withContext.context).toContain("I've drafted 8 changes");
      expect(withContext.source).toBe("model");

      const opening = await classifyAskIntent(modelReturning("question").model, "how does this look?");
      expect(opening.context).toBeNull();
    });
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
