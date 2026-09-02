// **The AI-telemetry wiring test**, run against a REAL Sentry client.
//
// It exists because the thing being asserted is not our code. Sentry's
// `VercelAI` integration subscribes to the AI SDK's own `ai:telemetry`
// diagnostics channel and emits this turn's `gen_ai.*` spans; all this app
// contributes is `telemetry.functionId` on the agent. That makes the whole
// feature a claim about a third-party integration, two default-on switches and
// a one-line option — none of which any unit test can see, and all of which
// fail silently:
//
//   * The channel is `ai` >= 7 only. On `ai` < 7 Sentry falls back to patching
//     the module, and this app's agent calls `ToolLoopAgent`, not the patched
//     `generateText`/`streamText` exports — a downgrade would produce nothing.
//   * The subscriber needs Sentry's OpenTelemetry setup for its async-context
//     binding, which `skipOpenTelemetrySetup` would remove.
//   * `VercelAI` is a DEFAULT integration. `sentry.server.config.ts` passes an
//     `integrations` array, which merges with the defaults — a future
//     `defaultIntegrations: false` there would delete this silently.
//
// Every one of those leaves the app running, the tests green and the AI Agents
// dashboard empty. So this asserts the spans that actually left the SDK.
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import * as Sentry from "@sentry/nextjs";
import { executeTripCommand } from "@/server/commands";
import { simulatedModel } from "@/server/ai/simulatedModel";

const ACTOR_ID = "ask-telemetry-owner";

vi.mock("@/server/auth", () => ({
  auth: vi.fn(async () => ({ user: { id: ACTOR_ID } })),
}));

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

/**
 * v10 streams child spans as standalone `span` envelope items rather than
 * embedding them in the transaction's `spans` array. A first draft of this
 * read `transaction.spans`, found `[]`, and looked exactly like "nothing was
 * instrumented" — it was not. Read the `span` items.
 */
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

function attr(span: StreamedSpan, key: string): unknown {
  return span.attributes[key]?.value;
}

/** Only the spans Sentry's own AI integration produced — never one of ours. */
function aiSpans(): StreamedSpan[] {
  return streamedSpans().filter((span) => attr(span, "sentry.origin") === "auto.vercelai.channel");
}

function aiSpansWithOp(op: string): StreamedSpan[] {
  return aiSpans().filter((span) => attr(span, "sentry.op") === op);
}

const { handleAskRequest } = await import("@/server/ai/handleAskRequest");

async function seedTrip(): Promise<string> {
  const tripId = randomUUID();
  const create = await executeTripCommand({ type: "CreateTrip", tripId, name: "Kyoto 2027" }, ACTOR_ID);
  if (!create.ok) throw new Error("failed to seed trip");
  const dated = await executeTripCommand(
    {
      type: "SetTripDates",
      tripId,
      startDate: "2027-04-01",
      endDate: "2027-04-03",
      newDayIds: [randomUUID(), randomUUID(), randomUUID()],
    },
    ACTOR_ID,
  );
  if (!dated.ok) throw new Error("failed to date trip");
  await executeTripCommand(
    {
      type: "AddActivity",
      tripId,
      activityId: randomUUID(),
      dayId: dated.detail.days[0]!.dayId,
      title: "Fushimi Inari",
      timeWindow: { start: "09:00", end: "11:00" },
    },
    ACTOR_ID,
  );
  return tripId;
}

beforeAll(async () => {
  Sentry.init({
    // Well-formed and unreachable — the transport never leaves the process.
    dsn: "https://0123456789abcdef0123456789abcdef@o0.ingest.us.sentry.io/0",
    tracesSampleRate: 1,
    enableMetrics: true,
    // Deliberately NOT overriding `integrations` or `defaultIntegrations`:
    // whether `VercelAI` is on by default is part of what this asserts.
    transport: () => ({
      send: async (envelope: unknown) => {
        sent.push(envelope as Envelope);
        return {};
      },
      flush: async () => true,
    }),
  });

  const tripId = await seedTrip();
  await Sentry.startSpan({ name: "POST /api/trips/:tripId/ask", op: "http.server" }, async () => {
    const response = await handleAskRequest(
      new Request(`http://test/api/trips/${tripId}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ id: "m1", role: "user", parts: [{ type: "text", text: "how long is this trip?" }] }],
          scope: { kind: "trip" },
        }),
      }),
      tripId,
      simulatedModel() as unknown as Parameters<typeof handleAskRequest>[2],
      // The endpoint's existing analytics seam — a no-op keeps the `ai.ask`
      // line out of the test output without changing which code runs.
      () => {},
    );
    expect(response.status).toBe(200);
    // The stream's callbacks only fire as it is read.
    await response.text();
  });

  await Sentry.flush(5000);
});

describe("POST /api/trips/:id/ask — AI telemetry", () => {
  it("produces gen_ai spans from Sentry's own integration, not from ours", () => {
    expect(aiSpans().length).toBeGreaterThan(0);
    // Nothing in this app emits gen_ai spans by hand any more. If that changes,
    // the AI Agents view starts double-counting tokens for every turn — the
    // regression this line exists to catch (see ADR-032).
    const handRolled = streamedSpans().filter(
      (span) =>
        String(attr(span, "sentry.op") ?? "").startsWith("gen_ai.") &&
        attr(span, "sentry.origin") !== "auto.vercelai.channel",
    );
    expect(handRolled).toEqual([]);
  });

  it("names the turn's run `ask`, so it is distinguishable from the classifier's and from /ai's", () => {
    const named = aiSpansWithOp("gen_ai.invoke_agent").filter((span) => span.name.includes("ask"));
    expect(named.length).toBeGreaterThan(0);
  });

  // The classifier is a second round-trip on every editor turn, possibly on a
  // different model. `AI_CLASSIFIER_MODEL` buys nothing if the two cannot be
  // told apart in the trace.
  it("records the intent classifier as its own named run", () => {
    const classifier = aiSpansWithOp("gen_ai.invoke_agent").filter((span) =>
      span.name.includes("classify_intent"),
    );
    expect(classifier).toHaveLength(1);
  });

  it("records one model call and one span per tool the agent executed", () => {
    expect(aiSpansWithOp("gen_ai.generate_content").length).toBeGreaterThan(0);
    const tools = aiSpansWithOp("gen_ai.execute_tool");
    expect(tools.length).toBeGreaterThan(0);
    for (const tool of tools) {
      expect(["read_trip", "read_day", "find_free_time"]).toContain(attr(tool, "gen_ai.tool.name"));
      expect(attr(tool, "gen_ai.tool.call.id")).toEqual(expect.any(String));
    }
  });

  it("carries token usage on the run, which is what the cost view reads", () => {
    const runs = aiSpansWithOp("gen_ai.invoke_agent");
    // A `for` over an empty list asserts nothing and reports green — which is
    // exactly what a failed init, transport or flush would produce here.
    expect(runs.length).toBeGreaterThan(0);
    for (const run of runs) {
      expect(attr(run, "gen_ai.usage.input_tokens")).toEqual(expect.any(Number));
      expect(attr(run, "gen_ai.usage.output_tokens")).toEqual(expect.any(Number));
      expect(attr(run, "gen_ai.usage.total_tokens")).toEqual(expect.any(Number));
    }
  });

  // Sentry emits no metrics of its own — this half is entirely ours, and it is
  // what answers "is this getting more expensive" over a month.
  it("emits the turn's metrics, tool calls included", () => {
    const names = new Set(streamedMetrics().map((metric) => metric.name));
    for (const expected of [
      "ai.ask.turns",
      "ai.ask.duration",
      "ai.ask.steps",
      "ai.ask.tool_calls",
      "gen_ai.tool.calls",
      "ai.tool.offered",
      "ai.classify.turns",
    ]) {
      expect(names).toContain(expected);
    }
    const turns = streamedMetrics().find((metric) => metric.name === "ai.ask.turns")!;
    expect(attr(turns as unknown as StreamedSpan, "agent")).toBe("ask");
    expect(attr(turns as unknown as StreamedSpan, "outcome")).toBe("completed");
    // The flag is off by default in every Vercel environment, and a simulated
    // turn contacted no provider — the attribute anyone computing cost filters on.
    expect(attr(turns as unknown as StreamedSpan, "simulated")).toBe(true);
  });

  // The privacy rule, checked against the bytes: Sentry's integration defaults
  // `recordInputs`/`recordOutputs` to false, and the three `sentry.*.config.ts`
  // files say so explicitly so an SDK default-flip cannot start sending them.
  it("sends no question text and no unbounded identifier anywhere in the payload", () => {
    // Same witness floor as the token case above, and it matters more here:
    // `not.toContain` on an empty payload is the strongest-looking, emptiest
    // assertion in the file.
    expect(aiSpans().length).toBeGreaterThan(0);
    expect(streamedMetrics().length).toBeGreaterThan(0);

    const payload = JSON.stringify(sent);
    expect(payload).not.toContain("how long is this trip?");
    expect(payload).not.toContain(ACTOR_ID);
  });
});
