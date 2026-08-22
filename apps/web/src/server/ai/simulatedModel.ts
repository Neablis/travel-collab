// The "AI is switched off" model (see docs/specs/2026-08-19-feature-flags-and-
// ai-kill-switch-design.md). It is a real LanguageModelV4 that contacts
// nothing: generateText calls doGenerate, gets canned tool calls back, and the
// rest of handleAiRequest proceeds exactly as it would for a real model —
// resolveBatch, the atomic batch, the event append, the projection. The trip
// really changes. That is the point: a shared deployment stays exercisable at
// zero token cost.
//
// Hand-rolled rather than `MockLanguageModelV4` from `ai/test`, so no test
// utility ships in the server bundle. Typed as `LanguageModel` (from `ai`, a
// direct dependency) rather than `LanguageModelV4` (from `@ai-sdk/provider`,
// which is not) — structural typing checks the literal either way.
import { randomUUID } from "node:crypto";
import type { LanguageModel } from "ai";
import type { AiSurface } from "@/server/ai/context";

export const SIMULATED_MODEL_ID = "simulated/no-op";

// Zero, honestly: nothing was spent. Shape matches AI SDK v7's
// LanguageModelV4Usage (nested objects, not v4's flat promptTokens pair).
const NO_USAGE = {
  inputTokens: { total: 0, noCache: 0, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 0, text: undefined, reasoning: undefined },
};

type ToolCall = { type: "tool-call"; toolCallId: string; toolName: string; input: string };

// `input` is a JSON STRING, not an object — LanguageModelV4ToolCall's contract.
function call(toolName: string, input: Record<string, unknown>): ToolCall {
  return { type: "tool-call", toolCallId: randomUUID(), toolName, input: JSON.stringify(input) };
}

// Deterministic on purpose: e2e asserts this exact content, and a reviewer
// should be able to recognize a simulated trip on sight.
//
// AddDay takes no arguments at all — planningTools drops `type` and `tripId`,
// and `dayId` is a `mint` field the server generates. AddActivity keeps
// `title` and swaps `dayId` for the human `dayRef` ("day N", 1-based over the
// days THIS batch creates).
//
// No `location` and no `cost`, and that is load-bearing rather than lazy:
// enrichCommandLocations no-ops when there is nothing to look up, so the
// simulated path cannot reach LocationIQ. That is how "the kill switch covers
// the LLM only" stays honest without a second branch — enforced by the
// empty-locationReport assertion in route.int.test.ts.
function planCalls(): ToolCall[] {
  return [
    call("AddDay", {}),
    call("AddDay", {}),
    call("AddActivity", { title: "Sample: morning walk", dayRef: "day 1" }),
    call("AddActivity", { title: "Sample: long lunch", dayRef: "day 1" }),
    call("AddActivity", { title: "Sample: museum in the afternoon", dayRef: "day 2" }),
  ];
}

// Headings and paragraphs only — no macro blocks, so this stays decoupled from
// the @tc/pages macro registry and passes validateComposedPage unconditionally.
function pageCalls(): ToolCall[] {
  return [
    call("compose_page", {
      title: "Sample page",
      blocks: [
        { type: "heading", level: 2, text: "This page is simulated" },
        {
          type: "paragraph",
          text: "AI is switched off on this deployment, so this page was composed by the server rather than by a model. Everything else about it is real — it saves, versions, and edits like any other page.",
        },
      ],
    }),
  ];
}

export function simulatedModel(surface: AiSurface): LanguageModel {
  // One step's worth of calls, then silence. The AI SDK loops doGenerate until
  // `stopWhen` fires (32 steps for board/combined), and re-emitting on every
  // call would apply the same plan once per remaining step — the failure
  // `modelThatNeverStops` documents in route.int.test.ts.
  let spent = false;

  return {
    specificationVersion: "v4",
    provider: "simulated",
    modelId: SIMULATED_MODEL_ID,
    supportedUrls: {},
    async doGenerate() {
      if (spent) {
        return { content: [], finishReason: { unified: "stop", raw: undefined }, usage: NO_USAGE, warnings: [] };
      }
      spent = true;
      return {
        content: surface === "page" ? pageCalls() : planCalls(),
        finishReason: { unified: "tool-calls", raw: undefined },
        usage: NO_USAGE,
        warnings: [],
      };
    },
    async doStream() {
      // handleAiRequest only ever calls generateText, never streamText. Throwing
      // is better than a fake stream: if streaming is added later, this fails
      // loudly at the seam instead of silently serving canned data forever.
      throw new Error("simulatedModel does not stream — handleAiRequest uses generateText only");
    },
  };
}
