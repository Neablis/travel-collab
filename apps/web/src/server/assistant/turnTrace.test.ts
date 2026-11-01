import { describe, expect, it } from "vitest";
import { buildTurnTrace, type TurnTraceRows } from "./turnTrace";

// The breakdown row under an assistant turn reads this (M57 part 5). What it
// protects: a step timeline that put a call under the wrong step, lost the
// switch that a step came in by, or priced a turn at its first model would show
// an operator a turn that did not happen.
const TURN = "11111111-1111-4111-8111-111111111111";
const MODEL = "deepseek/deepseek-v4-flash-0731";
const AT = new Date("2026-11-01T10:00:00Z");

function rows(): TurnTraceRows {
  return {
    turn: { id: TURN, endpoint: "ask", outcome: "completed", taskClass: "plan", entryPersona: "schedule", latencyMs: 4200 },
    steps: [
      { stepIndex: 1, persona: "discover", fromPersona: "schedule", edgeKind: "switch", model: MODEL, tokensIn: 60, tokensOut: 5, cacheReadTokens: 40, durationMs: 900, finishReason: "stop", escalated: false, pivoted: false },
      { stepIndex: 0, persona: "schedule", fromPersona: null, edgeKind: null, model: MODEL, tokensIn: 40, tokensOut: 15, cacheReadTokens: 0, durationMs: 3300, finishReason: "tool-calls", escalated: false, pivoted: false },
    ],
    calls: [
      { callId: "c2", stepIndex: 1, tool: "search_places", outcome: "failed", durationMs: 800 },
      { callId: "c1", stepIndex: 0, tool: "switch_persona", outcome: "ok", durationMs: 2 },
      { callId: "c3", stepIndex: null, tool: "read_trip", outcome: "unfinished", durationMs: null },
    ],
    outcomes: [{ kind: "proposal_applied", at: AT, actor: "dev-a" }],
    gaps: [{ persona: "discover", target: "nowhere", task: "book a flight" }],
  };
}

// Encodes the first step's index: what matters here is that the builder hands the
// price its steps in order, not what a model costs (the route test prices a
// real ledger).
const price = (steps: readonly { stepIndex: number }[]) => steps[0]!.stepIndex * 1000 + steps.length;

describe("buildTurnTrace", () => {
  it("orders steps by index and files each call under the step that made it", () => {
    const trace = buildTurnTrace(rows(), price);
    expect(trace.steps.map((step) => [step.index, step.persona, step.calls.map((call) => `${call.tool}:${call.outcome}`)])).toEqual([
      [0, "schedule", ["switch_persona:ok"]],
      [1, "discover", ["search_places:failed"]],
    ]);
    expect(trace.looseCalls.map((call) => call.tool)).toEqual(["read_trip"]);
  });

  it("keeps the edge a step came in by, and none on the steps that crossed nothing", () => {
    const trace = buildTurnTrace(rows(), price);
    expect(trace.steps.map((step) => step.crossed)).toEqual([null, { from: "schedule", kind: "switch" }]);
  });

  it("carries the turn's outcomes and handed-off tasks, and prices the ordered steps", () => {
    const trace = buildTurnTrace(rows(), price);
    expect(trace.outcomes).toEqual([{ kind: "proposal_applied", at: AT.toISOString(), actor: "dev-a" }]);
    expect(trace.gaps).toEqual([{ persona: "discover", target: "nowhere", task: "book a flight" }]);
    expect(trace.costMicroUsd).toBe(2);
    expect(trace.entryPersona).toBe("schedule");
  });
});
