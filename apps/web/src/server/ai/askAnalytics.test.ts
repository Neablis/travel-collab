import { describe, expect, it, vi } from "vitest";
import { createAskRecorder, logAskAnalytics, type AskAnalyticsRecord } from "@/server/ai/askAnalytics";

const OFFERED = ["read_trip", "read_day", "find_free_time"];

function recorderWith(overrides: Partial<Parameters<typeof createAskRecorder>[0]> = {}) {
  const records: AskAnalyticsRecord[] = [];
  let clock = 1_000;
  const recorder = createAskRecorder({
    tripId: "11111111-1111-4111-8111-111111111111",
    userId: "user-1",
    scope: { kind: "trip" },
    simulated: true,
    model: "simulated/no-op",
    offeredTools: OFFERED,
    sink: (record) => records.push(record),
    now: () => (clock += 40),
    ...overrides,
  });
  return { recorder, records };
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
        simulated: true,
        model: "simulated/no-op",
        steps: 1,
        toolCalls: [],
        toolCallCount: 0,
        offeredTools: [],
        uncalledTools: [],
        answered: true,
        finishReason: "stop",
        usage: { inputTokens: null, outputTokens: null, totalTokens: null },
        latencyMs: 1,
      });
      expect(spy).toHaveBeenCalledWith("ai.ask", expect.objectContaining({ event: "ai.ask" }));
    } finally {
      spy.mockRestore();
    }
  });
});
