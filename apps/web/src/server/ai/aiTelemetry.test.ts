import { beforeEach, describe, expect, it, vi } from "vitest";

// The whole module under test is a wrapper over Sentry's span API, so the
// double IS the subject boundary: what matters is which spans get started,
// with which op, under which parent, carrying which attributes — none of which
// is observable through a real client without a Sentry server on the other end.
const startInactiveSpan = vi.fn();
const getActiveSpan = vi.fn();
const captureException = vi.fn();
const withActiveSpan = vi.fn((_span: unknown, cb: () => unknown) => cb());

vi.mock("@sentry/nextjs", () => ({
  startInactiveSpan: (...args: unknown[]) => startInactiveSpan(...args),
  getActiveSpan: () => getActiveSpan(),
  withActiveSpan: (span: unknown, cb: () => unknown) => withActiveSpan(span, cb),
  captureException: (...args: unknown[]) => captureException(...args),
}));

import { splitModelId, startAgentTrace, traceModelCall } from "@/server/ai/aiTelemetry";

interface StartedSpan {
  options: Record<string, unknown>;
  attributes: Record<string, unknown>;
  status: unknown;
  endedAt: number | undefined;
  ended: boolean;
  handle: Record<string, unknown>;
}

let started: StartedSpan[] = [];

function makeSpan(options: Record<string, unknown>): Record<string, unknown> {
  const record: StartedSpan = {
    options,
    attributes: { ...((options.attributes as Record<string, unknown>) ?? {}) },
    status: undefined,
    endedAt: undefined,
    ended: false,
    handle: {},
  };
  record.handle = {
    setAttribute: (key: string, value: unknown) => {
      record.attributes[key] = value;
    },
    setAttributes: (values: Record<string, unknown>) => {
      Object.assign(record.attributes, values);
    },
    setStatus: (status: unknown) => {
      record.status = status;
    },
    end: (at?: number) => {
      record.ended = true;
      record.endedAt = at;
    },
  };
  started.push(record);
  return record.handle;
}

function spansWithOp(op: string): StartedSpan[] {
  return started.filter((s) => s.options.op === op);
}

function onlySpanWithOp(op: string): StartedSpan {
  const matches = spansWithOp(op);
  expect(matches).toHaveLength(1);
  return matches[0]!;
}

beforeEach(() => {
  started = [];
  vi.clearAllMocks();
  startInactiveSpan.mockImplementation(makeSpan);
  getActiveSpan.mockReturnValue(undefined);
  withActiveSpan.mockImplementation((_span: unknown, cb: () => unknown) => cb());
});

const PARAMS = {
  agentName: "ask",
  modelId: "anthropic/claude-haiku-4-5",
  availableTools: ["read_trip", "read_day"],
  attributes: { agent: "ask", "ai.scope": "trip" },
};

describe("splitModelId", () => {
  // The gateway addresses models as `provider/model`, and Sentry groups cost
  // by provider — so this split is the difference between a cost breakdown and
  // one bucket called "unknown".
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

  // The model half can itself contain slashes (`openai/gpt-oss/20b`); only the
  // FIRST segment is the provider.
  it("splits on the first slash only", () => {
    expect(splitModelId("a/b/c")).toEqual({ provider: "a", model: "b/c" });
  });
});

describe("startAgentTrace", () => {
  it("opens one gen_ai.invoke_agent span naming the agent, model, provider and offered tools", () => {
    startAgentTrace(PARAMS);
    const agent = onlySpanWithOp("gen_ai.invoke_agent");
    expect(agent.options.name).toBe("invoke_agent ask");
    expect(agent.attributes).toMatchObject({
      "gen_ai.operation.name": "invoke_agent",
      "gen_ai.agent.name": "ask",
      "gen_ai.request.model": "claude-haiku-4-5",
      "gen_ai.provider.name": "anthropic",
      "gen_ai.system": "anthropic",
      "gen_ai.request.available_tools": JSON.stringify(["read_trip", "read_day"]),
      "sentry.origin": "manual.ai.travel_collab",
      agent: "ask",
      "ai.scope": "trip",
    });
  });

  // The reason `startAgentTrace` is called where it is: after the handler
  // returns its streaming Response there is no ambient span left, so a run
  // that read the active span lazily would scatter its steps across traces.
  it("captures the active span once, at start, and parents every later span to the run", () => {
    const requestSpan = { id: "request" };
    getActiveSpan.mockReturnValue(requestSpan);

    const trace = startAgentTrace(PARAMS);
    const agent = onlySpanWithOp("gen_ai.invoke_agent");
    expect(agent.options.parentSpan).toBe(requestSpan);

    // The ambient span disappears the moment the response is returned.
    getActiveSpan.mockReturnValue(undefined);
    trace.stepStarted();
    expect(onlySpanWithOp("gen_ai.chat").options.parentSpan).toBe(agent.handle);
  });

  // Without this, a run whose parent request span has already ended has no
  // transaction to hang on and is dropped rather than displayed.
  it("forces a transaction only when there was no parent to attach to", () => {
    startAgentTrace(PARAMS);
    expect(onlySpanWithOp("gen_ai.invoke_agent").options.forceTransaction).toBe(true);

    started = [];
    getActiveSpan.mockReturnValue({ id: "request" });
    startAgentTrace(PARAMS);
    expect(onlySpanWithOp("gen_ai.invoke_agent").options.forceTransaction).toBe(false);
  });

  it("closes a step's gen_ai.chat span with that step's own usage and tool calls", () => {
    const trace = startAgentTrace(PARAMS);
    trace.stepStarted();
    trace.stepEnded({
      usage: { inputTokens: 4827, outputTokens: 120, totalTokens: 4947 },
      finishReason: "tool-calls",
      toolNames: ["read_trip"],
    });

    const step = onlySpanWithOp("gen_ai.chat");
    expect(step.options.name).toBe("chat anthropic/claude-haiku-4-5");
    expect(step.ended).toBe(true);
    expect(step.attributes).toMatchObject({
      "gen_ai.operation.name": "chat",
      "gen_ai.step": 1,
      "gen_ai.usage.input_tokens": 4827,
      "gen_ai.usage.output_tokens": 120,
      "gen_ai.usage.total_tokens": 4947,
      "gen_ai.response.finish_reasons": ["tool-calls"],
      "gen_ai.response.tool_calls": JSON.stringify(["read_trip"]),
    });
  });

  it("numbers steps in order", () => {
    const trace = startAgentTrace(PARAMS);
    for (let i = 0; i < 3; i += 1) {
      trace.stepStarted();
      trace.stepEnded({});
    }
    expect(spansWithOp("gen_ai.chat").map((s) => s.attributes["gen_ai.step"])).toEqual([1, 2, 3]);
  });

  // An unended span is never sent at all, so a step abandoned mid-loop would
  // silently vanish from the run rather than showing as an incomplete step.
  it("closes an unfinished step when the next one starts", () => {
    const trace = startAgentTrace(PARAMS);
    trace.stepStarted();
    trace.stepStarted();
    const steps = spansWithOp("gen_ai.chat");
    expect(steps).toHaveLength(2);
    expect(steps[0]!.ended).toBe(true);
  });

  it("closes an unfinished step when the run finishes", () => {
    const trace = startAgentTrace(PARAMS);
    trace.stepStarted();
    trace.finish({ status: "abort", steps: 1, toolCallCount: 0 });
    expect(onlySpanWithOp("gen_ai.chat").ended).toBe(true);
  });

  // The SDK reports `toolExecutionMs` after the tool returned, so "now" is the
  // END of the window. Reading a clock for the start would time this callback
  // rather than the tool.
  it("reconstructs a tool span's window from the SDK's measured duration", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-08-30T12:00:00.000Z"));
      const now = Date.now();
      const trace = startAgentTrace(PARAMS);
      trace.stepStarted();
      trace.toolExecuted({ toolName: "read_day", toolCallId: "call_1", durationMs: 42, ok: true });

      const tool = onlySpanWithOp("gen_ai.execute_tool");
      expect(tool.options.startTime).toBe(now - 42);
      expect(tool.endedAt).toBe(now);
    } finally {
      vi.useRealTimers();
    }
  });

  it("names a tool span for the tool and nests it under the step that called it", () => {
    const trace = startAgentTrace(PARAMS);
    trace.stepStarted();
    const step = onlySpanWithOp("gen_ai.chat");
    trace.toolExecuted({ toolName: "find_free_time", toolCallId: "call_9", durationMs: 3, ok: true });

    const tool = onlySpanWithOp("gen_ai.execute_tool");
    expect(tool.options.name).toBe("execute_tool find_free_time");
    expect(tool.options.parentSpan).toBe(step.handle);
    expect(tool.attributes).toMatchObject({
      "gen_ai.operation.name": "execute_tool",
      "gen_ai.tool.name": "find_free_time",
      "gen_ai.tool.type": "function",
      "gen_ai.tool.call.id": "call_9",
    });
    expect(tool.status).toEqual({ code: 1 });
  });

  // A tool call outside a step must not be dropped for want of a parent.
  it("nests a tool span under the run when no step is open", () => {
    const trace = startAgentTrace(PARAMS);
    const agent = onlySpanWithOp("gen_ai.invoke_agent");
    trace.toolExecuted({ toolName: "read_trip", durationMs: 1, ok: true });
    expect(onlySpanWithOp("gen_ai.execute_tool").options.parentSpan).toBe(agent.handle);
  });

  it("marks a failed tool execution as an error", () => {
    const trace = startAgentTrace(PARAMS);
    trace.toolExecuted({ toolName: "read_day", durationMs: 1, ok: false });
    expect(onlySpanWithOp("gen_ai.execute_tool").status).toEqual({ code: 2 });
  });

  it("closes the run with its whole-turn usage, step count and tool-call count", () => {
    const trace = startAgentTrace(PARAMS);
    trace.finish({
      status: "completed",
      usage: { inputTokens: 8355, outputTokens: 412, totalTokens: 8767 },
      finishReason: "stop",
      steps: 3,
      toolCallCount: 2,
    });
    const agent = onlySpanWithOp("gen_ai.invoke_agent");
    expect(agent.ended).toBe(true);
    expect(agent.status).toEqual({ code: 1 });
    expect(agent.attributes).toMatchObject({
      "gen_ai.usage.input_tokens": 8355,
      "gen_ai.usage.output_tokens": 412,
      "gen_ai.usage.total_tokens": 8767,
      "gen_ai.response.finish_reasons": ["stop"],
      "gen_ai.run.steps": 3,
      "gen_ai.run.tool_calls": 2,
      "gen_ai.run.outcome": "completed",
    });
  });

  it("attaches the thrown error to the run's own span on a failure", () => {
    const cause = new Error("gateway exploded");
    const trace = startAgentTrace(PARAMS);
    trace.finish({ status: "error", steps: 1, toolCallCount: 0, cause });

    const agent = onlySpanWithOp("gen_ai.invoke_agent");
    expect(agent.status).toEqual({ code: 2, message: "internal_error" });
    expect(withActiveSpan).toHaveBeenCalledWith(agent.handle, expect.any(Function));
    expect(captureException).toHaveBeenCalledWith(cause, expect.anything());
  });

  // A user navigating away is not a failure — the same distinction
  // `AskOutcome` exists to preserve, carried through to span status so it does
  // not inflate every error rate computed from spans either.
  it("marks an abandoned run cancelled, not errored, and captures nothing", () => {
    const trace = startAgentTrace(PARAMS);
    trace.finish({ status: "abort", steps: 2, toolCallCount: 1 });
    expect(onlySpanWithOp("gen_ai.invoke_agent").status).toEqual({ code: 2, message: "cancelled" });
    expect(captureException).not.toHaveBeenCalled();
  });

  // An errored run reaches the sink through `onError` and then `onEnd` fires
  // too; the span must record the failure, not the tidier reason after it.
  it("is a single writer — the first finish wins", () => {
    const trace = startAgentTrace(PARAMS);
    trace.finish({ status: "error", steps: 1, toolCallCount: 0, cause: new Error("boom") });
    trace.finish({ status: "completed", steps: 1, toolCallCount: 0, finishReason: "stop" });

    const agent = onlySpanWithOp("gen_ai.invoke_agent");
    expect(agent.attributes["gen_ai.run.outcome"]).toBe("error");
    expect(agent.status).toEqual({ code: 2, message: "internal_error" });
    expect(captureException).toHaveBeenCalledTimes(1);
  });

  // The header's promise, enforced rather than asserted in prose: this module
  // is called from the same end-of-turn path a streaming answer runs through,
  // so a throw here is an answer that stops mid-sentence.
  it("never throws, and still hands back a usable trace, when Sentry itself throws", () => {
    startInactiveSpan.mockImplementation(() => {
      throw new Error("no client");
    });
    const trace = startAgentTrace(PARAMS);
    expect(() => {
      trace.stepStarted();
      trace.stepEnded({ usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } });
      trace.toolExecuted({ toolName: "read_trip", durationMs: 1, ok: true });
      trace.finish({ status: "completed", steps: 1, toolCallCount: 1 });
    }).not.toThrow();
  });

  it("never throws when a span handle throws mid-run", () => {
    startInactiveSpan.mockImplementation((options: Record<string, unknown>) => {
      const handle = makeSpan(options);
      handle.setAttributes = () => {
        throw new Error("detached span");
      };
      return handle;
    });
    const trace = startAgentTrace(PARAMS);
    expect(() => {
      trace.stepStarted();
      trace.stepEnded({ usage: { inputTokens: 1, outputTokens: null, totalTokens: null } });
      trace.finish({ status: "completed", steps: 1, toolCallCount: 0 });
    }).not.toThrow();
  });

  // A provider that reports nothing must not put a `null` on the span where a
  // token count goes — a null token count reads as zero in every aggregate.
  it("omits token attributes entirely when the provider reported none", () => {
    const trace = startAgentTrace(PARAMS);
    trace.finish({
      status: "completed",
      usage: { inputTokens: null, outputTokens: null, totalTokens: null },
      steps: 1,
      toolCallCount: 0,
    });
    const attributes = onlySpanWithOp("gen_ai.invoke_agent").attributes;
    expect(attributes).not.toHaveProperty("gen_ai.usage.input_tokens");
    expect(attributes).not.toHaveProperty("gen_ai.usage.output_tokens");
    expect(attributes).not.toHaveProperty("gen_ai.usage.total_tokens");
  });

  // **The privacy rule, as a test rather than a comment** — see this module's
  // header. The types have nowhere to put a prompt, an answer or a tool
  // payload; this pins the resulting key set so adding one has to be a
  // deliberate edit here as well as there.
  it("puts no prompt, answer or tool payload on any span", () => {
    const trace = startAgentTrace(PARAMS);
    trace.stepStarted();
    trace.toolExecuted({ toolName: "read_day", toolCallId: "call_1", durationMs: 5, ok: true });
    trace.stepEnded({ usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, toolNames: ["read_day"] });
    trace.finish({ status: "completed", steps: 1, toolCallCount: 1, finishReason: "stop" });

    const keys = new Set(started.flatMap((span) => Object.keys(span.attributes)));
    expect([...keys].sort()).toEqual(
      [
        "ai.scope",
        "agent",
        "gen_ai.agent.name",
        "gen_ai.operation.name",
        "gen_ai.provider.name",
        "gen_ai.request.available_tools",
        "gen_ai.request.model",
        "gen_ai.response.finish_reasons",
        "gen_ai.response.tool_calls",
        "gen_ai.run.outcome",
        "gen_ai.run.steps",
        "gen_ai.run.tool_calls",
        "gen_ai.step",
        "gen_ai.system",
        "gen_ai.tool.call.id",
        "gen_ai.tool.name",
        "gen_ai.tool.type",
        "gen_ai.usage.input_tokens",
        "gen_ai.usage.output_tokens",
        "gen_ai.usage.total_tokens",
        "sentry.origin",
      ].sort(),
    );
  });
});

describe("traceModelCall", () => {
  it("wraps a single round-trip in a gen_ai.chat span carrying its usage", async () => {
    const result = await traceModelCall(
      { operation: "classify_intent", modelId: "anthropic/claude-haiku-4-5" },
      async () => ({ verdict: "question", tokens: 150 }),
      (r) => ({ usage: { inputTokens: r.tokens, outputTokens: 10, totalTokens: 160 }, finishReason: "stop" }),
    );

    expect(result).toEqual({ verdict: "question", tokens: 150 });
    const span = onlySpanWithOp("gen_ai.chat");
    expect(span.options.name).toBe("chat anthropic/claude-haiku-4-5");
    expect(span.ended).toBe(true);
    expect(span.attributes).toMatchObject({
      "gen_ai.operation.name": "chat",
      "gen_ai.call.purpose": "classify_intent",
      "gen_ai.usage.input_tokens": 150,
      "gen_ai.usage.total_tokens": 160,
    });
    expect(span.status).toEqual({ code: 1 });
  });

  // `generateText` with a `stopWhen` is a tool loop. Filed as a plain chat it
  // would be missing from the one Sentry view built to show agent runs.
  it("files a tool-looping call as an agent run when asked to", async () => {
    await traceModelCall(
      { operation: "plan", kind: "invoke_agent", modelId: "anthropic/claude-haiku-4-5" },
      async () => "done",
    );
    const span = onlySpanWithOp("gen_ai.invoke_agent");
    expect(span.options.name).toBe("invoke_agent anthropic/claude-haiku-4-5");
    expect(span.attributes).toMatchObject({
      "gen_ai.operation.name": "invoke_agent",
      "gen_ai.agent.name": "plan",
    });
  });

  // The contract is that this function is invisible apart from the span:
  // `classifyAskIntent` fails open on its own errors and must keep being the
  // thing that decides that.
  it("rethrows and marks the span failed", async () => {
    const boom = new Error("provider down");
    await expect(
      traceModelCall({ operation: "classify_intent", modelId: "m" }, async () => {
        throw boom;
      }),
    ).rejects.toBe(boom);

    const span = onlySpanWithOp("gen_ai.chat");
    expect(span.status).toEqual({ code: 2, message: "internal_error" });
    expect(span.ended).toBe(true);
  });

  it("returns the result even when Sentry cannot start a span at all", async () => {
    startInactiveSpan.mockImplementation(() => {
      throw new Error("no client");
    });
    await expect(traceModelCall({ operation: "x", modelId: "m" }, async () => 7)).resolves.toBe(7);
  });

  // `describe` reads a provider-shaped result; a throw in it is a telemetry
  // bug, and a telemetry bug must not turn a successful call into a failed one.
  it("returns the result when the describe callback throws", async () => {
    await expect(
      traceModelCall({ operation: "x", modelId: "m" }, async () => 7, () => {
        throw new Error("bad shape");
      }),
    ).resolves.toBe(7);
    expect(onlySpanWithOp("gen_ai.chat").ended).toBe(true);
  });
});
