// The one test that runs a REAL Sentry client.
//
// `aiTelemetry.test.ts` and `aiMetrics.test.ts` mock `@sentry/nextjs`, which is
// the right boundary for "which spans, which attributes, which metric names" —
// and it is also a boundary that cannot notice the whole thing being wired to
// nothing. Every assertion in those files would still pass if `Sentry.init`
// rejected our options, if metrics were silently dropped for want of
// `enableMetrics`, or if a span never reached an envelope because its parent
// had already ended.
//
// So this file boots the SDK with a capturing transport and asserts what comes
// out the far end: the bytes that would go to Sentry. It is deliberately one
// test — an end-to-end tripwire, not a second copy of the unit suites.
//
// **What it taught us, written down because it cost half an hour.** Sentry v10
// STREAMS child spans: they leave as standalone `span` envelope items, not
// embedded in the transaction's `spans` array. A first draft of this test read
// `transaction.spans`, found `[]`, and looked exactly like "the nesting is
// broken" — it was not; the spans were already gone in their own envelope,
// correctly parented. Read both item types or read neither.
import { beforeAll, describe, expect, it } from "vitest";
import * as Sentry from "@sentry/nextjs";
import { startAgentTrace } from "@/server/ai/aiTelemetry";
import { recordAskMetrics } from "@/server/ai/aiMetrics";
import type { AskAnalyticsRecord } from "@/server/ai/askAnalytics";

interface EnvelopeItemHeader {
  type: string;
}
type Envelope = [unknown, Array<[EnvelopeItemHeader, unknown]>];

interface StreamedSpan {
  name: string;
  attributes: Record<string, { value: unknown }>;
}
interface StreamedMetric {
  name: string;
  type: string;
  value: number;
  attributes: Record<string, { value: unknown }>;
}

const sent: Envelope[] = [];

function streamedSpans(): StreamedSpan[] {
  return sent.flatMap(([, items]) =>
    items.flatMap(([header, item]) =>
      header.type === "span" ? (item as { items: StreamedSpan[] }).items : [],
    ),
  );
}

function streamedMetrics(): StreamedMetric[] {
  return sent.flatMap(([, items]) =>
    items.flatMap(([header, item]) =>
      header.type === "trace_metric" ? (item as { items: StreamedMetric[] }).items : [],
    ),
  );
}

function opOf(span: StreamedSpan): string {
  return String(span.attributes["sentry.op"]?.value);
}

function attributesOf(span: StreamedSpan): Record<string, unknown> {
  return Object.fromEntries(Object.entries(span.attributes).map(([key, value]) => [key, value.value]));
}

const RECORD: AskAnalyticsRecord = {
  event: "ai.ask",
  tripId: "6e9a2c9e-3f7a-4b6e-9d3f-2b1a5c8d7e6f",
  userId: "user_42",
  scope: { kind: "trip" },
  question: "Which day has the most free time?",
  turn: "opening",
  simulated: false,
  model: "anthropic/claude-haiku-4-5",
  steps: 2,
  toolCalls: [{ name: "read_trip", input: {} }],
  toolCallCount: 1,
  offeredTools: ["read_trip", "read_day", "find_free_time"],
  uncalledTools: ["read_day", "find_free_time"],
  classification: null,
  answered: true,
  outcome: "completed",
  cause: null,
  finishReason: "stop",
  usage: { inputTokens: 10366, outputTokens: 340, totalTokens: 10706 },
  usageByStep: [],
  droppedCalls: [],
  latencyMs: 4210,
};

beforeAll(async () => {
  Sentry.init({
    // Well-formed and unreachable — the transport below never leaves the
    // process, so nothing is sent anywhere.
    dsn: "https://0123456789abcdef0123456789abcdef@o0.ingest.us.sentry.io/0",
    tracesSampleRate: 1,
    // The option under test as much as anything else: without it every
    // `Sentry.metrics.*` call in `aiMetrics.ts` is a silent no-op, and there
    // is no error to tell you.
    enableMetrics: true,
    // No auto-instrumentation: this asserts what OUR modules emit, and the
    // default integrations would add process/HTTP spans that are not the
    // subject. OpenTelemetry setup is deliberately NOT skipped — the Node
    // SDK's span API is OTel-backed, and skipping it makes every span vanish.
    integrations: [],
    transport: () => ({
      send: async (envelope: unknown) => {
        sent.push(envelope as Envelope);
        return {};
      },
      flush: async () => true,
    }),
  });

  // One turn, in the order the AI SDK's callbacks fire it: two model
  // round-trips with a tool call inside the first.
  Sentry.startSpan({ name: "POST /api/trips/:tripId/ask", op: "http.server" }, () => {
    const trace = startAgentTrace({
      agentName: "ask",
      modelId: "anthropic/claude-haiku-4-5",
      availableTools: ["read_trip", "read_day", "find_free_time"],
      attributes: { agent: "ask", "ai.scope": "trip" },
    });
    trace.stepStarted();
    trace.toolExecuted({ toolName: "read_trip", toolCallId: "call_1", durationMs: 7, ok: true });
    trace.stepEnded({
      usage: { inputTokens: 4827, outputTokens: 40, totalTokens: 4867 },
      finishReason: "tool-calls",
      toolNames: ["read_trip"],
    });
    trace.stepStarted();
    trace.stepEnded({ usage: { inputTokens: 5539, outputTokens: 300, totalTokens: 5839 }, finishReason: "stop" });
    trace.finish({
      status: "completed",
      usage: RECORD.usage,
      finishReason: "stop",
      steps: 2,
      toolCallCount: 1,
    });
  });

  recordAskMetrics(RECORD);
  await Sentry.flush(5000);
});

describe("what actually reaches Sentry", () => {
  it("sends one agent run, one chat span per model round-trip, and one span per tool execution", () => {
    const ops = streamedSpans().map(opOf).sort();
    expect(ops).toEqual(["gen_ai.chat", "gen_ai.chat", "gen_ai.execute_tool", "gen_ai.invoke_agent"]);
  });

  // The op is what Sentry's AI Agents product keys off. It is set explicitly
  // rather than inferred, and this is where that stops being a claim: the
  // OTel bridge infers an op from HTTP, DB, RPC, messaging and FaaS attributes
  // and from nothing else, so a span that relied on inference would arrive
  // with no op at all and be invisible in the product it was emitted for.
  it("carries the gen_ai attributes and token counts on the agent run", () => {
    const agent = streamedSpans().find((span) => opOf(span) === "gen_ai.invoke_agent");
    expect(agent).toBeDefined();
    expect(agent!.name).toBe("invoke_agent ask");
    expect(attributesOf(agent!)).toMatchObject({
      "sentry.op": "gen_ai.invoke_agent",
      "sentry.origin": "manual.ai.travel_collab",
      "gen_ai.operation.name": "invoke_agent",
      "gen_ai.agent.name": "ask",
      "gen_ai.request.model": "claude-haiku-4-5",
      "gen_ai.provider.name": "anthropic",
      "gen_ai.usage.input_tokens": 10366,
      "gen_ai.usage.output_tokens": 340,
      "gen_ai.usage.total_tokens": 10706,
      "gen_ai.run.steps": 2,
      "gen_ai.run.tool_calls": 1,
      "gen_ai.run.outcome": "completed",
    });
  });

  // The reason `startAgentTrace` captures its parent eagerly: without one
  // trace and one parent chain, the AI Agents view has a run with no steps and
  // three orphans somewhere else.
  it("keeps the run, its steps and its tool call in one trace, correctly nested", () => {
    const spans = streamedSpans() as unknown as Array<
      StreamedSpan & { span_id: string; parent_span_id: string; trace_id: string }
    >;
    expect(new Set(spans.map((span) => span.trace_id)).size).toBe(1);

    const agent = spans.find((span) => opOf(span) === "gen_ai.invoke_agent")!;
    // Guard against the assertions below passing vacuously on two undefineds.
    expect(agent.span_id).toMatch(/^[0-9a-f]{16}$/);

    const steps = spans.filter((span) => opOf(span) === "gen_ai.chat");
    expect(steps).toHaveLength(2);
    for (const step of steps) {
      expect(step.parent_span_id).toBe(agent.span_id);
    }

    // The tool span hangs off the STEP that called it, not off the run —
    // `execute_tool` under `chat` under `invoke_agent` is the shape the GenAI
    // convention describes and the view draws.
    const tool = spans.find((span) => opOf(span) === "gen_ai.execute_tool")!;
    expect(tool.parent_span_id).toBe(steps.find((step) => step.parent_span_id === agent.span_id)!.span_id);
    expect(steps.map((step) => step.span_id)).toContain(tool.parent_span_id);
  });

  it("sends the token counters as summable counters, not as anything else", () => {
    const totals = streamedMetrics().filter((m) => m.name === "gen_ai.usage.total_tokens");
    expect(totals).toHaveLength(1);
    expect(totals[0]).toMatchObject({ type: "counter", value: 10706 });
    expect(totals[0]!.attributes.agent?.value).toBe("ask");
  });

  it("sends every metric the turn produces, tool calls included", () => {
    const names = new Set(streamedMetrics().map((m) => m.name));
    for (const expected of [
      "ai.ask.turns",
      "ai.ask.duration",
      "ai.ask.steps",
      "ai.ask.tool_calls",
      "ai.ask.tokens",
      "gen_ai.usage.input_tokens",
      "gen_ai.usage.output_tokens",
      "gen_ai.usage.total_tokens",
      "gen_ai.tool.calls",
      "ai.tool.offered",
      "ai.tool.uncalled",
    ]) {
      expect(names).toContain(expected);
    }
  });

  // The privacy rule, checked against the bytes rather than against our own
  // call sites — the one place it can be verified for the whole payload at
  // once, spans and metrics together.
  it("sends no question text and no unbounded identifier anywhere in the payload", () => {
    const payload = JSON.stringify(sent);
    expect(payload).not.toContain(RECORD.question);
    expect(payload).not.toContain(RECORD.tripId);
    expect(payload).not.toContain(RECORD.userId);
  });
});
