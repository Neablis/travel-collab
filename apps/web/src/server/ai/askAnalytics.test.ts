import { describe, expect, it, vi } from "vitest";
import {
  createAskRecorder,
  logAskAnalytics,
  type AskAnalyticsRecord,
  type AskDroppedCall,
  type AskIntentRecord,
} from "@/server/ai/askAnalytics";
import type { TurnLedger } from "@/server/assistant/ledger";

const OFFERED = ["read_trip", "read_day", "find_free_time"];

function recorderWith(overrides: Partial<Parameters<typeof createAskRecorder>[0]> = {}) {
  const records: AskAnalyticsRecord[] = [];
  const ledgers: TurnLedger[] = [];
  let clock = 1_000;
  const recorder = createAskRecorder({
    tripId: "11111111-1111-4111-8111-111111111111",
    userId: "user-1",
    scope: { kind: "trip" },
    question: "How long is this trip?",
    turn: "opening",
    simulated: true,
    model: "simulated/no-op",
    offeredTools: OFFERED,
    // The turn's purpose, which admission resolves. `question` is the narrowest
    // and therefore the right default for a recorder fixture.
    taskClass: "question",
    sink: (record, ledger) => {
      records.push(record);
      ledgers.push(ledger);
    },
    now: () => (clock += 40),
    ...overrides,
  });
  return { recorder, records, ledgers };
}

describe("the per-ask record", () => {
  it("counts the tool calls it took to reach an answer", () => {
    const { recorder, records } = recorderWith();
    recorder.observeStep({
      toolCalls: [
        { toolName: "read_trip", input: {} },
        { toolName: "find_free_time", input: { after: "21:00" } },
      ],
    });
    recorder.observeStep({ text: "There are two free hours on day 3." });
    recorder.finish({ finishReason: "stop", usage: { inputTokens: 12, outputTokens: 34, totalTokens: 46 } });

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      event: "ai.ask",
      tripId: "11111111-1111-4111-8111-111111111111",
      userId: "user-1",
      simulated: true,
      steps: 2,
      toolCallCount: 2,
      answered: true,
      finishReason: "stop",
      usage: { inputTokens: 12, outputTokens: 34, totalTokens: 46 },
    });
    // The arguments matter as much as the names: `find_free_time` with no
    // window reads differently from one the model constrained.
    expect(records[0]!.toolCalls).toEqual([
      { name: "read_trip", input: {} },
      { name: "find_free_time", input: { after: "21:00" } },
    ]);
  });

  // ADR-022's rule for earning a tool is only enforceable if a tool nobody
  // calls is visible. This is the number that makes it so, and it is measured.
  it("reports which offered tools were never called", () => {
    const { recorder, records } = recorderWith();
    recorder.observeStep({ toolCalls: [{ toolName: "read_trip", input: {} }] });
    recorder.observeStep({ text: "Fourteen days." });
    recorder.finish({ finishReason: "stop" });

    expect(records[0]!.offeredTools).toEqual(OFFERED);
    expect(records[0]!.uncalledTools).toEqual(["read_day", "find_free_time"]);
  });

  it("reports an empty uncalled list when every tool fired", () => {
    const { recorder, records } = recorderWith();
    recorder.observeStep({ toolCalls: OFFERED.map((toolName) => ({ toolName, input: {} })) });
    recorder.observeStep({ text: "Here you go." });
    recorder.finish({ finishReason: "stop" });
    expect(records[0]!.uncalledTools).toEqual([]);
  });

  // A turn that spends steps and says nothing is the failure the sidebar shows
  // as an empty bubble, so it is recorded as a fact rather than inferred from
  // the step count.
  it("records answered: false when no step produced text", () => {
    const { recorder, records } = recorderWith();
    recorder.observeStep({ toolCalls: [{ toolName: "read_trip", input: {} }] });
    recorder.observeStep({ text: "   " });
    recorder.finish({ finishReason: "tool-calls" });
    expect(records[0]).toMatchObject({ answered: false, finishReason: "tool-calls" });
  });

  it("carries the scope, so a day-scoped turn is distinguishable in the log", () => {
    const { recorder, records } = recorderWith({ scope: { kind: "day", dayIndex: 2 } });
    recorder.finish({ finishReason: "stop" });
    expect(records[0]!.scope).toEqual({ kind: "day", dayIndex: 2 });
  });

  // The clock is read exactly twice — once when the recorder is created and
  // once when the run ends — so latency is the turn's wall time and not a
  // function of how many steps it took.
  it("measures latency across the whole turn", () => {
    const { recorder, records } = recorderWith();
    recorder.observeStep({});
    recorder.observeStep({});
    recorder.finish({ finishReason: "stop" });
    expect(records[0]!.latencyMs).toBe(40);
  });

  it("writes once, however many times the run claims to have ended", () => {
    const { recorder, records } = recorderWith();
    recorder.finish({ finishReason: "stop" });
    recorder.finish({ finishReason: "error" });
    expect(records).toHaveLength(1);
    expect(records[0]!.finishReason).toBe("stop");
  });

  it("reports null token counts rather than zeroes when the model gave none", () => {
    const { recorder, records } = recorderWith();
    recorder.finish({ finishReason: "stop" });
    expect(records[0]!.usage).toEqual({ inputTokens: null, outputTokens: null, totalTokens: null });
  });

  it("defaults to the console sink, so a real request logs without wiring", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      logAskAnalytics({
        event: "ai.ask",
        tripId: "t",
        userId: "u",
        scope: { kind: "trip" },
        question: "how does this look?",
        turn: "opening",
        simulated: true,
        model: "simulated/no-op",
        steps: 1,
        toolCalls: [],
        toolCallCount: 0,
        offeredTools: [],
        uncalledTools: [],
        classification: null,
        outcome: "completed",
        cause: null,
        answered: true,
        finishReason: "stop",
        usage: { inputTokens: null, outputTokens: null, totalTokens: null },
        usageByStep: [],
        droppedCalls: [],
        latencyMs: 1,
      });
      const [message, payload] = spy.mock.calls[0]!;
      expect(message).toBe("ai.ask");
      expect(JSON.parse(payload as string)).toMatchObject({ event: "ai.ask", tripId: "t" });
    } finally {
      spy.mockRestore();
    }
  });

  // Item 1's real bug: `console.info("ai.ask", record)` renders a tool's
  // `input` as `[Object]` past `util.inspect`'s default depth (2) — `record`
  // → `toolCalls[]` → `input` is depth 3. This calls the REAL, un-injected
  // sink (not a test's `sink: (r) => records.push(r)`) and reads exactly what
  // `console.info` was handed, because a test that only reads the record
  // object back proves nothing about what actually renders on a production
  // log line.
  it("keeps a tool's nested input legible through the real console sink", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      logAskAnalytics({
        event: "ai.ask",
        tripId: "t",
        userId: "u",
        scope: { kind: "trip" },
        question: "move things around",
        turn: "opening",
        simulated: false,
        model: "deepseek/deepseek-v4-flash-0731",
        steps: 1,
        toolCalls: [
          // Three levels deep from `record`: toolCalls[] -> input -> location.
          // util.inspect's default depth 2 renders `location` as `[Object]`.
          {
            name: "AddActivity",
            input: { title: "Gelato", dayRef: "day 1", location: { lat: 41.89, lng: 12.49 } },
          },
        ],
        toolCallCount: 1,
        offeredTools: [],
        uncalledTools: [],
        classification: null,
        outcome: "completed",
        cause: null,
        answered: true,
        finishReason: "stop",
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
        usageByStep: [{ inputTokens: 100, outputTokens: 50, totalTokens: 150 }],
        droppedCalls: [],
        latencyMs: 1,
      });
      const [, payload] = spy.mock.calls[0]!;
      // What actually reaches the log line — not the record object.
      expect(typeof payload).toBe("string");
      expect(payload as string).not.toContain("[Object]");
      expect(payload as string).toContain('"lat":41.89');
    } finally {
      spy.mockRestore();
    }
  });

  // The finding this closes: `record.toolCalls[].input` is model-supplied,
  // and `JSON.stringify` throws on a circular structure. The sink must
  // survive that AND still log something identifiable — a silent drop is as
  // bad as an uncaught throw, because `abandon("abort")` reaches this sink
  // from a raw `AbortSignal` listener (handleAskRequest.ts) that nothing in
  // this codebase wraps in its own try/catch.
  it("never throws on a circular tool input, and still logs something identifiable", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      const circular: Record<string, unknown> = { title: "Gelato" };
      circular.self = circular;

      expect(() =>
        logAskAnalytics({
          event: "ai.ask",
          tripId: "trip-with-a-bad-tool-call",
          userId: "u",
          scope: { kind: "trip" },
          question: "move things around",
          turn: "opening",
          simulated: false,
          model: "deepseek/deepseek-v4-flash-0731",
          steps: 1,
          toolCalls: [{ name: "AddActivity", input: circular }],
          toolCallCount: 1,
          offeredTools: [],
          uncalledTools: [],
          classification: null,
          outcome: "completed",
          cause: null,
          answered: true,
          finishReason: "stop",
          usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
          usageByStep: [{ inputTokens: 100, outputTokens: 50, totalTokens: 150 }],
          droppedCalls: [],
          latencyMs: 1,
        }),
      ).not.toThrow();

      expect(spy).toHaveBeenCalledTimes(1);
      const [message, payload] = spy.mock.calls[0]!;
      expect(message).toBe("ai.ask");
      const parsed = JSON.parse(payload as string) as { event: string; tripId: string; error: string };
      expect(parsed.event).toBe("ai.ask");
      expect(parsed.tripId).toBe("trip-with-a-bad-tool-call");
      expect(parsed.error).toMatch(/failed to serialize/i);
    } finally {
      spy.mockRestore();
    }
  });

  it("carries the question and distinguishes an opening turn from a follow-up", () => {
    const opening = recorderWith({ question: "how long is this trip?", turn: "opening" });
    opening.recorder.finish({ finishReason: "stop" });
    expect(opening.records[0]).toMatchObject({ question: "how long is this trip?", turn: "opening" });

    const followUp = recorderWith({ question: "and the second day?", turn: "follow-up" });
    followUp.recorder.finish({ finishReason: "stop" });
    expect(followUp.records[0]).toMatchObject({ question: "and the second day?", turn: "follow-up" });
  });

  // The prompt is already capped at MAX_PROMPT_CHARS (4000) on the wire, but a
  // page of log lines is unreadable at that length — the log's own cap is
  // much tighter (1000, Mitchell 2026-08-29 — see the constant's comment),
  // and this pins the actual number rather than trusting the comment or a
  // "got shorter" assertion loose enough to survive the cap silently
  // drifting to something else.
  it("passes a question at exactly the cap through untouched", () => {
    const atLimit = "x".repeat(1000);
    const { recorder, records } = recorderWith({ question: atLimit });
    recorder.finish({ finishReason: "stop" });
    expect(records[0]!.question).toBe(atLimit);
  });

  it("truncates a question over the cap, without touching what was asked", () => {
    const long = "x".repeat(4000); // the wire's own MAX_PROMPT_CHARS ceiling
    const { recorder, records } = recorderWith({ question: long });
    recorder.finish({ finishReason: "stop" });
    expect(records[0]!.question).toBe(`${"x".repeat(1000)}…`);
    expect(records[0]!.question.length).toBe(1001);
  });

  // The number tuning actually wants: not the run's total, but where the
  // spend comes from — a growing per-step `inputTokens` is exactly the
  // re-sent-context signature the record exists to show.
  it("collects one usage entry per step, in order", () => {
    const { recorder, records } = recorderWith();
    recorder.observeStep({ usage: { inputTokens: 1000, outputTokens: 20, totalTokens: 1020 } });
    recorder.observeStep({ usage: { inputTokens: 2200, outputTokens: 15, totalTokens: 2215 } });
    recorder.finish({ finishReason: "stop", usage: { inputTokens: 2200, outputTokens: 15, totalTokens: 2215 } });
    expect(records[0]!.usageByStep).toEqual([
      { inputTokens: 1000, outputTokens: 20, totalTokens: 1020 },
      { inputTokens: 2200, outputTokens: 15, totalTokens: 2215 },
    ]);
  });

  it("reports null step usage rather than omitting the entry when a step gave none", () => {
    const { recorder, records } = recorderWith();
    recorder.observeStep({});
    recorder.finish({ finishReason: "stop" });
    expect(records[0]!.usageByStep).toEqual([{ inputTokens: null, outputTokens: null, totalTokens: null }]);
  });

  it("carries the dropped write calls handed to finish, and defaults to none", () => {
    const { recorder, records } = recorderWith();
    recorder.finish({ finishReason: "stop" });
    expect(records[0]!.droppedCalls).toEqual([]);

    const dropped: AskDroppedCall[] = [
      { type: "RemoveActivity", code: "unresolved-ref", refs: { activityRef: "Nope" }, message: "No activity named “Nope”." },
    ];
    const second = recorderWith();
    second.recorder.finish({ finishReason: "stop" }, dropped);
    expect(second.records[0]!.droppedCalls).toEqual(dropped);
  });

  it("reports no dropped calls on an abandoned turn — nothing was ever resolved", () => {
    const { recorder, records } = recorderWith();
    recorder.abandon("abort");
    expect(records[0]!.droppedCalls).toEqual([]);
  });
});

// A live turn failed on 2026-08-29 and nothing recorded WHY: the record said
// `finishReason: "error"`, the message went to the client, and Vercel's logs
// held nothing at error, warning or fatal level. These are the assertions that
// make the next occurrence name itself.
describe("why a turn failed", () => {
  it("records the cause of an errored turn", () => {
    const { recorder, records } = recorderWith();
    recorder.observeStep({ toolCalls: [{ toolName: "read_trip", input: {} }] });
    recorder.abandon("error", new Error("Provider returned 500"));

    expect(records[0]).toMatchObject({
      outcome: "error",
      cause: { name: "Error", message: "Provider returned 500", statusCode: null },
    });
    // The trace of what the turn had already done survives the failure — the
    // whole reason to write a record for a turn that never finished.
    expect(records[0]!.toolCalls.map((c) => c.name)).toEqual(["read_trip"]);
  });

  // A 429 and a 500 read identically in a message and demand opposite
  // responses; KI-83 (the AI quota) is the local example of the first.
  it("keeps the HTTP status when the provider gave one", () => {
    const apiError = Object.assign(new Error("Too Many Requests"), {
      name: "AI_APICallError",
      statusCode: 429,
    });
    const { recorder, records } = recorderWith();
    recorder.abandon("error", apiError);
    expect(records[0]!.cause).toEqual({ name: "AI_APICallError", message: "Too Many Requests", statusCode: 429 });
  });

  // The distinction anyone counting error rates depends on. A user navigating
  // away is not a failure, and `finishReason` cannot answer this on its own —
  // it carries the model's word on a turn that completed and ours on one that
  // did not.
  it("does not read an abandoned turn as a failure", () => {
    const { recorder, records } = recorderWith();
    recorder.abandon("abort");
    expect(records[0]).toMatchObject({ outcome: "abort", cause: null, finishReason: "abort" });
  });

  it("reports a completed turn as completed, with no cause", () => {
    const { recorder, records } = recorderWith();
    recorder.finish({ finishReason: "stop" });
    expect(records[0]).toMatchObject({ outcome: "completed", cause: null });
  });

  // A provider's error text is an external string. It is bounded and stripped
  // of control characters before it reaches a log line — not because the
  // current sink could be fooled by one (`JSON.stringify` escapes them) but
  // because that is a property of today's sink and not of the string.
  it("flattens and bounds whatever the provider said", () => {
    const { recorder, records } = recorderWith();
    recorder.abandon("error", new Error(`upstream said:\n\r\tHTTP/1.1 500 ${"x".repeat(1000)}`));

    const message = records[0]!.cause!.message;
    expect(message).not.toMatch(/[\u0000-\u001f]/);
    expect(message.length).toBeLessThanOrEqual(501); // 500 + the ellipsis
    expect(message).toContain("upstream said: HTTP/1.1 500");
  });

  // `abandon` is reached from a raw `request.signal` listener that nothing
  // wraps (see handleAskRequest.ts), so describing the failure must be total —
  // including for the values a provider can actually throw.
  it("survives a thrown value that has no message and no string form", () => {
    const { recorder, records } = recorderWith();
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error("this getter always throws");
        },
      },
    );
    expect(() => recorder.abandon("error", hostile)).not.toThrow();
    expect(records[0]!.outcome).toBe("error");
    expect(records[0]!.cause).not.toBeNull();
  });

  // Mitchell searched Vercel's error, warning and fatal levels and found
  // nothing — which is where anyone triaging the next failure will look. The
  // diagnosis lives on the info record beside the question and the tool trace;
  // this line is what makes it findable.
  it("also writes a failed turn at error level, and only a failed one", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      logAskAnalytics(recordWith({ outcome: "abort", cause: null }));
      expect(error).not.toHaveBeenCalled();

      logAskAnalytics(
        recordWith({ outcome: "error", cause: { name: "AI_APICallError", message: "boom", statusCode: 503 } }),
      );
      expect(error).toHaveBeenCalledTimes(1);
      const [message, payload] = error.mock.calls[0]!;
      expect(message).toBe("ai.ask.failed");
      expect(JSON.parse(payload as string)).toMatchObject({
        tripId: "t",
        cause: { name: "AI_APICallError", message: "boom", statusCode: 503 },
      });
      // Both lines, every time: the short one is discoverability, the record
      // is the diagnosis.
      expect(info).toHaveBeenCalledTimes(2);
    } finally {
      info.mockRestore();
      error.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// The TurnLedger (ADR-043 decision 4, spec §6 / §7a)
// ---------------------------------------------------------------------------

const CLASSIFIED_BY_MODEL: AskIntentRecord = {
  taskClass: "plan",
  intent: "write",
  source: "model",
  context: null,
  model: "zai/glm-4.7-flash",
  verdict: '{"result":"plan"}',
  failedOpen: false,
  latencyMs: 180,
  usage: { inputTokens: 198, outputTokens: 49, totalTokens: 247 },
};

/** The three ways a turn can end, named so a case can pair two DIFFERENT ones. */
type EndPath = (recorder: ReturnType<typeof recorderWith>["recorder"]) => void;
const FINISHES: EndPath = (recorder) => recorder.finish({ finishReason: "stop" });
const ABORTS: EndPath = (recorder) => recorder.abandon("abort");
const ERRORS: EndPath = (recorder) => recorder.abandon("error", new Error("boom"));

describe("the turn ledger", () => {
  // **Written on all three end paths, including failure** — *"because the
  // round-trips already made were already paid for"* (M20 link 9). It is free
  // rather than new work: the recorder's single-writer latch already fires
  // exactly once on `onEnd`, abort and error, so the ledger is a fourth reader
  // of that latch rather than a fourth place that has to get once-only right.
  //
  // The second call is deliberately the OTHER end path, because that is the
  // sequence production produces: an errored run fires `onError` and then
  // `onEnd`. Calling the same callback twice tests only that one path latches
  // against itself, which a regression giving `abandon` and `finish` separate
  // latches would pass — while emitting two ledgers for one turn.
  it.each([
    ["completed", FINISHES, ERRORS],
    ["abort", ABORTS, FINISHES],
    ["error", ERRORS, FINISHES],
  ] as const)("is written exactly once on a %s turn, whichever end path follows", (outcome, end, then) => {
    const { recorder, ledgers } = recorderWith({ userId: "spender" });
    recorder.observeStep({ usage: { inputTokens: 1000, outputTokens: 100 } });
    end(recorder);
    then(recorder); // the latch: a run that both errors and ends still writes once

    expect(ledgers).toHaveLength(1);
    expect(ledgers[0]!.cost).toMatchObject({ userId: "spender", endpoint: "ask", outcome, steps: 1 });
  });

  // **Turn and classifier stay separate, permanently** (§7a rule 1). Folding
  // them would undo the reason the classifier has its own model id at all:
  // *"did the classifier save more than it cost"* is a subtraction between two
  // numbers, and it is unanswerable if there is only one.
  it("keeps the classifier's spend beside the turn's, never inside it", () => {
    const { recorder, ledgers } = recorderWith({
      model: "deepseek/deepseek-v4-flash-0731",
      classification: CLASSIFIED_BY_MODEL,
      taskClass: "plan",
    });
    recorder.finish({ finishReason: "stop", usage: { inputTokens: 3363, outputTokens: 512 } });

    expect(ledgers[0]!.cost.turn).toEqual({
      model: "deepseek/deepseek-v4-flash-0731",
      tokensIn: 3363,
      tokensOut: 512,
    });
    expect(ledgers[0]!.cost.classifier).toEqual({
      model: "zai/glm-4.7-flash",
      tokensIn: 198,
      tokensOut: 49,
    });
  });

  // The `+ 1` that used to be added by hand in the /ask sink, now structural:
  // a classification line exists if and only if a round-trip was made.
  it("has no classifier line when the affirmation rule answered without a call", () => {
    const { recorder, ledgers } = recorderWith({
      classification: {
        ...CLASSIFIED_BY_MODEL,
        source: "affirmation",
        model: null,
        verdict: "bare agreement — no model call",
        usage: { inputTokens: null, outputTokens: null, totalTokens: null },
      },
    });
    recorder.finish({ finishReason: "stop" });

    expect(ledgers[0]!.cost.classifier).toBeNull();
  });

  // Both fields the pipeline resolves and the recorder cannot: `compose` is a
  // fact about the surface, and the pinned plan version is a fact about the
  // account at the moment of the turn.
  it("carries the task class and the pinned plan version the turn ran under", () => {
    const { recorder, ledgers } = recorderWith({ taskClass: "compose", planVersionRef: "premium@v3" });
    recorder.finish({ finishReason: "stop" });

    expect(ledgers[0]!.cost.taskClass).toBe("compose");
    expect(ledgers[0]!.cost.planVersionRef).toBe("premium@v3");
  });

  // No tool declares `spend: "vendor"` yet, so an /ask turn's capacity is empty
  // — a measurement, not a placeholder. What matters is that the field exists
  // and is separate, which is where KI-93 settles.
  it("reports capacity separately from cost, and empty when nothing spent at a vendor", () => {
    const { recorder, ledgers } = recorderWith({});
    recorder.finish({ finishReason: "stop" });

    expect(ledgers[0]!.capacity).toEqual([]);
    expect(JSON.stringify(ledgers[0]!.cost)).not.toContain("locationiq");
  });

  // The log line and the settlement must not be able to disagree about one
  // turn, which is what "the record READS the ledger" buys.
  it("is the source of the record's own step count and token spend", () => {
    const { recorder, records, ledgers } = recorderWith({});
    recorder.observeStep({ usage: { inputTokens: 10, outputTokens: 1 } });
    recorder.observeStep({ usage: { inputTokens: 20, outputTokens: 2 } });
    recorder.finish({ finishReason: "stop", usage: { inputTokens: 30, outputTokens: 3, totalTokens: 33 } });

    expect(records[0]!.steps).toBe(ledgers[0]!.cost.steps);
    expect(records[0]!.usage.inputTokens).toBe(ledgers[0]!.cost.turn.tokensIn);
    expect(records[0]!.usage.outputTokens).toBe(ledgers[0]!.cost.turn.tokensOut);
  });

  // **A turn that made three calls and then died did not make them for free**
  // — M20 link 9's reason for writing the row on the failure paths at all:
  // *"the round-trips already made were already paid for"*. Neither abandoned
  // path has a provider summary to read, so the spend is the steps' own, and
  // reporting null there under-reports every failed and aborted turn.
  it.each([
    ["abort", ABORTS],
    ["error", ERRORS],
  ] as const)("bills an abandoned (%s) turn for the round-trips it already made", (_outcome, end) => {
    const { recorder, records, ledgers } = recorderWith({});
    recorder.observeStep({ usage: { inputTokens: 1000, outputTokens: 100 } });
    recorder.observeStep({ usage: { inputTokens: 1200, outputTokens: 40 } });
    end(recorder);

    expect(ledgers[0]!.cost.turn).toMatchObject({ tokensIn: 2200, tokensOut: 140 });
    expect(records[0]!.usage.inputTokens).toBe(2200);
    expect(records[0]!.usage.outputTokens).toBe(140);
  });

  // **Null keeps meaning "unknown", never zero** (spec §7a: no field may assert
  // a semantic its arithmetic does not have). A provider that reported one half
  // and not the other has told us one number, so summing must not invent a `0`
  // for the half nobody measured — and a turn that died before any step leaves
  // both unknown rather than free.
  it("sums only what a provider actually reported, and stays null for what it did not", () => {
    const partial = recorderWith({});
    partial.recorder.observeStep({ usage: { inputTokens: 900 } });
    partial.recorder.observeStep({ usage: { outputTokens: 30 } });
    partial.recorder.abandon("abort");

    expect(partial.ledgers[0]!.cost.turn).toMatchObject({ tokensIn: 900, tokensOut: 30 });

    const silent = recorderWith({});
    silent.recorder.observeStep({ finishReason: "tool-calls" });
    silent.recorder.abandon("error", new Error("boom"));

    expect(silent.ledgers[0]!.cost.turn).toMatchObject({ tokensIn: null, tokensOut: null });
  });
});

/** A minimal record, for the sink tests that care about one field of it. */
function recordWith(overrides: Partial<AskAnalyticsRecord>): AskAnalyticsRecord {
  return {
    event: "ai.ask",
    tripId: "t",
    userId: "u",
    scope: { kind: "trip" },
    question: "how does this look?",
    turn: "opening",
    simulated: true,
    model: "simulated/no-op",
    steps: 1,
    toolCalls: [],
    toolCallCount: 0,
    offeredTools: [],
    uncalledTools: [],
    classification: null,
    answered: false,
    outcome: "completed",
    cause: null,
    finishReason: "stop",
    usage: { inputTokens: null, outputTokens: null, totalTokens: null },
    usageByStep: [],
    droppedCalls: [],
    latencyMs: 1,
    ...overrides,
  };
}

// The defect this closes, measured in production on 2026-09-12. A turn died on
// a malformed `search_playbooks` argument in a step that had ALSO emitted the
// write calls; `onStepEnd` never fired for that step, so the record reported
// `toolCallCount: 3` and listed every write tool as uncalled — while the eleven
// writes it had already collected were approved by the user and applied. The
// trace claimed nothing was called by the very turn that changed the trip.
describe("an aborted step's writes are still in the record", () => {
  const collected = [
    { name: "AddDay", input: { dayRef: null } },
    { name: "AddActivity", input: { title: "Jeonju Hanok Village wander" } },
    { name: "AddActivity", input: { title: "Jeonju bibimbap for lunch" } },
  ];

  it("adds write calls the buffer kept but no step reported", () => {
    // `offeredTools` MUST carry the write tools here. With the fixture's
    // read-only default the `uncalledTools` assertions below pass whatever the
    // code does — a vacuous test of the exact field the defect corrupted.
    const { recorder, records } = recorderWith({
      offeredTools: [...OFFERED, "AddDay", "AddActivity"],
      collectedWrites: () => collected,
    });
    // The step that DID complete: reads only, exactly as production logged it.
    recorder.observeStep({ toolCalls: [{ toolName: "read_trip", input: {} }] });
    recorder.abandon("error", new Error("AI_InvalidToolInputError"));

    const record = records[0]!;
    expect(record.outcome).toBe("error");
    expect(record.toolCallCount).toBe(4);
    expect(record.toolCalls.map((c) => c.name)).toEqual(["read_trip", "AddDay", "AddActivity", "AddActivity"]);
    // The half that made the old record actively misleading.
    expect(record.uncalledTools).not.toContain("AddActivity");
    expect(record.uncalledTools).not.toContain("AddDay");
  });

  it("counts per name rather than matching by value, so identical calls both survive", () => {
    // Two AddActivity calls can carry identical arguments. A set of inputs
    // would collapse them and under-report exactly the turn this exists for.
    const twins = [
      { name: "AddActivity", input: { title: "same" } },
      { name: "AddActivity", input: { title: "same" } },
    ];
    const { recorder, records } = recorderWith({ collectedWrites: () => twins });
    recorder.abandon("error", new Error("boom"));
    expect(records[0]!.toolCalls.filter((c) => c.name === "AddActivity")).toHaveLength(2);
  });

  it("is a no-op on a healthy turn, where the steps already saw everything", () => {
    const { recorder, records } = recorderWith({ collectedWrites: () => collected });
    recorder.observeStep({ toolCalls: collected.map((c) => ({ toolName: c.name, input: c.input })) });
    recorder.finish({ text: "done" });
    expect(records[0]!.toolCallCount).toBe(3);
  });
});
