// Sentry AI Agent Monitoring for the assistant: the `gen_ai.*` spans that make
// a turn show up in Sentry's AI Agents view as an agent run with its model
// calls, its tool calls and its token spend, rather than as an opaque
// four-second POST.
//
// **Why this is hand-written instead of `Sentry.vercelAIIntegration()`.** That
// integration exists and would be the obvious answer, and it does not work
// here — for two independent reasons, either of which is enough:
//
//   1. Its instrumentation declares `SUPPORTED_VERSIONS = [">=3.0.0 <7"]`
//      (@sentry/node 10.72, integrations/tracing/vercelai/instrumentation.js).
//      This app is on `ai@7`. The patch never applies.
//   2. `ai@7` moved OpenTelemetry out of the core package entirely (its
//      CHANGELOG: "create new opentelemetry package (@ai-sdk/otel)"), and the
//      spans that package emits follow the OTel GenAI convention — named
//      `invoke_agent {model}`, `chat {model}`, `execute_tool {name}`. Sentry's
//      OTel bridge infers a `sentry.op` from HTTP, DB, RPC, messaging and FaaS
//      attributes and from nothing else (`inferSpanData`,
//      @sentry/opentelemetry 10.72), so those spans arrive with no op — and
//      the AI Agents product keys off `op: "gen_ai.*"`. They would be
//      invisible in the exact product they were emitted for.
//
// So the spans are started against Sentry's own API, where the op is set
// explicitly and cannot be inferred wrong. The attribute names are Sentry's
// own (`tracing/ai/gen-ai-attributes.js`) rather than names picked to look
// right.
//
// **This module never throws.** It is telemetry hanging off a streaming
// response that has already started reaching the user; the same promise
// `askAnalytics.ts` makes, for the same reason, and made the same way — every
// entry point wraps its body, and the fallback is to do nothing. A missing
// span is a missing span. A thrown one would be an answer that stops
// mid-sentence.
import * as Sentry from "@sentry/nextjs";
import type { Span } from "@sentry/nextjs";
import type { AskUsage } from "@/server/ai/askAnalytics";

// Sentry's own constants, spelled out here rather than imported: they live in
// `@sentry/core`'s internal `tracing/ai/gen-ai-attributes` module, which is not
// a public export path, and `@sentry/conventions` publishes them only as
// metadata types. A private path we do not control is a worse dependency than
// a string table we do — and these strings are an OpenTelemetry semantic
// convention, so they are stable in a way an internal module path is not.
const GEN_AI = {
  operationName: "gen_ai.operation.name",
  /** The current convention name for who serves the model. */
  providerName: "gen_ai.provider.name",
  /** The older name for the same thing. Sentry's own instrumentation still writes it, and some views still read it, so both are set. */
  system: "gen_ai.system",
  requestModel: "gen_ai.request.model",
  agentName: "gen_ai.agent.name",
  availableTools: "gen_ai.request.available_tools",
  responseToolCalls: "gen_ai.response.tool_calls",
  finishReasons: "gen_ai.response.finish_reasons",
  usageInputTokens: "gen_ai.usage.input_tokens",
  usageOutputTokens: "gen_ai.usage.output_tokens",
  usageTotalTokens: "gen_ai.usage.total_tokens",
  toolName: "gen_ai.tool.name",
  toolCallId: "gen_ai.tool.call.id",
  toolType: "gen_ai.tool.type",
} as const;

/** Sentry's own attribute for "which integration produced this span". */
const ORIGIN_ATTRIBUTE = "sentry.origin";
const ORIGIN = "manual.ai.travel_collab";

// **No prompt, no answer, no tool payload goes into a span, and the TYPES are
// what say so.**
//
// `askAnalytics.ts` decided, deliberately and once, that a user's question may
// go into OUR structured log — Mitchell's own product, his own request, for
// tuning that is otherwise guesswork. That decision does not transfer to a
// third-party service by default, and this module is not the place to make it
// again quietly.
//
// So the rule is not a `RECORD_CONTENT = false` flag someone flips: the
// parameter types below simply have nowhere to put content. `AgentTraceParams`
// takes tool NAMES, not a prompt; `ToolExecutionRecord` takes a duration and
// an ok/failed, not an input or a result; `AgentSpanAttributes` is
// `string | number | boolean` and every value handed to it at the call sites
// is an enum or a count. Adding content would mean adding a field, in a diff,
// on purpose. `aiTelemetry.test.ts` asserts the attribute key set to keep that
// true.
//
// The other half is `dataCollection.genAI` in the three Sentry configs, which
// stops the SDK's own AI instrumentation recording inputs and outputs. Both
// halves are set explicitly, so neither can be undone by an SDK default flip.

/** The tool count is bounded (15) and the names are ours, so this is a safe attribute. */
function toolListAttribute(names: readonly string[]): string {
  return JSON.stringify(names);
}

/**
 * Split a gateway model id into provider and model.
 *
 * Vercel's AI Gateway addresses models as `provider/model`
 * (`anthropic/claude-haiku-4-5`), and Sentry's AI Agents view groups cost by
 * provider — so leaving the whole string in `gen_ai.request.model` would file
 * every model this app can reach under a provider of "unknown". A bare id with
 * no slash keeps the whole string as the model and reports no provider, which
 * is the honest answer rather than a guessed one.
 */
export function splitModelId(modelId: string): { provider: string | null; model: string } {
  const slash = modelId.indexOf("/");
  if (slash <= 0 || slash === modelId.length - 1) return { provider: null, model: modelId };
  return { provider: modelId.slice(0, slash), model: modelId.slice(slash + 1) };
}

function modelAttributes(modelId: string): Record<string, string> {
  const { provider, model } = splitModelId(modelId);
  const attributes: Record<string, string> = { [GEN_AI.requestModel]: model };
  if (provider !== null) {
    attributes[GEN_AI.providerName] = provider;
    attributes[GEN_AI.system] = provider;
  }
  return attributes;
}

function usageAttributes(usage: AskUsage | undefined): Record<string, number> {
  if (!usage) return {};
  const attributes: Record<string, number> = {};
  if (usage.inputTokens !== null && usage.inputTokens !== undefined) {
    attributes[GEN_AI.usageInputTokens] = usage.inputTokens;
  }
  if (usage.outputTokens !== null && usage.outputTokens !== undefined) {
    attributes[GEN_AI.usageOutputTokens] = usage.outputTokens;
  }
  if (usage.totalTokens !== null && usage.totalTokens !== undefined) {
    attributes[GEN_AI.usageTotalTokens] = usage.totalTokens;
  }
  return attributes;
}

/** What a caller can hang on every span of one run — trip, actor, scope, whether it was simulated. */
export type AgentSpanAttributes = Record<string, string | number | boolean>;

export interface AgentTraceParams {
  /**
   * The agent's name in the AI Agents view — `ask` and `plan` are the two,
   * matching the two endpoints. Not the model, and not the route: it is the
   * thing that has a job.
   */
  agentName: string;
  /** The full gateway model id, e.g. `anthropic/claude-haiku-4-5`. */
  modelId: string;
  /** Everything the model was offered this turn, so an unused tool is visible here as it is in the analytics record. */
  availableTools: readonly string[];
  /** Trip/actor/scope facts, repeated on every span so a span is filterable on its own. */
  attributes?: AgentSpanAttributes;
}

/** One tool execution, as `ToolLoopAgent`'s `onToolExecutionEnd` reports it. */
export interface ToolExecutionRecord {
  toolName: string;
  toolCallId?: string;
  /** Real measured duration — `toolExecutionMs` from the SDK, not a guess. */
  durationMs: number;
  ok: boolean;
}

/** One model round-trip's outcome, as `onStepEnd` reports it. */
export interface AgentStepRecord {
  usage?: AskUsage;
  finishReason?: string;
  toolNames?: readonly string[];
}

/** How the whole run ended. */
export interface AgentRunOutcome {
  status: "completed" | "error" | "abort";
  usage?: AskUsage;
  finishReason?: string;
  steps: number;
  toolCallCount: number;
  /** The thrown value on `error`, so the span carries the exception rather than only a red status. */
  cause?: unknown;
}

/**
 * The handle a turn drives.
 *
 * Every method is safe to call in any order, any number of times, including
 * not at all — the AI SDK's callbacks are the only thing that calls them, and
 * an abandoned turn fires a different subset from a completed one.
 */
export interface AgentTrace {
  /** Wire to `onStepStart`. Opens the `gen_ai.chat` span for the round-trip about to happen. */
  stepStarted(): void;
  /** Wire to `onStepEnd`. Closes the current `gen_ai.chat` span with its usage. */
  stepEnded(step: AgentStepRecord): void;
  /** Wire to `onToolExecutionEnd`. Emits one `gen_ai.execute_tool` span, nested under the step that called it. */
  toolExecuted(tool: ToolExecutionRecord): void;
  /** Wire to the recorder's own end-of-turn. Closes everything still open. */
  finish(outcome: AgentRunOutcome): void;
}

/** A trace that does nothing, returned whenever starting a real one failed. */
const NO_TRACE: AgentTrace = {
  stepStarted() {},
  stepEnded() {},
  toolExecuted() {},
  finish() {},
};

/**
 * Open a `gen_ai.invoke_agent` span for one agent run.
 *
 * **The parent is captured here, at call time, and passed explicitly to every
 * child.** That is not decoration: `/ask` streams, so `onStepEnd`, the tool
 * callbacks and `onEnd` all fire after `handleAskRequest` has returned its
 * `Response`. Relying on the ambient active span would attach the first span
 * to the request and orphan every later one into its own trace — an agent run
 * scattered across four traces, which is worse than none.
 */
export function startAgentTrace(params: AgentTraceParams): AgentTrace {
  try {
    const shared: AgentSpanAttributes = {
      ...(params.attributes ?? {}),
      ...modelAttributes(params.modelId),
      [ORIGIN_ATTRIBUTE]: ORIGIN,
    };
    // `null` means "no parent, start a new trace" to Sentry, and `undefined`
    // means "use the ambient one" — so this normalises the absent case to the
    // explicit one rather than letting a later call inherit whatever span
    // happened to be active on a reused lambda.
    const parent = Sentry.getActiveSpan() ?? null;
    const agentSpan = Sentry.startInactiveSpan({
      name: `invoke_agent ${params.agentName}`,
      op: "gen_ai.invoke_agent",
      parentSpan: parent,
      // Without this, a run whose parent request span has already ended (the
      // streaming case above) is a child of nothing and Sentry has no
      // transaction to hang it on — the run would be dropped rather than
      // displayed.
      forceTransaction: parent === null,
      attributes: {
        ...shared,
        [GEN_AI.operationName]: "invoke_agent",
        [GEN_AI.agentName]: params.agentName,
        [GEN_AI.availableTools]: toolListAttribute(params.availableTools),
      },
    });

    let stepSpan: Span | null = null;
    let stepIndex = 0;
    let finished = false;

    const endStep = (step?: AgentStepRecord): void => {
      if (stepSpan === null) return;
      const span = stepSpan;
      stepSpan = null;
      if (step) {
        span.setAttributes(usageAttributes(step.usage));
        if (step.finishReason) span.setAttribute(GEN_AI.finishReasons, [step.finishReason]);
        if (step.toolNames?.length) {
          span.setAttribute(GEN_AI.responseToolCalls, toolListAttribute(step.toolNames));
        }
      }
      span.end();
    };

    return {
      stepStarted() {
        try {
          // A step that starts while one is open means the previous
          // `onStepEnd` never fired (an abort mid-loop). Close it rather than
          // leaking it — an unended span is never sent at all, so the whole
          // run would lose that round-trip.
          endStep();
          stepIndex += 1;
          stepSpan = Sentry.startInactiveSpan({
            name: `chat ${params.modelId}`,
            op: "gen_ai.chat",
            parentSpan: agentSpan,
            attributes: {
              ...shared,
              [GEN_AI.operationName]: "chat",
              "gen_ai.step": stepIndex,
            },
          });
        } catch {
          stepSpan = null;
        }
      },

      stepEnded(step) {
        try {
          endStep(step);
        } catch {
          stepSpan = null;
        }
      },

      toolExecuted(tool) {
        try {
          // Nested under the step that called it when there is one, and under
          // the run when there is not — the SemConv hierarchy, and it also
          // means a tool call can never be silently dropped for want of a
          // parent.
          //
          // The window is reconstructed from the SDK's own measured
          // `toolExecutionMs` rather than from a clock read here: this
          // callback fires after the tool returned, so "now" is the end, and
          // anything else would be timing this function instead of the tool.
          const endedAt = Date.now();
          const span = Sentry.startInactiveSpan({
            name: `execute_tool ${tool.toolName}`,
            op: "gen_ai.execute_tool",
            parentSpan: stepSpan ?? agentSpan,
            startTime: endedAt - tool.durationMs,
            attributes: {
              ...shared,
              [GEN_AI.operationName]: "execute_tool",
              [GEN_AI.toolName]: tool.toolName,
              [GEN_AI.toolType]: "function",
              ...(tool.toolCallId ? { [GEN_AI.toolCallId]: tool.toolCallId } : {}),
            },
          });
          span.setStatus({ code: tool.ok ? 1 : 2 });
          span.end(endedAt);
        } catch {
          // A tool span is the most disposable thing here.
        }
      },

      finish(outcome) {
        try {
          // Both callers can reach this — `onEnd` and the abort/error path —
          // and an errored run fires both. First one wins, exactly as
          // `createAskRecorder`'s own single-writer latch does, so the span
          // records the failure rather than the tidier reason behind it.
          if (finished) return;
          finished = true;
          endStep();
          agentSpan.setAttributes({
            ...usageAttributes(outcome.usage),
            "gen_ai.run.steps": outcome.steps,
            "gen_ai.run.tool_calls": outcome.toolCallCount,
            "gen_ai.run.outcome": outcome.status,
          });
          if (outcome.finishReason) agentSpan.setAttribute(GEN_AI.finishReasons, [outcome.finishReason]);
          if (outcome.status === "error") {
            agentSpan.setStatus({ code: 2, message: "internal_error" });
            // The exception, attached to THIS span rather than captured
            // loose: a failed agent run in the AI Agents view that links to
            // the error that ended it is the whole point of recording the
            // failure here as well as in the log line.
            if (outcome.cause !== undefined) {
              Sentry.withActiveSpan(agentSpan, () => {
                Sentry.captureException(outcome.cause, {
                  mechanism: { type: ORIGIN, handled: true },
                });
              });
            }
          } else if (outcome.status === "abort") {
            // Not an error — a user navigating away. `cancelled` keeps it out
            // of every failure rate computed from span status, the same
            // distinction `AskOutcome` exists to preserve.
            agentSpan.setStatus({ code: 2, message: "cancelled" });
          } else {
            agentSpan.setStatus({ code: 1 });
          }
          agentSpan.end();
        } catch {
          // Nothing left to do: the span either ended or was never usable.
        }
      },
    };
  } catch {
    return NO_TRACE;
  }
}

export interface ModelCallParams {
  /** What this single call is for — `classify_intent`, `compose_page`. Carried as `gen_ai.call.purpose`. */
  operation: string;
  modelId: string;
  /**
   * Which shape of thing this call is, and therefore which op the span gets.
   *
   * `chat` for a single round-trip (the intent classifier). `invoke_agent` for
   * a call that runs its own tool loop internally — `generateText` with a
   * `stopWhen` is an agent, and filing it as a plain chat would hide every
   * multi-step planning run from the AI Agents view, which is the one place
   * anyone would go looking for it. Defaults to `chat`.
   */
  kind?: "chat" | "invoke_agent";
  attributes?: AgentSpanAttributes;
}

export interface ModelCallResult {
  usage?: AskUsage;
  finishReason?: string;
}

/**
 * Wrap ONE model round-trip that is not an agent loop — the pre-turn intent
 * classifier, and the command endpoint's page composition.
 *
 * A plain `gen_ai.chat` span with real timing, because unlike the streaming
 * agent these calls are awaited: the span opens before the call and closes
 * after it, with nothing reconstructed.
 *
 * `describe` runs on the RESOLVED value so usage lands on the span; it is
 * called inside the try, because it reads a provider-shaped result.
 */
export async function traceModelCall<T>(
  params: ModelCallParams,
  call: () => Promise<T>,
  describe?: (result: T) => ModelCallResult,
): Promise<T> {
  const kind = params.kind ?? "chat";
  let span: Span | undefined;
  try {
    span = Sentry.startInactiveSpan({
      name: `${kind} ${params.modelId}`,
      op: `gen_ai.${kind}`,
      attributes: {
        ...(params.attributes ?? {}),
        ...modelAttributes(params.modelId),
        [GEN_AI.operationName]: kind,
        [ORIGIN_ATTRIBUTE]: ORIGIN,
        "gen_ai.call.purpose": params.operation,
        ...(kind === "invoke_agent" ? { [GEN_AI.agentName]: params.operation } : {}),
      },
    });
  } catch {
    span = undefined;
  }
  try {
    const result = await call();
    try {
      if (span) {
        const described = describe?.(result);
        span.setAttributes(usageAttributes(described?.usage));
        if (described?.finishReason) span.setAttribute(GEN_AI.finishReasons, [described.finishReason]);
        span.setStatus({ code: 1 });
      }
    } catch {
      // A `describe` that threw on a provider-shaped result must not turn a
      // successful call into a failed one — the result below is still returned.
    }
    return result;
  } catch (err) {
    // Rethrown, always: this function's contract is that it is invisible
    // except for the span. `classifyAskIntent` catches its own errors and
    // fails open, and it must keep being the thing that decides that.
    try {
      span?.setStatus({ code: 2, message: "internal_error" });
    } catch {
      // ignore
    }
    throw err;
  } finally {
    try {
      span?.end();
    } catch {
      // ignore
    }
  }
}
