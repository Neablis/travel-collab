// **One turn's ledger, shaped as a timeline** (M57 part 5, ADR-085): the
// `ai_usage` row, its step and tool-call rows, the outcomes people reported and
// the tasks it handed off. The Ask panel's Debug breakdown and, from part 6,
// the console's Personas tab render it.
//
// **Pure, and the rows come in as plain shapes.** This file sits under the
// assistant kernel, whose import wall (eslint.config.mjs) admits no database
// and no entitlements: the read is the operator route's
// (`app/api/admin/assistant/turns/[turnId]/route.ts`), which also supplies the
// price, so the kernel holds the shape of a trace and nothing that fetches or
// prices one. Operators only: the one content-bearing column
// (`ai_capability_gaps.task`) travels in this trace, and the only route to it is
// the admin-gated endpoint.
import type { TraceToolCall, TurnTrace } from "@/lib/askDebug";

export interface TraceTurnRow {
  id: string;
  endpoint: string;
  outcome: string;
  taskClass: string;
  entryPersona: string | null;
  latencyMs: number | null;
}

export interface TraceStepRow {
  stepIndex: number;
  persona: string | null;
  fromPersona: string | null;
  edgeKind: string | null;
  model: string;
  tokensIn: number | null;
  tokensOut: number | null;
  cacheReadTokens: number | null;
  durationMs: number | null;
  finishReason: string | null;
  escalated: boolean;
  pivoted: boolean;
}

export interface TraceCallRow {
  callId: string;
  stepIndex: number | null;
  tool: string;
  outcome: string;
  durationMs: number | null;
}

export interface TraceOutcomeRow {
  kind: string;
  at: Date;
  actor: string;
}

export interface TraceGapRow {
  persona: string;
  target: string;
  task: string;
}

export interface TurnTraceRows {
  turn: TraceTurnRow;
  steps: readonly TraceStepRow[];
  calls: readonly TraceCallRow[];
  outcomes: readonly TraceOutcomeRow[];
  gaps: readonly TraceGapRow[];
}

const toCall = (call: TraceCallRow): TraceToolCall => ({
  callId: call.callId,
  tool: call.tool,
  outcome: call.outcome,
  durationMs: call.durationMs,
});

/** `price` is given the steps in order and answers micro-dollars, or null when any is unpriceable. */
export function buildTurnTrace(
  { turn, steps, calls, outcomes, gaps }: TurnTraceRows,
  price: (steps: readonly TraceStepRow[]) => number | null,
): TurnTrace {
  const ordered = [...steps].sort((a, b) => a.stepIndex - b.stepIndex);
  const known = new Set(ordered.map((step) => step.stepIndex));
  return {
    turnId: turn.id,
    endpoint: turn.endpoint,
    outcome: turn.outcome,
    taskClass: turn.taskClass,
    entryPersona: turn.entryPersona,
    latencyMs: turn.latencyMs,
    costMicroUsd: price(ordered),
    steps: ordered.map((step) => ({
      index: step.stepIndex,
      persona: step.persona,
      model: step.model,
      tokensIn: step.tokensIn,
      tokensOut: step.tokensOut,
      cacheReadTokens: step.cacheReadTokens,
      durationMs: step.durationMs,
      finishReason: step.finishReason,
      crossed: step.fromPersona === null || step.edgeKind === null ? null : { from: step.fromPersona, kind: step.edgeKind },
      escalated: step.escalated,
      pivoted: step.pivoted,
      calls: calls.filter((call) => call.stepIndex === step.stepIndex).map(toCall),
    })),
    // A call naming no step, or a step with no row, still happened.
    looseCalls: calls.filter((call) => call.stepIndex === null || !known.has(call.stepIndex)).map(toCall),
    outcomes: [...outcomes].sort((a, b) => a.at.getTime() - b.at.getTime()).map((o) => ({ kind: o.kind, at: o.at.toISOString(), actor: o.actor })),
    gaps: gaps.map((gap) => ({ persona: gap.persona, target: gap.target, task: gap.task })),
  };
}
