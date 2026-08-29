// The "AI is switched off" model (see docs/specs/2026-08-19-feature-flags-and-
// ai-kill-switch-design.md). It is a real LanguageModelV4 that contacts
// nothing: generateText calls doGenerate, gets canned tool calls back, and the
// rest of handleAiRequest proceeds exactly as it would for a real model —
// resolveBatch, the atomic batch, the event append, the projection. The trip
// really changes. That is the point: a shared deployment stays exercisable at
// zero token cost.
//
// The `ask` surface (M16, ADR-022) raises the bar, because /ask has no
// server-derived answer to fall back on the way the command endpoint's
// `summarizeBatch` does: whatever this model says IS the answer. So the ask
// branch does not emit a canned sentence. It runs the real agent loop — calls
// the real read tools, waits for their real results, and writes its prose from
// them. A trip with no free time left says so. That is what makes the
// switched-off deployment (which is every Vercel environment today) a working
// sidebar rather than a placeholder.
//
// Hand-rolled rather than `MockLanguageModelV4` from `ai/test`, so no test
// utility ships in the server bundle. Typed as `LanguageModel` (from `ai`, a
// direct dependency) rather than `LanguageModelV4` (from `@ai-sdk/provider`,
// which is not) — structural typing checks the literal either way. The prompt
// and stream-part shapes below are structural for the same reason.
import { randomUUID } from "node:crypto";
import type { LanguageModel } from "ai";
import { parseAskScope, type AiSurface, type AskScope } from "@/server/ai/context";
import type { DayReadout, FreeTimeReadout, ReadToolProblem, TripReadout } from "@/server/ai/readTools";

export const SIMULATED_MODEL_ID = "simulated/no-op";

// Zero, honestly: nothing was spent. Shape matches AI SDK v7's
// LanguageModelV4Usage (nested objects, not v4's flat promptTokens pair).
const NO_USAGE = {
  inputTokens: { total: 0, noCache: 0, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 0, text: undefined, reasoning: undefined },
};

type ToolCall = { type: "tool-call"; toolCallId: string; toolName: string; input: string };
type TextContent = { type: "text"; text: string };
type Content = ToolCall | TextContent;
type FinishReason = { unified: "stop" | "tool-calls"; raw: undefined };

// One step's output. `textDeltas` is the SAME text as the single text part in
// `content`, cut into the chunks `doStream` emits — so the answer arrives
// sentence by sentence while still being one message part. Splitting it into
// several parts instead would leave a client that concatenates them (and every
// client does, somewhere) reading "5 stops.They are:".
interface SimulatedStep {
  content: Content[];
  finishReason: FinishReason;
  textDeltas?: string[];
}

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

// What one message from a model on this surface would contain — mirroring the
// tool sets handleAiRequest actually exposes there (KI-23). `combined` gets the
// planning tools AND the page tools, so simulating it as a board request made
// the switched-off deployment look less capable than the live one: a combined
// ask only ever moved the board. Plan first, then the page, because that is the
// order a model asked for both would sensibly work in — and because everything
// in one message is applied as one batch anyway.
//
// `ask` is absent: it is not one canned message but a two-step conversation
// with the read tools, and it lives in `askTurn` below.
function callsFor(surface: Exclude<AiSurface, "ask">): ToolCall[] {
  switch (surface) {
    case "page":
      return pageCalls();
    case "board":
      return planCalls();
    case "combined":
      return [...planCalls(), ...pageCalls()];
  }
}

// ---------------------------------------------------------------------------
// The ask surface
// ---------------------------------------------------------------------------

// The slice of LanguageModelV4CallOptions this model reads. Everything else
// (tools, temperature, provider options) is genuinely irrelevant to a model
// that contacts nothing.
interface CallOptionsLike {
  prompt?: readonly {
    role?: string;
    content?: unknown;
  }[];
}

interface ToolResultLike {
  toolName: string;
  output: unknown;
}

/**
 * The system instruction, which is where the turn's scope is encoded
 * (`askScopeLine` in context.ts). Joined rather than "first match" because
 * `allowSystemInMessages` can put more than one system message in a prompt.
 */
function systemTextOf(options: CallOptionsLike): string {
  return (options.prompt ?? [])
    .filter((m) => m.role === "system" && typeof m.content === "string")
    .map((m) => m.content as string)
    .join("\n");
}

/**
 * Every tool result already in the prompt — which is how this model knows
 * whether it has asked its questions yet. State lives in the conversation, not
 * in a counter on the instance: streamText re-calls `doStream` per step with
 * the accumulated prompt, so reading it is both simpler and correct across
 * retries.
 */
function toolResultsOf(options: CallOptionsLike): ToolResultLike[] {
  const results: ToolResultLike[] = [];
  for (const message of options.prompt ?? []) {
    if (!Array.isArray(message.content)) continue;
    for (const part of message.content as { type?: string; toolName?: string; output?: unknown }[]) {
      if (part.type !== "tool-result" || typeof part.toolName !== "string") continue;
      results.push({ toolName: part.toolName, output: unwrapToolOutput(part.output) });
    }
  }
  return results;
}

// A tool result's `output` is `{ type: 'json' | 'text', value }`. Both shapes
// are handled because which one appears depends on the tool's `toModelOutput`,
// which is a decision readTools.ts is free to change later.
function unwrapToolOutput(output: unknown): unknown {
  if (typeof output !== "object" || output === null) return output;
  const wrapper = output as { type?: string; value?: unknown };
  if (wrapper.type === "json") return wrapper.value;
  if (wrapper.type === "text" && typeof wrapper.value === "string") {
    try {
      return JSON.parse(wrapper.value);
    } catch {
      return wrapper.value;
    }
  }
  return output;
}

function resultFor<T>(results: readonly ToolResultLike[], toolName: string): T | undefined {
  const found = results.find((r) => r.toolName === toolName);
  return found?.output as T | undefined;
}

// The hours a free-time answer is actually about. Unbounded, the largest gap
// on almost any real day is the one between the last stop and breakfast — a
// true answer nobody asked for. This is the same judgement a real model would
// make from the question, made once and deterministically here, and it is why
// the simulated path exercises `find_free_time`'s after/before translation
// rather than calling it bare.
const WAKING_HOURS = { after: "08:00", before: "22:00" };

/**
 * Step 1 of an ask turn: the questions.
 *
 * `read_trip` always — every answer wants the trip's name and shape.
 * `read_day` only when the turn is scoped to a day, which is the one thing the
 * instruction's scope line exists to tell this model.
 * `find_free_time` always. It defaults to the turn's scope — the whole trip for
 * a trip-scoped turn, that day for a day-scoped one — so no day number is
 * passed; it is the question ADR-022 was written about, so the switched-off
 * deployment should be able to answer it.
 */
function askQuestions(scope: AskScope): ToolCall[] {
  const calls = [call("read_trip", {})];
  if (scope.kind === "day") calls.push(call("read_day", { day: scope.dayIndex + 1 }));
  calls.push(call("find_free_time", { ...WAKING_HOURS }));
  return calls;
}

const SIMULATED_ASK_NOTICE =
  "AI is switched off on this deployment, so I answered from your trip data rather than from a model.";

function pluralStops(n: number): string {
  return `${n} stop${n === 1 ? "" : "s"}`;
}

/**
 * Step 2: the answer, written from what the tools actually returned.
 *
 * Sentence-per-fact, and every fact traceable to one tool result — which is
 * what makes this assertable in an e2e spec and what stops it drifting into a
 * canned paragraph that would survive the tools returning nothing.
 *
 * A day-scoped answer names no day but its own. M16's gate asserts that, and
 * it holds here because the only day numbers in scope are the one `read_day`
 * was asked for and the ones `find_free_time` returned — which, for a
 * day-scoped turn, is the same day.
 */
function askAnswer(scope: AskScope, results: readonly ToolResultLike[]): string[] {
  const trip = resultFor<TripReadout>(results, "read_trip");
  const day = resultFor<DayReadout | ReadToolProblem>(results, "read_day");
  const free = resultFor<FreeTimeReadout | ReadToolProblem>(results, "find_free_time");
  const sentences: string[] = [];

  const dayScoped = scope.kind === "day";

  if (dayScoped && day && !("error" in day)) {
    const dated = day.date ? ` (${day.date})` : "";
    const named = trip ? ` of ${trip.name}` : "";
    sentences.push(`Day ${day.day}${dated}${named} has ${pluralStops(day.stops.length)}.`);
    if (day.stops.length > 0) {
      sentences.push(
        `They are: ${day.stops
          .map((stop) => (stop.timeWindow ? `${stop.title} at ${stop.timeWindow.start}` : `${stop.title} (no set time)`))
          .join("; ")}.`,
      );
    }
  } else if (trip) {
    const started = trip.startDate ? `, starting ${trip.startDate}` : "";
    sentences.push(`${trip.name} runs to ${trip.dayCount} day${trip.dayCount === 1 ? "" : "s"}${started}.`);
    const stops = trip.days.reduce((total, d) => total + d.stopCount, 0);
    sentences.push(`There ${stops === 1 ? "is" : "are"} ${pluralStops(stops)} scheduled across it.`);
  }

  if (free && !("error" in free)) {
    const longest = [...free.gaps].sort((a, b) => b.durationMinutes - a.durationMinutes)[0];
    const window = `between ${free.window.after} and ${free.window.before}`;
    sentences.push(
      longest
        ? `The biggest open stretch ${window} is on day ${longest.day}, ${longest.start} to ${longest.end} — ${longest.durationMinutes} minutes.`
        : `I found no open time on ${free.searched} ${window}.`,
    );
  }

  // Trip-scoped only. The conflict list spans the whole trip, and naming a
  // clash on day 9 inside an answer about day 3 is precisely the wandering
  // M16's gate refuses.
  if (!dayScoped && trip && trip.conflicts.length > 0) {
    sentences.push(
      `${trip.conflicts.length} conflict${trip.conflicts.length === 1 ? "" : "s"} ${trip.conflicts.length === 1 ? "is" : "are"} still open: ${trip.conflicts[0]!.description}`,
    );
  }

  // Never an empty answer. A turn whose tools all failed still says something
  // true, because an assistant that streams nothing is indistinguishable from
  // one that is broken.
  if (sentences.length === 0) sentences.push("I couldn't read anything about this trip.");

  sentences.push(SIMULATED_ASK_NOTICE);
  return sentences;
}

/** One ask step: questions if none have been answered yet, otherwise the answer. */
function askTurn(options: CallOptionsLike): SimulatedStep {
  const results = toolResultsOf(options);
  if (results.length === 0) {
    return {
      content: askQuestions(parseAskScope(systemTextOf(options))),
      finishReason: { unified: "tool-calls", raw: undefined },
    };
  }
  const sentences = askAnswer(parseAskScope(systemTextOf(options)), results);
  return {
    content: [{ type: "text", text: sentences.join(" ") }],
    finishReason: { unified: "stop", raw: undefined },
    textDeltas: sentences.map((sentence, i) => (i === sentences.length - 1 ? sentence : `${sentence} `)),
  };
}

export function simulatedModel(surface: AiSurface): LanguageModel {
  // One step's worth of calls, then silence. The AI SDK loops doGenerate until
  // `stopWhen` fires (32 steps for board/combined), and re-emitting on every
  // call would apply the same plan once per remaining step — the failure
  // `modelThatNeverStops` documents in route.int.test.ts. The ask surface needs
  // no latch: its second step is a text answer, which ends the loop by itself.
  let spent = false;

  const step = (options: CallOptionsLike): SimulatedStep => {
    if (surface === "ask") return askTurn(options);
    if (spent) return { content: [], finishReason: { unified: "stop", raw: undefined } };
    spent = true;
    return { content: callsFor(surface), finishReason: { unified: "tool-calls", raw: undefined } };
  };

  return {
    specificationVersion: "v4",
    provider: "simulated",
    modelId: SIMULATED_MODEL_ID,
    supportedUrls: {},
    async doGenerate(options: CallOptionsLike) {
      const { content, finishReason } = step(options);
      return { content, finishReason, usage: NO_USAGE, warnings: [] };
    },
    async doStream(options: CallOptionsLike) {
      // Only the ask surface streams. handleAiRequest still calls generateText
      // exclusively, so throwing here keeps the loud seam the original comment
      // asked for: if streaming is ever added to the command path, it fails
      // here rather than silently serving canned data.
      if (surface !== "ask") {
        throw new Error(`simulatedModel does not stream the ${surface} surface — handleAiRequest uses generateText`);
      }
      const { content, finishReason, textDeltas } = step(options);
      // Part order mirrors the SDK's own `simulateStreamingMiddleware`:
      // stream-start, then a start/deltas/end run per text part (tool calls
      // pass through whole), then finish.
      return {
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: "stream-start", warnings: [] });
            let id = 0;
            for (const part of content) {
              if (part.type !== "text") {
                controller.enqueue(part);
                continue;
              }
              const textId = String(id++);
              controller.enqueue({ type: "text-start", id: textId });
              for (const delta of textDeltas ?? [part.text]) {
                controller.enqueue({ type: "text-delta", id: textId, delta });
              }
              controller.enqueue({ type: "text-end", id: textId });
            }
            controller.enqueue({ type: "finish", finishReason, usage: NO_USAGE });
            controller.close();
          },
        }),
      };
    },
  };
}
