// Per-ask observability (M16 Wave 3's foundation, and the start of closing
// KI-11).
//
// One record per /ask turn, written to the structured log — not to a table.
// There is no migration in this plan (a migration needs an explicit production
// dispatch, and an undispatched one is schema drift waiting to happen:
// docs/guidelines/environments-and-deploys.md), and the first question these
// records answer — "which tools does the model actually reach for, and which
// does it never touch?" — is answered by reading a week of logs, not by
// querying rows.
//
// The number that matters most is `uncalledTools`, and it is MEASURED, not
// inferred: the offered set is what was handed to the agent, the called set is
// what `onStepEnd` observed, and the difference is arithmetic. ADR-022's rule
// for earning a tool is only enforceable if a tool nobody calls is visible,
// and "the model probably didn't need it" is not evidence.
import type { AskScope } from "@/server/ai/context";

export interface AskToolCallRecord {
  name: string;
  /** What the model asked for, verbatim — a `find_free_time` nobody constrains reads differently from one with `after`. */
  input: unknown;
}

export interface AskAnalyticsRecord {
  event: "ai.ask";
  tripId: string;
  userId: string;
  scope: AskScope;
  /** True when no provider was contacted — the answer came from simulatedModel. */
  simulated: boolean;
  model: string;
  /** Model round-trips. 1 = answered without a tool call. */
  steps: number;
  toolCalls: AskToolCallRecord[];
  /** How many tool calls it took to reach an answer. */
  toolCallCount: number;
  offeredTools: string[];
  /** Offered and never called. Counted, never guessed. */
  uncalledTools: string[];
  /** False when the run produced no assistant text — a turn that spent steps and said nothing. */
  answered: boolean;
  finishReason: string;
  usage: { inputTokens: number | null; outputTokens: number | null; totalTokens: number | null };
  latencyMs: number;
}

export type AskAnalyticsSink = (record: AskAnalyticsRecord) => void;

// `console.info` with a message + one object, matching the shape
// `trip-access.ts` already logs errors in. Vercel captures it as a structured
// log line; nothing else has to exist for these to be queryable.
export const logAskAnalytics: AskAnalyticsSink = (record) => {
  console.info("ai.ask", record);
};

// The step shape this module reads. Structural rather than the SDK's
// `StepResult` generic, for the same reason `AiResultLike` is in
// handleAiRequest.ts: threading a ToolSet generic through a recorder buys
// nothing and makes the tests construct a fake step they cannot write.
export interface AskStepLike {
  toolCalls?: readonly { toolName: string; input: unknown }[];
  text?: string;
  finishReason?: string;
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
}

export interface AskRecorderParams {
  tripId: string;
  userId: string;
  scope: AskScope;
  simulated: boolean;
  model: string;
  offeredTools: readonly string[];
  /** Injected so a test can read the record instead of the console, and so a clock is never read in a pure path. */
  sink?: AskAnalyticsSink;
  now?: () => number;
}

export interface AskRecorder {
  /** Wire to the agent's `onStepEnd`. Safe to call zero times. */
  observeStep(step: AskStepLike): void;
  /** Wire to the agent's `onEnd`. Writes the record. */
  finish(final: AskStepLike): void;
  /**
   * Wire to the agent's `onAbort` and to the stream's `onError`. Writes what
   * was accumulated before the run stopped, under the given finish reason.
   *
   * The two turns most worth measuring are the failed one and the abandoned
   * one — a turn nobody waited for and a turn that broke are exactly the
   * turns you want a tool-call trace of. Neither reaches `onEnd`, so without
   * this they wrote nothing at all, and `answered: false` had no production
   * trigger.
   *
   * First writer wins: an errored run fires `onError` before `onEnd`, so the
   * record carries "error" rather than the tidier reason that follows it.
   */
  abandon(finishReason: "abort" | "error"): void;
}

/**
 * Accumulates one turn's record across the agent's step callbacks and writes it
 * once at the end.
 *
 * Deliberately total and non-throwing: this is telemetry hanging off a
 * streaming response that has already started reaching the user, so a malformed
 * step must never become the reason an answer stops mid-sentence.
 */
export function createAskRecorder(params: AskRecorderParams): AskRecorder {
  const sink = params.sink ?? logAskAnalytics;
  const now = params.now ?? Date.now;
  const startedAt = now();
  const toolCalls: AskToolCallRecord[] = [];
  let steps = 0;
  let text = "";
  let written = false;

  return {
    observeStep(step) {
      steps += 1;
      for (const call of step.toolCalls ?? []) {
        toolCalls.push({ name: call.toolName, input: call.input });
      }
      if (step.text) text += step.text;
    },
    finish(final) {
      write(final);
    },
    abandon(finishReason) {
      write({ finishReason });
    },
  };

  // One writer, one latch — a run that both errors and ends still logs once.
  function write(final: AskStepLike): void {
    if (written) return;
    written = true;
    const called = new Set(toolCalls.map((c) => c.name));
    // `final.text` is the FINAL step's text, which `observeStep` has already
    // seen — read it only when no step was observed at all, so `answered`
    // cannot be decided by counting the same sentence twice.
    if (steps === 0 && final.text) text += final.text;
    sink({
      event: "ai.ask",
      tripId: params.tripId,
      userId: params.userId,
      scope: params.scope,
      simulated: params.simulated,
      model: params.model,
      // `onEnd` fires once after the last step, so the steps this counted are
      // the run's own round-trips; `final` is that run's summary, not an
      // extra step.
      steps,
      toolCalls,
      toolCallCount: toolCalls.length,
      offeredTools: [...params.offeredTools],
      uncalledTools: params.offeredTools.filter((name) => !called.has(name)),
      answered: text.trim().length > 0,
      finishReason: final.finishReason ?? "unknown",
      usage: {
        inputTokens: final.usage?.inputTokens ?? null,
        outputTokens: final.usage?.outputTokens ?? null,
        totalTokens: final.usage?.totalTokens ?? null,
      },
      latencyMs: now() - startedAt,
    });
  }
}
