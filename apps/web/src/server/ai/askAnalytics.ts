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

/** One request's worth of token counts — the shape both the whole-run total and a single step use. */
export interface AskUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
}

/**
 * A write call `resolveBatch` dropped, kept for tuning rather than for the
 * user — the proposal card already renders `AssistantProposal.skipped` as
 * prose (writeTools.ts); this is the same drop in a shape a log line can
 * filter and count.
 *
 * `no-op` is never in here — the same filter `handleAiRequest` applies to its
 * own `resolutionErrors` (the domain correctly declining to do nothing is not
 * a bug), so what's left is exactly the "was this a real drop" question
 * Mitchell asked for.
 */
export interface AskDroppedCall {
  /** The command type the model tried to emit — "MoveActivity", "RemoveActivity", … */
  type: string;
  /** The domain's own rejection code, or a resolver code (`unresolved-ref`, `invalid-command`). Never `no-op`. */
  code: string;
  /** The human ref(s) the model supplied — e.g. `{ activityRef: "Nope" }` — or null for a command that took none. */
  refs: Record<string, unknown> | null;
  /** The resolver's or domain's own explanation, e.g. `No activity named "Nope".` */
  message: string;
}

export interface AskAnalyticsRecord {
  event: "ai.ask";
  tripId: string;
  userId: string;
  scope: AskScope;
  /**
   * The user's own text for this turn, truncated (see `MAX_LOGGED_QUESTION_CHARS`)
   * — not the whole thread, and not the assistant's replies.
   *
   * This is user-authored content going into a retained structured log.
   * That's a deliberate call, made once, for Mitchell's own product on his
   * own explicit request — logging the ask is the only way to tune which
   * tools it needs — not a default any deployment should inherit silently if
   * this module is ever lifted into a different product.
   */
  question: string;
  /**
   * Whether this is the first question in the thread or a later one. A
   * follow-up's tool-call behaviour (what it re-reads, how many steps it
   * takes) is genuinely different from an opening question's, so counting the
   * two as the same turn shape would average away exactly the signal tuning
   * needs.
   */
  turn: "opening" | "follow-up";
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
  /** The whole run's token spend. */
  usage: AskUsage;
  /**
   * The same counts, one entry per step, in step order. `usage` alone hides
   * where the spend comes from — a growing envelope re-sent on every step
   * reads identically to one big first call until it's broken out per step.
   */
  usageByStep: AskUsage[];
  /** Real drops only — see `AskDroppedCall`. Empty on a turn with no write tools, or none dropped. */
  droppedCalls: AskDroppedCall[];
  latencyMs: number;
}

export type AskAnalyticsSink = (record: AskAnalyticsRecord) => void;

// A question long enough to hit this is rare — `MAX_PROMPT_CHARS` already caps
// the wire input at 4000 — but the log's job is tuning at a glance across many
// records, not verbatim reproduction of one: an unclipped 4000-character
// question would drown a page of log lines for the sake of the one turn that
// pasted a whole itinerary in.
const MAX_LOGGED_QUESTION_CHARS = 300;

function truncateForLog(text: string): string {
  return text.length > MAX_LOGGED_QUESTION_CHARS ? `${text.slice(0, MAX_LOGGED_QUESTION_CHARS)}…` : text;
}

// `console.info` with a message + the record, JSON-serialized rather than
// handed to `console.info` as a live object.
//
// `toolCalls` is an array of `{ name, input }`, and `input` is itself an
// object — depth 3 from the top of `record` — so `console.info("ai.ask",
// record)` renders every tool's input as `[Object]`: Node's `util.inspect`
// (what `console.info` formats a non-string argument with) defaults to depth
// 2, and the WHOLE point of this record is seeing what a tool was actually
// asked with (`AskToolCallRecord.input`'s own comment). `JSON.stringify` has
// no depth limit and produces one self-contained line, which is also the
// friendlier shape for a log platform that greps or parses JSON out of a
// line rather than re-running Node's own formatter on it.
export const logAskAnalytics: AskAnalyticsSink = (record) => {
  console.info("ai.ask", JSON.stringify(record));
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
  /** The user's own text for this turn, verbatim — truncated for the log at write time, not here. */
  question: string;
  /** Whether this is the thread's first question or a later one — see `AskAnalyticsRecord.turn`. */
  turn: "opening" | "follow-up";
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
  /**
   * Wire to the agent's `onEnd`. Writes the record.
   *
   * `dropped` is optional because a turn with no write tools (a viewer's) or
   * with nothing dropped has none — the caller computes it once, from
   * `resolveBatch`'s own errors, and hands it in rather than this module
   * reaching into the write-tool machinery itself (see `writeTools.ts`'s
   * `droppedWriteCalls`).
   */
  finish(final: AskStepLike, dropped?: readonly AskDroppedCall[]): void;
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
  const usageByStep: AskUsage[] = [];
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
      // Collected even when the model gave nothing (all-null entry) so this
      // array's length always equals `steps` — a reader can zip it against
      // `toolCalls`' emission order without doing arithmetic first.
      usageByStep.push(usageOf(step));
    },
    finish(final, dropped) {
      write(final, dropped ?? []);
    },
    abandon(finishReason) {
      write({ finishReason }, []);
    },
  };

  // One writer, one latch — a run that both errors and ends still logs once.
  function write(final: AskStepLike, dropped: readonly AskDroppedCall[]): void {
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
      question: truncateForLog(params.question),
      turn: params.turn,
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
      usageByStep,
      droppedCalls: [...dropped],
      latencyMs: now() - startedAt,
    });
  }
}

function usageOf(step: AskStepLike): AskUsage {
  return {
    inputTokens: step.usage?.inputTokens ?? null,
    outputTokens: step.usage?.outputTokens ?? null,
    totalTokens: step.usage?.totalTokens ?? null,
  };
}
