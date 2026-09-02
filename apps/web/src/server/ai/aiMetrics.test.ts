import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AskAnalyticsRecord } from "@/server/ai/askAnalytics";

// The module's whole job is which metric names, values and attributes get
// emitted, and none of that is observable through a real client — so the
// double IS the subject boundary here. `telemetry.int.test.ts` covers the
// other half, against a real client and the real endpoint.
const count = vi.fn();
const gauge = vi.fn();
const distribution = vi.fn();

vi.mock("@sentry/nextjs", () => ({
  metrics: {
    count: (...args: unknown[]) => count(...args),
    gauge: (...args: unknown[]) => gauge(...args),
    distribution: (...args: unknown[]) => distribution(...args),
  },
}));

import {
  recordAskMetrics,
  recordCommandMetrics,
  type CommandMetricsRecord,
  recordProposalApplyMetrics,
  splitModelId,
} from "@/server/ai/aiMetrics";

interface Emitted {
  name: string;
  value: number;
  unit?: string;
  attributes: Record<string, unknown>;
}

function emitted(fn: typeof count): Emitted[] {
  return fn.mock.calls.map(([name, value, options]) => ({
    name: name as string,
    value: value as number,
    unit: (options as { unit?: string } | undefined)?.unit,
    attributes: ((options as { attributes?: Record<string, unknown> } | undefined)?.attributes ?? {}),
  }));
}

function counted(name: string): Emitted[] {
  return emitted(count).filter((m) => m.name === name);
}

function distributed(name: string): Emitted[] {
  return emitted(distribution).filter((m) => m.name === name);
}

function allEmitted(): Emitted[] {
  return [...emitted(count), ...emitted(gauge), ...emitted(distribution)];
}

const ASK_RECORD: AskAnalyticsRecord = {
  event: "ai.ask",
  tripId: "6e9a2c9e-3f7a-4b6e-9d3f-2b1a5c8d7e6f",
  userId: "user_42",
  scope: { kind: "trip" },
  question: "Which day has the most free time?",
  turn: "opening",
  simulated: false,
  model: "anthropic/claude-haiku-4-5",
  steps: 3,
  toolCalls: [
    { name: "read_trip", input: {} },
    { name: "read_day", input: { days: [2, 3] } },
  ],
  toolCallCount: 2,
  offeredTools: ["read_trip", "read_day", "find_free_time"],
  uncalledTools: ["find_free_time"],
  classification: null,
  answered: true,
  outcome: "completed",
  cause: null,
  finishReason: "stop",
  usage: { inputTokens: 8355, outputTokens: 412, totalTokens: 8767 },
  usageByStep: [],
  droppedCalls: [],
  latencyMs: 4210,
};

beforeEach(() => {
  // `reset`, not `clear`: the "never throws" cases install a throwing
  // implementation, and `clearAllMocks` keeps implementations — which would
  // silently poison every test declared after them in file order.
  vi.resetAllMocks();
});

describe("splitModelId", () => {
  // The gateway addresses models as `provider/model`, and cost is a
  // per-provider question — so this split is the difference between a cost
  // breakdown and one bucket called "unknown".
  it("splits a gateway id into provider and model", () => {
    expect(splitModelId("anthropic/claude-haiku-4-5")).toEqual({
      provider: "anthropic",
      model: "claude-haiku-4-5",
    });
  });

  // A guessed provider is worse than no provider: it files real spend under a
  // vendor that never saw the request.
  it.each(["claude-haiku-4-5", "/leading", "trailing/", ""])(
    "reports no provider rather than guessing one for %o",
    (id) => {
      expect(splitModelId(id)).toEqual({ provider: null, model: id });
    },
  );

  // The model half can itself contain slashes; only the FIRST segment is the
  // provider.
  it("splits on the first slash only", () => {
    expect(splitModelId("a/b/c")).toEqual({ provider: "a", model: "b/c" });
  });
});

describe("recordAskMetrics", () => {
  it("counts one turn, tagged with its outcome and shape", () => {
    recordAskMetrics(ASK_RECORD);
    expect(counted("ai.ask.turns")).toEqual([
      {
        name: "ai.ask.turns",
        value: 1,
        unit: undefined,
        attributes: {
          agent: "ask",
          model: "claude-haiku-4-5",
          provider: "anthropic",
          simulated: false,
          scope: "trip",
          turn: "opening",
          outcome: "completed",
          answered: true,
          finish_reason: "stop",
        },
      },
    ]);
  });

  // Counters, not distributions, because the question is "how many tokens did
  // we spend" and a counter incremented by the count sums to exactly that.
  it("counts tokens by value so they sum to the turn's spend", () => {
    recordAskMetrics(ASK_RECORD);
    expect(counted("gen_ai.usage.input_tokens")[0]).toMatchObject({ value: 8355 });
    expect(counted("gen_ai.usage.output_tokens")[0]).toMatchObject({ value: 412 });
    expect(counted("gen_ai.usage.total_tokens")[0]).toMatchObject({ value: 8767 });
    expect(counted("gen_ai.usage.input_tokens")[0]!.attributes).toMatchObject({ agent: "ask", call: "turn" });
  });

  // The per-turn SHAPE is a different question from the total, so it gets its
  // own name rather than being read off the counter.
  it("also records the turn's total as a distribution", () => {
    recordAskMetrics(ASK_RECORD);
    expect(distributed("ai.ask.tokens")[0]).toMatchObject({ value: 8767 });
  });

  // A provider that reports the halves and no total would otherwise leave the
  // one number anyone charts permanently at zero.
  it("derives a missing total from the halves rather than skipping it", () => {
    recordAskMetrics({ ...ASK_RECORD, usage: { inputTokens: 100, outputTokens: 20, totalTokens: null } });
    expect(counted("gen_ai.usage.total_tokens")[0]).toMatchObject({ value: 120 });
    expect(distributed("ai.ask.tokens")[0]).toMatchObject({ value: 120 });
  });

  it("emits no token metric at all when the provider reported nothing", () => {
    recordAskMetrics({ ...ASK_RECORD, usage: { inputTokens: null, outputTokens: null, totalTokens: null } });
    expect(counted("gen_ai.usage.input_tokens")).toEqual([]);
    expect(counted("gen_ai.usage.output_tokens")).toEqual([]);
    expect(counted("gen_ai.usage.total_tokens")).toEqual([]);
    expect(distributed("ai.ask.tokens")).toEqual([]);
  });

  it("records latency in milliseconds, steps and tool-call count", () => {
    recordAskMetrics(ASK_RECORD);
    expect(distributed("ai.ask.duration")[0]).toMatchObject({ value: 4210, unit: "millisecond" });
    expect(distributed("ai.ask.steps")[0]).toMatchObject({ value: 3 });
    expect(distributed("ai.ask.tool_calls")[0]).toMatchObject({ value: 2 });
  });

  // The aggregate form of the measurement ADR-022's "a tool is earned by a new
  // computation" rule depends on: offered vs called vs uncalled, per tool.
  it("counts every tool offered, every tool called, and every tool left uncalled", () => {
    recordAskMetrics(ASK_RECORD);
    expect(counted("ai.tool.offered").map((m) => m.attributes.tool)).toEqual([
      "read_trip",
      "read_day",
      "find_free_time",
    ]);
    expect(counted("gen_ai.tool.calls").map((m) => m.attributes.tool)).toEqual(["read_trip", "read_day"]);
    expect(counted("ai.tool.uncalled").map((m) => m.attributes.tool)).toEqual(["find_free_time"]);
  });

  // A tool called twice in a turn is two calls, not one — the counter has to
  // move per call for "how often is this tool actually used" to mean anything.
  it("counts a repeated tool call once per call", () => {
    recordAskMetrics({
      ...ASK_RECORD,
      toolCalls: [
        { name: "read_day", input: { days: [1] } },
        { name: "read_day", input: { days: [2] } },
      ],
      toolCallCount: 2,
    });
    expect(counted("gen_ai.tool.calls")).toHaveLength(2);
  });

  it("counts a dropped write by its command type and the domain's rejection code", () => {
    recordAskMetrics({
      ...ASK_RECORD,
      droppedCalls: [
        { type: "MoveActivity", code: "unresolved-ref", refs: { activityRef: "Nope" }, message: 'No activity named "Nope".' },
      ],
    });
    const dropped = counted("ai.ask.dropped_calls");
    expect(dropped).toHaveLength(1);
    expect(dropped[0]!.attributes).toMatchObject({ type: "MoveActivity", code: "unresolved-ref" });
  });

  // A 429 and a 500 read identically in prose and demand opposite responses,
  // which is why the status code is an attribute and the message is not.
  it("counts a failure by error name and status, never by message", () => {
    recordAskMetrics({
      ...ASK_RECORD,
      outcome: "error",
      cause: { name: "AI_APICallError", message: "<html>Bad Gateway</html>", statusCode: 502 },
    });
    const failures = counted("ai.ask.failures");
    expect(failures).toHaveLength(1);
    expect(failures[0]!.attributes).toMatchObject({ error: "AI_APICallError", status: 502 });
    expect(JSON.stringify(failures[0]!.attributes)).not.toContain("Bad Gateway");
  });

  it("reports a status of 0 for a failure that was not an API call", () => {
    recordAskMetrics({
      ...ASK_RECORD,
      outcome: "error",
      cause: { name: "TypeError", message: "x is not a function", statusCode: null },
    });
    expect(counted("ai.ask.failures")[0]!.attributes).toMatchObject({ error: "TypeError", status: 0 });
  });

  it("counts no failure on an abandoned turn", () => {
    recordAskMetrics({ ...ASK_RECORD, outcome: "abort", cause: null });
    expect(counted("ai.ask.failures")).toEqual([]);
    expect(counted("ai.ask.turns")[0]!.attributes).toMatchObject({ outcome: "abort" });
  });

  describe("the pre-turn classifier", () => {
    const CLASSIFIED: AskAnalyticsRecord = {
      ...ASK_RECORD,
      classification: {
        intent: "question",
        source: "model",
        context: null,
        model: "anthropic/claude-haiku-4-5",
        verdict: '{"result":"question"}',
        failedOpen: false,
        latencyMs: 180,
        usage: { inputTokens: 150, outputTokens: 10, totalTokens: 160 },
      },
    };

    it("counts the verdict, how it was reached, and whether it failed open", () => {
      recordAskMetrics(CLASSIFIED);
      expect(counted("ai.classify.turns")[0]!.attributes).toMatchObject({
        intent: "question",
        source: "model",
        failed_open: false,
      });
      expect(distributed("ai.classify.duration")[0]).toMatchObject({ value: 180, unit: "millisecond" });
    });

    // "Did the cheap classifier save more than it cost" is a subtraction
    // between two series — which is only possible if both are under the same
    // metric name, separated by `call`.
    it("counts classifier tokens under the same names as the turn's, separated by call", () => {
      recordAskMetrics(CLASSIFIED);
      const inputs = counted("gen_ai.usage.input_tokens");
      expect(inputs.map((m) => [m.attributes.call, m.value])).toEqual([
        ["turn", 8355],
        ["classifier", 150],
      ]);
    });

    // `AI_CLASSIFIER_MODEL` can point the classifier at a cheaper model than
    // the one answering. Attributing its spend to the answer model would
    // silently destroy the one measurement that variable exists to enable.
    it("attributes classifier spend to the classifier's own model", () => {
      recordAskMetrics({
        ...CLASSIFIED,
        classification: { ...CLASSIFIED.classification!, model: "openai/gpt-oss-20b" },
      });
      const classifierTokens = counted("gen_ai.usage.input_tokens").find((m) => m.attributes.call === "classifier");
      expect(classifierTokens!.attributes).toMatchObject({ model: "gpt-oss-20b", provider: "openai" });
    });

    // The affirmation rule answers without calling a model, so there is no
    // model id and no spend — but the verdict still happened and still counts.
    it("counts an affirmation verdict, which called no model and spent nothing", () => {
      recordAskMetrics({
        ...CLASSIFIED,
        classification: {
          intent: "write",
          source: "affirmation",
          context: null,
          model: null,
          verdict: "bare agreement — no model call",
          failedOpen: false,
          latencyMs: 0,
          usage: { inputTokens: null, outputTokens: null, totalTokens: null },
        },
      });
      expect(counted("ai.classify.turns")[0]!.attributes).toMatchObject({ source: "affirmation", intent: "write" });
      expect(counted("gen_ai.usage.input_tokens").filter((m) => m.attributes.call === "classifier")).toEqual([]);
    });

    it("emits nothing about classification on a viewer's turn, which is never classified", () => {
      recordAskMetrics(ASK_RECORD);
      expect(counted("ai.classify.turns")).toEqual([]);
      expect(distributed("ai.classify.duration")).toEqual([]);
    });
  });

  // **Rule 1 of this module's header, as a test.** A metric attribute is a
  // series; `tripId` and `userId` are unbounded, so one turn per new trip
  // would mean one series per trip and a backend that answers by dropping
  // data. They are on the log record, which is where they belong.
  it("puts no unbounded identifier, and no user content, in any attribute", () => {
    recordAskMetrics({
      ...ASK_RECORD,
      classification: {
        intent: "write",
        source: "model",
        context: "Earlier in the conversation: user: add a temple",
        model: "anthropic/claude-haiku-4-5",
        verdict: '{"result":"write"}',
        failedOpen: false,
        latencyMs: 12,
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      },
      droppedCalls: [
        { type: "MoveActivity", code: "unresolved-ref", refs: { activityRef: "Nope" }, message: "No activity named." },
      ],
      outcome: "error",
      cause: { name: "AI_APICallError", message: "boom", statusCode: 500 },
    });

    // **A witness floor, per AGENTS.md.** Every assertion below is a
    // `not.toContain`, and `not.toContain` passes on an empty string — so a
    // record that emitted NOTHING (a throw swallowed by this module's own
    // catch, say) would sail through the whole privacy sweep. Pin what was
    // actually emitted first, so the sweep is checking a payload rather than
    // checking nothing. (CodeRabbit, PR #93.)
    const all = allEmitted();
    expect(all.length).toBeGreaterThan(0);
    expect(counted("ai.classify.turns")).toHaveLength(1);
    expect(counted("ai.ask.dropped_calls")).toHaveLength(1);
    expect(counted("ai.ask.failures")).toHaveLength(1);

    const serialized = JSON.stringify(all.map((m) => m.attributes));
    for (const forbidden of [
      ASK_RECORD.tripId,
      ASK_RECORD.userId,
      ASK_RECORD.question,
      "Earlier in the conversation",
      '{"result":"write"}',
      "No activity named",
      "boom",
      "Nope",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  // Same promise as the log sink and the spans: this runs on the end-of-turn
  // path of a streaming answer.
  it("never throws when the metrics client throws", () => {
    count.mockImplementation(() => {
      throw new Error("no client");
    });
    expect(() => recordAskMetrics(ASK_RECORD)).not.toThrow();
  });
});

describe("recordCommandMetrics", () => {
  // Annotated, not inferred: `surface` is a narrowed union, and an unannotated
  // object literal widens it to `string` — which is how this fixture went on
  // reporting a retired surface after ADR-033 deleted it.
  const COMMAND: CommandMetricsRecord = {
    surface: "page",
    model: "anthropic/claude-haiku-4-5",
    simulated: false,
    finishReason: "stop",
    truncated: false,
    steps: 4,
    toolNames: ["AddActivity", "AddActivity", "SetTripDates"],
    usage: { inputTokens: 12000, outputTokens: 900, totalTokens: 12900 },
    durationMs: 9100,
  };

  it("counts one generation, tagged with its surface, finish reason and truncation", () => {
    recordCommandMetrics(COMMAND);
    expect(counted("ai.command.turns")[0]!.attributes).toMatchObject({
      agent: "command",
      surface: "page",
      model: "claude-haiku-4-5",
      provider: "anthropic",
      simulated: false,
      finish_reason: "stop",
      truncated: false,
    });
    expect(distributed("ai.command.duration")[0]).toMatchObject({ value: 9100, unit: "millisecond" });
    expect(distributed("ai.command.steps")[0]).toMatchObject({ value: 4 });
    expect(distributed("ai.command.tool_calls")[0]).toMatchObject({ value: 3 });
  });

  // `/ai` and `/ask` reach the same gateway on the same key, so a token bill
  // that counted only one of them would be wrong by whatever the other spends.
  // The names are shared on purpose; `agent` is what separates them.
  it("counts its tokens under the same metric names as the ask endpoint's", () => {
    recordCommandMetrics(COMMAND);
    expect(counted("gen_ai.usage.input_tokens")[0]).toMatchObject({ value: 12000 });
    expect(counted("gen_ai.usage.input_tokens")[0]!.attributes).toMatchObject({ agent: "command", call: "turn" });
  });

  it("counts every tool call the plan made, by name", () => {
    recordCommandMetrics(COMMAND);
    expect(counted("gen_ai.tool.calls").map((m) => m.attributes.tool)).toEqual([
      "AddActivity",
      "AddActivity",
      "SetTripDates",
    ]);
  });

  it("never throws when the metrics client throws", () => {
    count.mockImplementation(() => {
      throw new Error("no client");
    });
    expect(() => recordCommandMetrics(COMMAND)).not.toThrow();
  });
});

describe("recordProposalApplyMetrics", () => {
  // "How many proposals were approved vs drafted" is a ratio between two
  // counters — the one shape a log line cannot give you without a query
  // nobody runs.
  it("counts an approved batch with no rejection code", () => {
    recordProposalApplyMetrics({ outcome: "applied", code: null, commandCount: 10, latencyMs: 240 });
    expect(counted("ai.proposal.apply")[0]).toEqual({
      name: "ai.proposal.apply",
      value: 1,
      unit: undefined,
      attributes: { outcome: "applied", code: "none" },
    });
    expect(distributed("ai.proposal.commands")[0]).toMatchObject({ value: 10 });
    expect(distributed("ai.proposal.apply.duration")[0]).toMatchObject({ value: 240, unit: "millisecond" });
  });

  it("counts a refused batch by the domain's own code", () => {
    recordProposalApplyMetrics({ outcome: "refused", code: "concurrency-conflict", commandCount: 3, latencyMs: 12 });
    expect(counted("ai.proposal.apply")[0]!.attributes).toEqual({
      outcome: "refused",
      code: "concurrency-conflict",
    });
  });

  it("never throws when the metrics client throws", () => {
    count.mockImplementation(() => {
      throw new Error("no client");
    });
    expect(() =>
      recordProposalApplyMetrics({ outcome: "applied", code: null, commandCount: 1, latencyMs: 1 }),
    ).not.toThrow();
  });
});
