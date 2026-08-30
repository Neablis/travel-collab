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

/**
 * How a turn ended, as a fact about the TURN rather than about the model.
 *
 * `finishReason` cannot answer this: it carries the model's own word ("stop",
 * "tool-calls", "length") on a completed turn and our own word on an abandoned
 * one, so counting failures out of it means knowing which of its values are
 * ours. And the two abandonments are not the same event — a user navigating
 * away is not a failure, and reading `abort` as one inflates every error rate
 * anyone computes from these lines.
 */
export type AskOutcome = "completed" | "error" | "abort";

/**
 * WHY a turn failed. Null on every outcome but `error`.
 *
 * This exists because a live turn failed on 2026-08-29 and nothing anywhere
 * recorded the cause: `onError` returned the message to the client and the
 * record said only `finishReason: "error"`. Vercel's logs held nothing at
 * error, warning or fatal level, so the whole diagnosis was "step 1 finished,
 * step 2 did not".
 *
 * Every field here is derived from an EXTERNAL string (a provider's error) and
 * is treated as such: bounded, and stripped of control characters — see
 * `sanitizeForLog`.
 */
export interface AskFailureCause {
  /**
   * The error's own `name` — `AI_APICallError`, `AI_RetryError`, `TypeError`,
   * `TimeoutError`. The fastest discriminator between a provider refusing us
   * and a bug of ours, and the one field that is usually a short enum-like
   * token rather than prose.
   */
  name: string;
  /** The provider's own text. Sanitized and truncated. */
  message: string;
  /**
   * The HTTP status when the failure was an API call, else null. 429 and 5xx
   * are the two this is here to tell apart — a rate limit and an outage read
   * identically in a message and demand opposite responses.
   */
  statusCode: number | null;
}

/**
 * The pre-turn intent classification (see `askIntent.ts`), or null when no
 * classification ran — a viewer's turn, which has no write tools to withhold.
 *
 * Recorded so a misclassification is diagnosable after the fact: the record
 * already carries `question`, so the verdict beside it is the whole evidence
 * needed to tell a good classification from a bad one, and `offeredTools`
 * shows what the verdict actually cost or saved.
 *
 * `source` and `context` are the other half of that: a bad verdict and a bad
 * INPUT look identical from the verdict alone, and after 2026-08-29 the
 * classifier no longer sees only the latest message. A reader has to be able
 * to tell which of the three inputs produced the answer.
 */
export interface AskIntentRecord {
  /** What the turn was classified as. `write` is also what every uncertainty resolves to. */
  intent: "question" | "write";
  /**
   * What decided it. `affirmation` is the rule that never called a model at
   * all ("Yes go ahead"); `model` is the classification call.
   */
  source: "affirmation" | "model";
  /**
   * The classifier's entire prompt, exactly as it was fed in — the earlier
   * messages AND `question` again, already truncated by `askIntent.ts`. Null
   * when the turn opened the thread (the prompt was then just `question`), or
   * when the affirmation rule answered without a call.
   *
   * `question` is therefore repeated inside this field. Deliberate: the value
   * of the field is being the model's own input rather than a reconstruction
   * of it, and a reader stitching two fields back together at read time can
   * be wrong about ordering, truncation and framing.
   *
   * The same deliberate call as `question`'s (see its comment), extended to
   * the two messages before it: user-authored content in a retained log,
   * because tuning this is otherwise guesswork. It carries an assistant
   * message too, which `question` does not.
   */
  context: string | null;
  /**
   * Which model produced the verdict. Null for `affirmation`, which called
   * none.
   *
   * Beside `AskRecord.model` and NOT the same field: `AI_CLASSIFIER_MODEL` can
   * point the classifier at a different, cheaper model than the one answering
   * (modelSelection.ts). Without this, a record from a deployment that has set
   * it names the answer model and silently attributes a classifier's cost,
   * latency and verdict to it — which is the exact measurement the separate
   * var exists to let anyone make.
   */
  model: string | null;
  /**
   * What the classifier actually returned — the raw structured verdict
   * (`{"result":"question"}`), sanitized and truncated, or the failure's
   * description when `failedOpen` is true. Kept verbatim rather than folded
   * into `intent` because "the model returned a verdict the schema rejected"
   * and "the model answered `write`" are different problems.
   */
  verdict: string;
  /** True when the call threw, timed out, was aborted, or never filled in the structured verdict, and the full tool set was handed over regardless. */
  failedOpen: boolean;
  latencyMs: number;
  usage: AskUsage;
}

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
  /** What decided `offeredTools`' write half, and what that decision cost. Null when nothing was classified. */
  classification: AskIntentRecord | null;
  /** False when the run produced no assistant text — a turn that spent steps and said nothing. */
  answered: boolean;
  /** How the turn ended. Count error rates from THIS, not from `finishReason`. */
  outcome: AskOutcome;
  /** Why it failed, when it did. Null otherwise — an abort is not a failure. */
  cause: AskFailureCause | null;
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

// Bounded against `MAX_PROMPT_CHARS` (4000, the wire cap on a prompt), not
// picked independently of it. 1000 rather than either extreme: a realistic
// ask ("plan a 7 day trip to Kyoto with meals and something near each stop,
// keep mornings free") lands well under 500, so 1000 captures essentially
// every real prompt whole — including the long, complex ones whose tool-call
// behaviour is the whole reason this field exists — while still bounding one
// log line to about a quarter of the worst case. Going straight to 4000 would
// let a single record dominate the log view for no tuning benefit (Mitchell,
// 2026-08-29). Revisit this number by re-checking those two things — the
// wire cap it's bounded against, and what a realistic ask actually costs —
// not by guessing a new one.
const MAX_LOGGED_QUESTION_CHARS = 1000;

function truncateForLog(text: string): string {
  return text.length > MAX_LOGGED_QUESTION_CHARS ? `${text.slice(0, MAX_LOGGED_QUESTION_CHARS)}…` : text;
}

// A provider's error text is an external string, and it goes into the same
// retained log everything else here does. Two things follow:
//
//   * **Bound it.** A failing gateway answers with an HTML error page, not a
//     sentence; 500 characters is enough to name the failure and not enough
//     for one bad turn to own the log view. The same reasoning (and roughly
//     half the size) as `MAX_LOGGED_QUESTION_CHARS`, which a real question is
//     measured against — an error message has no comparable "realistic" size,
//     so this is bounded by what a reader can use rather than by what a
//     provider might send.
//   * **Strip control characters.** `JSON.stringify` escapes them today, so
//     nothing can forge a second log line through this field — but that is a
//     property of the CURRENT sink, and the guarantee belongs to the string,
//     not to whoever writes it next. C0 and C1 both, because U+0085 is a
//     line break to several log platforms' parsers and U+0000 truncates a
//     line outright in others.
export const MAX_LOGGED_CAUSE_CHARS = 500;

export function sanitizeForLog(text: string, max = MAX_LOGGED_CAUSE_CHARS): string {
  const flattened = text.replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ").trim();
  return flattened.length > max ? `${flattened.slice(0, max)}…` : flattened;
}

/**
 * What went wrong, from whatever the SDK threw.
 *
 * **Total by construction**, because of where it is called from: `abandon` is
 * reached from the stream's `onError` AND from a raw `request.signal` abort
 * listener that nothing wraps (see `logAskAnalytics`'s comment). The `unknown`
 * it is handed is provider-shaped — it can be a `Proxy` whose getters throw, a
 * null-prototype object with no `toString`, or a `bigint` — so every read is
 * inside the try, not just the obvious ones.
 */
export function describeFailure(err: unknown): AskFailureCause {
  try {
    const e = err as { name?: unknown; message?: unknown; statusCode?: unknown; status?: unknown };
    // `statusCode` is what `AI_APICallError` carries; `status` is what a bare
    // `Response`-shaped rejection carries. Both, because the whole value of
    // this field is telling a 429 from a 500 without reading prose.
    const statusCode =
      typeof e?.statusCode === "number" ? e.statusCode : typeof e?.status === "number" ? e.status : null;
    return {
      name: sanitizeForLog(typeof e?.name === "string" ? e.name : typeof err, 100),
      message: sanitizeForLog(typeof e?.message === "string" ? e.message : String(err)),
      statusCode,
    };
  } catch {
    return { name: "unknown", message: "the failure could not be described", statusCode: null };
  }
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
//
// `record.toolCalls[].input` is MODEL-supplied, and `JSON.stringify` throws
// on a circular structure (and drops a `bigint` with a `TypeError`, not
// silently). `createAskRecorder`'s own comment promises this whole path is
// "deliberately total and non-throwing" — a promise this sink has to keep
// itself, not inherit from its caller. Two call sites reach it directly, and
// only one is safety-netted: `handleAskRequest.ts`'s normal end-of-turn path
// runs through the AI SDK's own callback dispatch, which swallows a thrown
// callback silently — no log line, no error, nothing — but `abandon("abort")`
// is wired straight to `request.signal`'s `addEventListener`, a raw listener
// nothing in this codebase wraps. A throw there is an unhandled exception on
// a request's abort path. So: never throw, and never lose the line entirely —
// a fallback that names the tripId, the event and the failure is a debuggable
// log, where a silent drop or an uncaught throw is not.
//
// A FAILED turn is additionally written at error level, and that is a
// discoverability decision rather than a second copy for its own sake. The
// cause belongs on the record — beside the question, the tool trace and the
// per-step usage, which is what makes it diagnosable at all — but the record
// is `console.info`, and on 2026-08-29 the search that found nothing was a
// search of Vercel's error, warning and fatal levels. Whoever triages the next
// failure will filter the same way. So: the diagnosis on the record, and a
// short line at the level people actually look at, naming the cause and
// pointing back at the turn.
export const logAskAnalytics: AskAnalyticsSink = (record) => {
  if (record.outcome === "error") {
    try {
      // Only server-controlled fields plus `cause`, which `describeFailure`
      // has already bounded and stripped — small enough that this line cannot
      // itself become the thing that buries the log.
      console.error(
        "ai.ask.failed",
        JSON.stringify({
          event: "ai.ask.failed",
          tripId: record.tripId,
          userId: record.userId,
          model: record.model,
          steps: record.steps,
          cause: record.cause,
        }),
      );
    } catch {
      // Same contract as below: this path must not throw. The info line still
      // carries the cause, so losing this one loses discoverability, not
      // information.
    }
  }
  try {
    console.info("ai.ask", JSON.stringify(record));
  } catch (err) {
    // Deliberately minimal — anything derived from `record` itself (a tool's
    // input, again) risks the same failure. `tripId`/`userId`/`scope` are
    // server-controlled strings and a JSON literal, never model output, so
    // this line is safe by construction rather than by another try/catch.
    try {
      console.info(
        "ai.ask",
        JSON.stringify({
          event: "ai.ask",
          tripId: record.tripId,
          userId: record.userId,
          error: `record failed to serialize: ${err instanceof Error ? err.message : String(err)}`,
        }),
      );
    } catch {
      // The fallback's own JSON.stringify call has nothing left in it that
      // could throw — this exists only so "never throw" is true by
      // construction, not by an argument about what the fallback contains.
    }
  }
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
  /** The pre-turn classification that decided the write half of `offeredTools`, or null when none ran. */
  classification?: AskIntentRecord | null;
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
   * was accumulated before the run stopped, under the given outcome.
   *
   * The two turns most worth measuring are the failed one and the abandoned
   * one — a turn nobody waited for and a turn that broke are exactly the
   * turns you want a tool-call trace of. Neither reaches `onEnd`, so without
   * this they wrote nothing at all, and `answered: false` had no production
   * trigger.
   *
   * `error` takes a `cause` — whatever was thrown. It is optional in the type
   * only because `abort` has none; a caller with an error in hand and nothing
   * to pass is the bug this parameter exists to prevent. Whatever is passed is
   * run through `describeFailure`, which is total.
   *
   * First writer wins: an errored run fires `onError` before `onEnd`, so the
   * record carries "error" rather than the tidier reason that follows it.
   */
  abandon(outcome: "abort" | "error", cause?: unknown): void;
}

/**
 * Accumulates one turn's record across the agent's step callbacks and writes it
 * once at the end.
 *
 * Deliberately total and non-throwing: this is telemetry hanging off a
 * streaming response that has already started reaching the user, so a malformed
 * step must never become the reason an answer stops mid-sentence.
 *
 * The accumulation itself (`observeStep`/`write`) is non-throwing by
 * construction — it only ever reads and reshapes what a step handed it, never
 * calls anything that can fail. The guarantee is only as good as what it
 * calls out to, though: with no `sink` override this ends in
 * `logAskAnalytics`, which is why THAT function is non-throwing too (see its
 * own comment) rather than something this module merely hopes is true of it.
 * An injected `sink` (every test's) is the caller's own responsibility — this
 * promise covers the production path, not a test double that chooses to
 * throw.
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
      write(final, dropped ?? [], "completed", null);
    },
    abandon(outcome, cause) {
      // `describeFailure` is total, so this reads no further than the type
      // says — and `abort` carries no cause because a user leaving is not a
      // failure and must not read as one to anyone counting error rates.
      write({ finishReason: outcome }, [], outcome, outcome === "error" ? describeFailure(cause) : null);
    },
  };

  // One writer, one latch — a run that both errors and ends still logs once.
  function write(
    final: AskStepLike,
    dropped: readonly AskDroppedCall[],
    outcome: AskOutcome,
    cause: AskFailureCause | null,
  ): void {
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
      classification: params.classification ?? null,
      answered: text.trim().length > 0,
      outcome,
      cause,
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
