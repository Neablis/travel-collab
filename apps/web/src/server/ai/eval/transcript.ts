// **Recorded model transcripts, replayed in CI without a live call** — M9's
// exit-gate box, and what closes KI-11.
//
// **The gap this is for, in KI-11's own words:** the AI suite was green through
// *seven* consecutive real-world failures between 2026-07-21 and 07-26 — an
// envelope missing ids so the model emitted zero tool calls, three separate
// verbatim-UUID and format classes, a no-op sub-command aborting a whole batch,
// same-batch day refs resolving against pre-batch state, an append-only
// projection missing removals, and a `MAX_STEPS` truncation. Every one was
// found by a person prompting the deployed build.
//
// The entry is precise about why, and it is worth quoting because it rules out
// the obvious fix:
//
// > *"`MockLanguageModelV4` is a scripted `doGenerate` — by construction it
// > emits well-formed tool calls, emits them exactly when told, and stops when
// > told. Real models do none of these reliably… A mock validates OUR code path
// > given well-formed input; it cannot generate the malformed input that has
// > caused every actual bug. This is a structural limit, not a missing
// > assertion — no amount of additional mocked tests closes it."*
//
// **So a transcript is not a mock, and the difference is where the bytes come
// from.** A mock is written to make a test pass. A transcript is a RECORDING of
// what a provider actually put on the wire — including a mangled tool input, a
// verbatim UUID, a turn that ran past its step budget, or a turn that read four
// tools and emitted nothing. Replaying one drives the whole shipped path
// (admission, the tool schemas, `resolveBatch`, `buildProposal`, the fences)
// against input our own code could never have produced.
//
// **What is honest about the ones in `transcripts/` today.** Every transcript
// declares its `source`. A `synthetic` one is hand-written FROM A RECORDED
// INCIDENT — the seven above are documented, and each of those transcripts
// reproduces the provider behaviour that incident recorded. That is worth
// having and it is NOT the same thing as a recording: a synthetic transcript
// can only contain a failure somebody already knew about. A `recorded` one
// comes from `recordAskTranscript` below, wrapped around a live gateway model,
// and can contain one nobody did.
//
// **This lane is therefore evidence about the code around the model. It is not
// the gate's other box** — *"at least one exit criterion is a real, non-mocked
// model call"* — and nothing here may be presented as one.
//
// ## Recording a real one
//
// There is no script, because a script would be untested scaffolding that needs
// a key, a trip and a signed-in actor to run at all. The three lines are:
//
// ```ts
// const { model, transcript } = recordAskTranscript(realGatewayModel, meta);
// await handleAskRequest(request, tripId, model);
// writeFileSync("…/transcripts/<name>.json", JSON.stringify(transcript(), null, 2));
// ```
//
// Then add the shape assertions the run itself justifies, and commit both.
import type { LanguageModel } from "ai";
import { modelIdOf } from "@/server/assistant/admission";
import type { AskScope } from "@/server/assistant/context";
import { askIntentVerdictText, isAskIntentCall } from "@/server/ai/askIntent";

/**
 * One content part, exactly as a provider emits it.
 *
 * `input` on a tool call is a JSON **string**, which is
 * `LanguageModelV4ToolCall`'s contract and the reason a transcript can carry
 * malformed arguments at all: a typed object could not hold `{"dayRef": }`.
 * That is the whole point — `repairToolInput` and `resolveBatch` are what this
 * lane exercises, and neither is reachable from well-formed input.
 */
export type TranscriptPart =
  | { type: "text"; text: string }
  | { type: "tool-call"; toolCallId: string; toolName: string; input: string };

/** One model round-trip, as it came back. */
export interface TranscriptStep {
  content: TranscriptPart[];
  finishReason: "stop" | "tool-calls" | "length";
  usage?: { inputTokens: number; outputTokens: number };
}

/**
 * Where a transcript came from. Declared rather than inferred, because the two
 * kinds are worth exactly different amounts and a reader must not have to
 * guess.
 */
export type TranscriptSource =
  | { kind: "recorded"; model: string; recordedAt: string }
  /** Hand-written from a recorded incident. `from` names the incident. */
  | { kind: "synthetic"; from: string };

/**
 * What a replay is expected to produce — **about SHAPE, never about prose**.
 *
 * A model's words are not reproducible and asserting them would make this lane
 * fail on a re-record for no reason. What is reproducible is what the code
 * around the model did with them: how many round-trips, which tools ran, how
 * many calls the resolver dropped, and whether a reviewable proposal came out.
 */
export interface TranscriptExpectation {
  steps: number;
  /** Tool names, in call order. */
  toolCalls: string[];
  /** How many write calls `resolveBatch` refused. */
  droppedCalls?: number;
  /** How many changes the proposal carries, or 0 for no proposal at all. */
  proposalChanges?: number;
  /** Whether the turn produced any assistant text. */
  answered?: boolean;
  /**
   * How the turn ENDED, defaulting to `completed`.
   *
   * Part of the recording rather than an assumption about it. A provider that
   * emits unparseable tool arguments produces a turn that dies — the SDK throws
   * `AI_InvalidToolInputError` and the run aborts — and a harness that expected
   * every replay to end cleanly would be asserting the absence of exactly the
   * failures it exists to hold.
   */
  outcome?: "completed" | "error" | "abort";
  /**
   * The `Location.name` on each proposal command that has one, in order.
   *
   * **This is the one assertion that can tell grounding from a prompt.** A
   * citation is an index into the turn's own search results, resolved
   * server-side — so the name that commits is the vendor's, not the model's.
   * Asserting it here means a build that stopped resolving `placeRef` fails
   * with a stop whose location is whatever the model typed, rather than passing
   * because the proposal still had the right number of changes in it.
   */
  locationNames?: string[];
}

export interface AskTranscript {
  name: string;
  /** What the incident was, in one line — this is the reason the file exists. */
  about: string;
  source: TranscriptSource;
  question: string;
  scope: AskScope;
  /**
   * The classifier's own answer, replayed too.
   *
   * It is a separate provider call (`askIntent.ts`), so a transcript that did
   * not carry it would have the replay fall back to something — and whatever it
   * fell back to would decide the turn's tool set, which is the thing under
   * test. Recorded as the verdict rather than as a step, because the classifier
   * call is not part of the agent loop.
   */
  classification: { intent: "question" | "edit" | "plan"; certainty: "sure" | "unsure" };
  steps: TranscriptStep[];
  expect: TranscriptExpectation;
}

/** The slice of a provider call a replay reads. Structural, like `simulatedModel`'s. */
interface CallOptionsLike {
  prompt?: { role?: string; content?: unknown }[];
}

const NO_USAGE = {
  inputTokens: { total: 0, noCache: 0, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 0, text: undefined, reasoning: undefined },
};

/**
 * Which step of the transcript this call is — **read off the CONVERSATION, not
 * a counter**.
 *
 * The same rule `simulatedModel.toolResultsOf` follows, for the same reason it
 * gives: the SDK re-calls the model once per step with the accumulated prompt,
 * and a counter on the instance desyncs the moment anything retries. Every
 * assistant message after the last user message is one step already taken.
 */
function stepIndexOf(options: CallOptionsLike): number {
  const prompt = options.prompt ?? [];
  let turnStart = 0;
  for (let i = prompt.length - 1; i >= 0; i--) {
    if (prompt[i]!.role === "user") {
      turnStart = i + 1;
      break;
    }
  }
  return prompt.slice(turnStart).filter((message) => message.role === "assistant").length;
}

/**
 * A transcript as a `LanguageModel`.
 *
 * **Running off the end THROWS, and that is a finding rather than a nuisance.**
 * A transcript records how many round-trips the real turn took; a replay that
 * asks for one more means the code now loops where the recording did not, which
 * is exactly the `MAX_STEPS` truncation class KI-11 lists. A silent "stop here"
 * would turn that into a passing test.
 */
export function replayTranscript(transcript: AskTranscript): LanguageModel {
  const stepFor = (options: CallOptionsLike) => {
    const index = stepIndexOf(options);
    const step = transcript.steps[index];
    if (step === undefined) {
      throw new Error(
        `${transcript.name}: the turn asked for step ${index + 1}, and the transcript records ${transcript.steps.length}.`,
      );
    }
    return step;
  };

  const classify = () => {
    const verdict = askIntentVerdictText(transcript.classification.intent, transcript.classification.certainty);
    return {
      content: [{ type: "text" as const, text: verdict }],
      finishReason: { unified: "stop" as const, raw: undefined },
    };
  };

  const isClassifier = (options: CallOptionsLike) =>
    isAskIntentCall(
      (options.prompt ?? [])
        .filter((m) => m.role === "system" && typeof m.content === "string")
        .map((m) => m.content as string)
        .join("\n"),
    );

  return {
    specificationVersion: "v4",
    provider: "replay",
    modelId: `replay/${transcript.name}`,
    supportedUrls: {},
    async doGenerate(options: CallOptionsLike) {
      const step = isClassifier(options) ? classify() : asStep(stepFor(options));
      return { ...step, usage: NO_USAGE, warnings: [] };
    },
    async doStream(options: CallOptionsLike) {
      const step = isClassifier(options) ? classify() : asStep(stepFor(options));
      return {
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: "stream-start", warnings: [] });
            let id = 0;
            for (const part of step.content) {
              if (part.type !== "text") {
                controller.enqueue(part);
                continue;
              }
              const textId = String(id++);
              controller.enqueue({ type: "text-start", id: textId });
              controller.enqueue({ type: "text-delta", id: textId, delta: part.text });
              controller.enqueue({ type: "text-end", id: textId });
            }
            controller.enqueue({ type: "finish", finishReason: step.finishReason, usage: NO_USAGE });
            controller.close();
          },
        }),
      };
    },
  } as unknown as LanguageModel;
}

/** A recorded step in the shape the SDK's own parts take. */
function asStep(step: TranscriptStep) {
  return {
    content: step.content,
    finishReason: { unified: step.finishReason, raw: undefined },
  };
}

/**
 * Wrap a real model and keep what it returns — how a `recorded` transcript is
 * made.
 *
 * Deliberately a wrapper rather than a fork of the gateway: what is recorded
 * has to be what the SHIPPED path received, and a second client would be
 * recording a different call. `transcript()` is a thunk because the steps
 * arrive across the run.
 *
 * It records `doGenerate` only, and that is a stated limit rather than an
 * oversight: the agent loop streams, and reassembling a stream's parts into
 * content here would be this module re-implementing the SDK's own accumulator.
 * A recording run should drive the handler with `generateText`-shaped calls, or
 * this needs the accumulator writing properly — which is a task, not a line.
 */
export function recordAskTranscript(
  inner: LanguageModel,
  meta: Pick<AskTranscript, "name" | "about" | "question" | "scope">,
): { model: LanguageModel; transcript: () => Partial<AskTranscript> } {
  const steps: TranscriptStep[] = [];
  // **Delegated through the prototype, never spread** (CodeRabbit, PR #184).
  //
  // Object spread copies own enumerable properties only, and a provider's model
  // is a class instance: `provider`, `specificationVersion` and `supportedUrls`
  // live on the prototype or as accessors, so a spread wrapper reaches the SDK
  // without them. `LanguageModel` also admits a bare model-id STRING, which
  // spreads into character keys and leaves `doGenerate` undefined.
  //
  // This function is the only path to a `recorded` transcript — the one word
  // standing between the harness and M9's gate box — so the first real
  // recording run is exactly where a broken wrapper would surface. Refusing the
  // string form loudly beats discovering it mid-run.
  if (typeof inner === "string") {
    throw new Error("recordAskTranscript needs a model instance, not a model id.");
  }
  const underlying = inner as unknown as { doGenerate: (o: unknown) => Promise<unknown>; doStream: (o: unknown) => Promise<unknown> };
  const model = Object.assign(Object.create(inner as object), {
    async doGenerate(options: unknown) {
      const result = (await underlying.doGenerate(options)) as {
        content: TranscriptPart[];
        finishReason: { unified: TranscriptStep["finishReason"] };
      };
      steps.push({ content: result.content, finishReason: result.finishReason.unified });
      return result;
    },
    doStream: (options: unknown) => underlying.doStream(options),
  }) as unknown as LanguageModel;

  return {
    model,
    transcript: () => ({
      ...meta,
      source: { kind: "recorded", model: modelIdOf(inner), recordedAt: new Date().toISOString() },
      steps,
    }),
  };
}
