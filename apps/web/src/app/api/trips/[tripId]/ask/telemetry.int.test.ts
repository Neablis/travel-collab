// **The wiring test**, and it exists because the unit suites cannot see the
// thing most likely to break.
//
// `aiTelemetry.test.ts` proves the module emits the right spans when called.
// `aiTelemetry.envelope.test.ts` proves those spans reach a Sentry envelope.
// Neither would notice the endpoint never calling it — and the calls run
// through `ToolLoopAgent`'s callback plumbing, which merges constructor
// callbacks with per-call ones (`ToolLoopAgent.stream`, ai@7) and is exactly
// the sort of thing a minor version rearranges. `onStepStart` quietly ceasing
// to fire would cost every per-step span and every token attribution on them,
// with nothing red anywhere.
//
// So this drives the REAL handler, with the REAL agent, over the REAL simulated
// model, and asserts what came out.
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeTripCommand } from "@/server/commands";
import { simulatedModel } from "@/server/ai/simulatedModel";

const ACTOR_ID = "ask-telemetry-owner";

vi.mock("@/server/auth", () => ({
  auth: vi.fn(async () => ({ user: { id: ACTOR_ID } })),
}));

interface StartedSpan {
  name: string;
  op: string;
  attributes: Record<string, unknown>;
}
interface EmittedMetric {
  name: string;
  value: number;
  attributes: Record<string, unknown>;
}

const spans: StartedSpan[] = [];
const metrics: EmittedMetric[] = [];

vi.mock("@sentry/nextjs", () => {
  const span = {
    setAttribute: () => {},
    setAttributes: () => {},
    setStatus: () => {},
    end: () => {},
  };
  const record = (name: string, value: number, options?: { attributes?: Record<string, unknown> }) => {
    metrics.push({ name, value, attributes: options?.attributes ?? {} });
  };
  return {
    startInactiveSpan: (options: { name: string; op: string; attributes?: Record<string, unknown> }) => {
      spans.push({ name: options.name, op: options.op, attributes: options.attributes ?? {} });
      return span;
    },
    getActiveSpan: () => undefined,
    withActiveSpan: (_span: unknown, cb: () => unknown) => cb(),
    captureException: () => {},
    metrics: { count: record, gauge: record, distribution: record },
  };
});

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

function req(tripId: string, text: string) {
  return new Request(`http://test/api/trips/${tripId}/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [{ id: "m1", role: "user", parts: [{ type: "text", text }] }],
      scope: { kind: "trip" },
    }),
  });
}

function opsEmitted(): string[] {
  return spans.map((span) => span.op);
}

/** One completed turn, drained — the stream's callbacks only fire as it is read. */
async function askOnce(): Promise<void> {
  const tripId = await seedTrip();
  const response = await handleAskRequest(
    req(tripId, "how long is this trip?"),
    tripId,
    simulatedModel("ask") as unknown as Parameters<typeof handleAskRequest>[2],
    // The analytics sink is the test seam this endpoint already has; passing a
    // no-op keeps the `ai.ask` line out of the test output without changing
    // which code runs — the metrics and the span close in the same sink.
    () => {},
  );
  expect(response.status).toBe(200);
  await response.text();
}

beforeEach(() => {
  spans.length = 0;
  metrics.length = 0;
});

describe("POST /api/trips/:id/ask — telemetry wiring", () => {
  it("opens exactly one agent run for the turn", async () => {
    await askOnce();
    const runs = spans.filter((span) => span.op === "gen_ai.invoke_agent");
    expect(runs).toHaveLength(1);
    expect(runs[0]!.name).toBe("invoke_agent ask");
    expect(runs[0]!.attributes).toMatchObject({
      "gen_ai.agent.name": "ask",
      "gen_ai.operation.name": "invoke_agent",
      agent: "ask",
      "ai.scope": "trip",
      "ai.turn": "opening",
    });
  });

  // The pre-turn classifier is its own round-trip on its own (possibly
  // cheaper) model, so it gets its own span rather than being folded into the
  // run — see `AI_CLASSIFIER_MODEL` and ADR-032 §3.
  it("opens a chat span for the intent classifier, tagged as such", async () => {
    await askOnce();
    const classifier = spans.filter((span) => span.attributes["gen_ai.call.purpose"] === "classify_intent");
    expect(classifier).toHaveLength(1);
    expect(classifier[0]!.op).toBe("gen_ai.chat");
  });

  // The two assertions that would go quiet if `ToolLoopAgent` stopped
  // forwarding the constructor's callbacks.
  it("opens a chat span per model round-trip the agent actually took", async () => {
    await askOnce();
    const steps = spans.filter(
      (span) => span.op === "gen_ai.chat" && span.attributes["gen_ai.step"] !== undefined,
    );
    expect(steps.length).toBeGreaterThan(0);
    expect(steps.map((span) => span.attributes["gen_ai.step"])).toEqual(
      steps.map((_, index) => index + 1),
    );
  });

  it("opens a tool span per tool the agent executed, named for the tool", async () => {
    await askOnce();
    const tools = spans.filter((span) => span.op === "gen_ai.execute_tool");
    expect(tools.length).toBeGreaterThan(0);
    for (const tool of tools) {
      const name = tool.attributes["gen_ai.tool.name"];
      // Every tool this endpoint can offer is a read tool for a question.
      expect(["read_trip", "read_day", "find_free_time"]).toContain(name);
      expect(tool.name).toBe(`execute_tool ${name}`);
      expect(tool.attributes["gen_ai.tool.call.id"]).toEqual(expect.any(String));
    }
  });

  it("emits the turn's metrics, tool calls included", async () => {
    await askOnce();
    const names = new Set(metrics.map((metric) => metric.name));
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
    expect(metrics.find((metric) => metric.name === "ai.ask.turns")!.attributes).toMatchObject({
      agent: "ask",
      outcome: "completed",
      // The flag is off in every environment by default, and a simulated turn
      // contacted no provider — the attribute anyone computing cost must filter on.
      simulated: true,
    });
  });

  // The endpoint's own end-of-turn sink is the single writer; a second turn
  // must not reopen or double-close the first one's run.
  it("keeps two turns' runs separate", async () => {
    await askOnce();
    await askOnce();
    expect(opsEmitted().filter((op) => op === "gen_ai.invoke_agent")).toHaveLength(2);
    expect(metrics.filter((metric) => metric.name === "ai.ask.turns")).toHaveLength(2);
  });
});
