// Sentry metrics for the assistant: token spend, tool-call counts, latency and
// outcomes, as numbers you can chart and alert on.
//
// **Why this exists at all, given Sentry already instruments the AI SDK.**
// Sentry's `VercelAI` integration emits this app's `gen_ai.*` SPANS (ADR-032)
// and it emits no metrics whatsoever. A span answers "where did this turn's
// four seconds go"; it does not answer "are we spending more output tokens
// than last week", which is an aggregate over thousands of turns. This module
// is that half, and it is the half nothing upstream provides.
//
// **Why this exists beside `askAnalytics.ts` rather than instead of it.** The
// `ai.ask` log line is one self-contained record per turn: a question, a tool
// trace, a classification verdict, a failure cause. It is what you read when
// you want to understand ONE turn, and the `ai-usage` skill reads a week of
// them for exactly that. It is a bad shape for "are we spending more output
// tokens than last week" — that needs an aggregate over thousands of lines,
// which is a query nobody runs against a log view.
//
// So: same facts, two shapes, one writer. This module takes the record that
// already exists and emits the summable half of it. Nothing here re-derives
// anything, and nothing here is a second source of truth.
//
// **Two rules for every attribute below.**
//
//   1. **Bounded cardinality, always.** A metric attribute becomes a series.
//      `tripId` and `userId` are unbounded, so they are NEVER attributes here
//      even though they are on every log record — one turn per new trip would
//      mean one series per trip, and a metrics backend answers that by
//      dropping data. Every attribute below has a small, enumerable range:
//      an outcome, a scope kind, a tool name from the derived families, a
//      model id from the environment.
//   2. **No user content.** The same rule the spans keep (via
//      `dataCollection.genAI` in the three `sentry.*.config.ts` files), for
//      the same reason: the question goes in our own log, deliberately, and
//      that decision does not extend to a third-party service by default.
//
// Like `logAskAnalytics`, **nothing here throws.** It is called from the same
// end-of-turn path a streaming answer runs through, so a telemetry fault must
// never become the reason an answer stops mid-sentence.
import * as Sentry from "@sentry/nextjs";
import type { AskAnalyticsRecord } from "@/server/ai/askAnalytics";

/**
 * Split a gateway model id into provider and model.
 *
 * Vercel's AI Gateway addresses models as `provider/model`
 * (`anthropic/claude-haiku-4-5`), and cost is a per-provider question — so
 * leaving the whole string in one attribute would file every model this app
 * can reach under a provider of "unknown". A bare id with no slash keeps the
 * whole string as the model and reports no provider, which is the honest
 * answer rather than a guessed one.
 *
 * Sentry's own `VercelAI` integration does the same split on its spans
 * (`gen_ai.system` / `gen_ai.request.model`); this is the metrics side of the
 * same dimension, so the two can be read against each other.
 */
export function splitModelId(modelId: string): { provider: string | null; model: string } {
  const slash = modelId.indexOf("/");
  if (slash <= 0 || slash === modelId.length - 1) return { provider: null, model: modelId };
  return { provider: modelId.slice(0, slash), model: modelId.slice(slash + 1) };
}

/** Metric attributes are one series each — see rule 1 in this file's header. */
type MetricAttributes = Record<string, string | number | boolean>;

// Sentry's unit vocabulary is the OTel one; "millisecond" is a real unit and
// tokens have none, so a token metric carries no unit rather than an invented
// one that a backend would then try to convert.
const MS = "millisecond";

/**
 * Token counters, as COUNTERS rather than distributions.
 *
 * The question these answer is "how many tokens did we spend", and a counter
 * incremented by the token count sums to exactly that over any window. A
 * distribution would answer "how big is a typical turn", which is a different
 * and also useful question — so both are emitted, under different names, and
 * neither is asked to do the other's job.
 */
function countTokens(usage: { inputTokens: number | null; outputTokens: number | null; totalTokens: number | null }, attributes: MetricAttributes): void {
  if (usage.inputTokens !== null) {
    Sentry.metrics.count("gen_ai.usage.input_tokens", usage.inputTokens, { attributes });
  }
  if (usage.outputTokens !== null) {
    Sentry.metrics.count("gen_ai.usage.output_tokens", usage.outputTokens, { attributes });
  }
  // Summed from the parts when the provider did not report a total, rather
  // than skipped: a provider that reports the two halves and no total would
  // otherwise leave the one number anyone actually charts permanently at zero.
  const total = usage.totalTokens ?? sumOrNull(usage.inputTokens, usage.outputTokens);
  if (total !== null) {
    Sentry.metrics.count("gen_ai.usage.total_tokens", total, { attributes });
  }
}

function sumOrNull(a: number | null, b: number | null): number | null {
  if (a === null && b === null) return null;
  return (a ?? 0) + (b ?? 0);
}

/**
 * Model attributes shared by every metric from one turn.
 *
 * The gateway addresses models as `provider/model`, and cost is a per-provider
 * question, so both halves are attributes — see `splitModelId`.
 */
function modelAttributes(modelId: string): MetricAttributes {
  const { provider, model } = splitModelId(modelId);
  return provider === null ? { model } : { model, provider };
}

/**
 * Everything one `/ask` turn contributes, from the record the turn already
 * built.
 *
 * Wired as a sink beside `logAskAnalytics` rather than inside it, so the log
 * line keeps working — and keeps being testable — with no Sentry client
 * present at all.
 */
export function recordAskMetrics(record: AskAnalyticsRecord): void {
  try {
    const model = modelAttributes(record.model);
    // `agent` used to separate this endpoint's numbers from the command
    // endpoint's; that endpoint is gone (ADR-033) and the attribute stays, so
    // a dashboard built against it does not break and a second agent has a
    // dimension to arrive on. `simulated` keeps flag-off traffic (every Vercel
    // environment until `ai-live` is on) out of any cost number computed from
    // these, without needing a second metric name.
    const base: MetricAttributes = {
      agent: "ask",
      ...model,
      simulated: record.simulated,
      scope: record.scope.kind,
      turn: record.turn,
    };

    Sentry.metrics.count("ai.ask.turns", 1, {
      attributes: { ...base, outcome: record.outcome, answered: record.answered, finish_reason: record.finishReason },
    });

    countTokens(record.usage, { ...base, call: "turn" });
    const turnTotal = record.usage.totalTokens ?? sumOrNull(record.usage.inputTokens, record.usage.outputTokens);
    if (turnTotal !== null) {
      Sentry.metrics.distribution("ai.ask.tokens", turnTotal, { attributes: base });
    }

    Sentry.metrics.distribution("ai.ask.duration", record.latencyMs, { unit: MS, attributes: base });
    Sentry.metrics.distribution("ai.ask.steps", record.steps, { attributes: base });
    Sentry.metrics.distribution("ai.ask.tool_calls", record.toolCallCount, { attributes: base });

    // **The measurement ADR-022's "a tool is earned" rule depends on.**
    // `askAnalytics.ts` computes `uncalledTools` rather than inferring it, and
    // this is the aggregate form: a tool whose uncalled counter equals its
    // offered counter over a month is a tool nobody uses, stated as a number
    // instead of an impression.
    for (const tool of record.offeredTools) {
      Sentry.metrics.count("ai.tool.offered", 1, { attributes: { ...base, tool } });
    }
    for (const call of record.toolCalls) {
      Sentry.metrics.count("gen_ai.tool.calls", 1, { attributes: { ...base, tool: call.name } });
    }
    for (const tool of record.uncalledTools) {
      Sentry.metrics.count("ai.tool.uncalled", 1, { attributes: { ...base, tool } });
    }

    // A write the model asked for and the resolver or the domain refused.
    // `code` is a fixed enum from the domain, `type` a command name — both
    // bounded, unlike the human refs the log record carries and this
    // deliberately does not.
    for (const dropped of record.droppedCalls) {
      Sentry.metrics.count("ai.ask.dropped_calls", 1, {
        attributes: { ...base, type: dropped.type, code: dropped.code },
      });
    }

    if (record.cause !== null) {
      Sentry.metrics.count("ai.ask.failures", 1, {
        attributes: {
          ...base,
          // The error's `name` is a short enum-like token (`AI_APICallError`)
          // and the status code separates a rate limit from an outage. The
          // provider's MESSAGE is prose and is deliberately not here — it is
          // on the log record, where unbounded text belongs.
          error: record.cause.name,
          status: record.cause.statusCode ?? 0,
        },
      });
    }

    const classification = record.classification;
    if (classification !== null) {
      const classifierModel = classification.model ?? record.model;
      const classifierBase: MetricAttributes = {
        agent: "ask",
        ...modelAttributes(classifierModel),
        simulated: record.simulated,
      };
      Sentry.metrics.count("ai.classify.turns", 1, {
        attributes: { ...classifierBase, intent: classification.intent, source: classification.source, failed_open: classification.failedOpen },
      });
      Sentry.metrics.distribution("ai.classify.duration", classification.latencyMs, {
        unit: MS,
        attributes: classifierBase,
      });
      // Counted under the same token metric names as the turn, separated by
      // `call` — which is the whole point of `AI_CLASSIFIER_MODEL` existing:
      // "did the cheap classifier save more than it cost" is a subtraction
      // between two series, and it is only possible if both are here.
      countTokens(classification.usage, { ...classifierBase, call: "classifier" });
    }
  } catch {
    // Telemetry never breaks a turn. See this file's header.
  }
}

/** What one Approve click contributes — the `ai.proposal.apply` record, in metric form. */
export interface ProposalApplyMetricsRecord {
  outcome: "applied" | "refused";
  code: string | null;
  commandCount: number;
  latencyMs: number;
}

/**
 * Approve/refuse counts for the propose → review → approve loop.
 *
 * "How many proposals were approved" is the first number anyone evaluating M9
 * asks for, and it is a ratio between two counters — the one shape a log line
 * cannot give you without a query nobody runs.
 */
export function recordProposalApplyMetrics(record: ProposalApplyMetricsRecord): void {
  try {
    const attributes: MetricAttributes = {
      outcome: record.outcome,
      // A fixed set of domain rejection codes, never a message.
      code: record.code ?? "none",
    };
    Sentry.metrics.count("ai.proposal.apply", 1, { attributes });
    Sentry.metrics.distribution("ai.proposal.commands", record.commandCount, { attributes });
    Sentry.metrics.distribution("ai.proposal.apply.duration", record.latencyMs, { unit: MS, attributes });
  } catch {
    // Telemetry never breaks a write that already committed.
  }
}
