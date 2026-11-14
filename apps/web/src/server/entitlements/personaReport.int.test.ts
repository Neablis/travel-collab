// **The Personas tab's aggregates** (M57 part 6, ADR-085), against a real
// database: turns, switches, cost per turn, cost per successful outcome and
// unused tools, over a window, from seeded ledger and outcome rows.
//
// **Each test reads its own far-future year**, for the reason `aiModels.int.test.ts`
// gives: the report spans every account and other files write at the real `now`.
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { PersonaMapDef } from "@/lib/adminPersonas";
import { db } from "@/server/db/client";
import { aiCapabilityGaps, aiTurnOutcomes, aiUsage, aiUsageSteps, aiUsageToolCalls } from "@/server/db/schema";
import { microUsdFor } from "./modelRates";
import { personaReport } from "./personaReport";

const DAY = 24 * 60 * 60 * 1000;
const MODEL = "zai/glm-5.3-flash";

let year = 2051;
function freshNow(): Date {
  year += 1;
  return new Date(`${year}-06-30T12:00:00.000Z`);
}
const daysBefore = (now: Date, days: number) => new Date(now.getTime() - days * DAY);

interface StepSpec {
  persona: string | null;
  from?: string;
  calls?: string[];
  escalated?: boolean;
  pivoted?: boolean;
}

/** One turn: its ledger row, one priced step per spec, the calls each step made, and what people did with it. */
async function turn(
  at: Date,
  {
    entry,
    steps,
    outcomes = [],
    gaps = [],
    turnModel = MODEL,
  }: { entry: string | null; steps: StepSpec[]; outcomes?: string[]; gaps?: { persona: string; target: string }[]; turnModel?: string },
): Promise<string> {
  const id = randomUUID();
  await db.insert(aiUsage).values({
    id,
    userId: `dev-${randomUUID()}`,
    endpoint: "ask",
    outcome: "completed",
    taskClass: "question",
    turnModel,
    turnTokensIn: 1000 * steps.length,
    turnTokensOut: 50 * steps.length,
    classifierModel: null,
    classifierTokensIn: null,
    classifierTokensOut: null,
    steps: steps.length,
    planVersionRef: "plus@v1",
    latencyMs: null,
    entryPersona: entry,
    createdAt: at,
  });
  await db.insert(aiUsageSteps).values(
    steps.map((step, index) => ({
      turnId: id,
      stepIndex: index,
      model: MODEL,
      tier: "cheap",
      tokensIn: 1000,
      cacheReadTokens: null,
      cacheWriteTokens: null,
      tokensOut: 50,
      finishReason: "stop",
      escalated: step.escalated ?? false,
      pivoted: step.pivoted ?? false,
      durationMs: 10,
      provider: null,
      gatewayGenerationId: null,
      persona: step.persona,
      fromPersona: step.from ?? null,
      edgeKind: step.from === undefined ? null : "switch",
      createdAt: at,
    })),
  );
  const calls = steps.flatMap((step, stepIndex) => (step.calls ?? []).map((tool) => ({ tool, stepIndex })));
  if (calls.length > 0) {
    await db.insert(aiUsageToolCalls).values(
      calls.map((call, index) => ({
        turnId: id,
        callId: `call_${index}`,
        stepIndex: call.stepIndex,
        tool: call.tool,
        outcome: "ok",
        durationMs: 10,
        inputBytes: 10,
        outputBytes: 100,
        reachedProposal: null,
        createdAt: at,
      })),
    );
  }
  for (const kind of outcomes) await db.insert(aiTurnOutcomes).values({ id: randomUUID(), turnId: id, kind, at, actor: "someone" });
  for (const gap of gaps) {
    await db.insert(aiCapabilityGaps).values({ id: randomUUID(), turnId: id, persona: gap.persona, target: gap.target, task: "book a flight", createdAt: at });
  }
  return id;
}

const MAP: PersonaMapDef = {
  personas: [
    { id: "schedule", label: "Schedule", tools: ["read_trip", "move_stop", "search_places"], entryPages: ["trip", "day"] },
    { id: "discover", label: "Discover", tools: ["read_trip", "search_places"], entryPages: [] },
    { id: "explorer", label: "Explorer", tools: ["browse"], entryPages: ["city"] },
  ],
  edges: [
    { from: "schedule", to: "discover", kind: "switch", via: "switch_persona", guard: ["role=propose"] },
    { from: "schedule", to: "schedule", kind: "switch", via: "request_change_tools", guard: [] },
    { from: "schedule", to: "schedule", kind: "switch", via: "switch_intent", guard: [] },
    { from: "schedule", to: null, kind: "hand-off", via: "go_to", guard: [] },
    { from: "schedule", to: null, kind: "hand-off", via: "open_trip", guard: [] },
    { from: "explorer", to: null, kind: "hand-off", via: "nowhere", guard: [] },
  ],
};

describe("personaReport", () => {
  it("counts turns, switches, cost per turn and per successful outcome, and unused tools, per node and edge", async () => {
    const now = freshNow();
    const price = microUsdFor(MODEL, 1000, 50, daysBefore(now, 1))!;
    expect(price).toBeGreaterThan(0);
    // Schedule, then a switch to Discover; someone applied the proposal.
    await turn(daysBefore(now, 1), {
      entry: "schedule",
      steps: [{ persona: "schedule", calls: ["read_trip"] }, { persona: "discover", from: "schedule", calls: ["search_places"] }],
      outcomes: ["proposal_applied"],
    });
    // Schedule alone, nothing done with it.
    await turn(daysBefore(now, 2), { entry: "schedule", steps: [{ persona: "schedule", calls: ["read_trip"] }] });
    // Explorer, which handed a task off to nowhere.
    await turn(daysBefore(now, 3), { entry: "explorer", steps: [{ persona: "explorer" }], gaps: [{ persona: "explorer", target: "nowhere" }] });
    // Outside the window, and a simulated turn: neither counts.
    await turn(daysBefore(now, 60), { entry: "schedule", steps: [{ persona: "schedule" }] });
    await turn(daysBefore(now, 1), { entry: "schedule", steps: [{ persona: "schedule" }], turnModel: "simulated/no-op" });

    const report = await personaReport(MAP, 30, now);

    expect(report).toMatchObject({
      windowDays: 30,
      turns: 3,
      outcomeTurns: 1,
      switches: 1,
      costPerTurnMicroUsd: Math.round((4 * price) / 3),
      costPerOutcomeMicroUsd: 4 * price,
    });
    const node = (id: string) => report.nodes.find((n) => n.id === id)!;
    expect(node("schedule")).toMatchObject({
      turns: 2,
      switchesOut: 1,
      costPerTurnMicroUsd: Math.round((3 * price) / 2),
      costPerOutcomeMicroUsd: 3 * price,
      entryPages: ["trip", "day"],
    });
    // `search_places` was called, but by Discover's step, not Schedule's.
    expect(node("schedule").unusedTools).toEqual(["move_stop", "search_places"]);
    expect(node("discover")).toMatchObject({ turns: 0, unusedTools: ["read_trip"] });
    expect(node("explorer")).toMatchObject({ turns: 1, costPerTurnMicroUsd: price, costPerOutcomeMicroUsd: null, unusedTools: ["browse"] });

    const edge = (via: string) => report.edges.find((e) => e.via === via)!;
    expect(edge("switch_persona")).toMatchObject({ count: 1, turns: 1, costPerTurnMicroUsd: 2 * price, costPerOutcomeMicroUsd: 2 * price });
    // Nothing in this window escalated, pivoted or navigated.
    expect(edge("request_change_tools")).toMatchObject({ count: 0, turns: 0 });
    expect(edge("nowhere")).toMatchObject({ count: 1, turns: 1, costPerTurnMicroUsd: price, costPerOutcomeMicroUsd: null });

    expect(report.recent.map((r) => r.personaPath)).toEqual([["schedule", "discover"], ["schedule"], ["explorer"]]);
    expect(report.recent[0]).toMatchObject({ outcomeKinds: ["proposal_applied"], outcome: "completed", costMicroUsd: 2 * price });
  });

  it("counts self-loops from the step flags and navigation hand-offs from the tool calls", async () => {
    const now = freshNow();
    const price = microUsdFor(MODEL, 1000, 50, daysBefore(now, 1))!;
    // Escalated, then pivoted, then navigated: both flags and a go_to call on Schedule's steps.
    await turn(daysBefore(now, 1), {
      entry: "schedule",
      steps: [{ persona: "schedule", escalated: true }, { persona: "schedule", pivoted: true, calls: ["go_to"] }],
    });
    // open_trip and go_to on Schedule; a go_to by Discover's step belongs to no Schedule edge.
    await turn(daysBefore(now, 2), {
      entry: "schedule",
      steps: [{ persona: "schedule", calls: ["open_trip", "go_to"] }, { persona: "discover", from: "schedule", calls: ["go_to"] }],
    });

    const report = await personaReport(MAP, 30, now);

    const edge = (via: string) => report.edges.find((e) => e.via === via)!;
    expect(edge("request_change_tools")).toMatchObject({ count: 1, turns: 1, costPerTurnMicroUsd: 2 * price });
    expect(edge("switch_intent")).toMatchObject({ count: 1, turns: 1, costPerTurnMicroUsd: 2 * price });
    expect(edge("go_to")).toMatchObject({ count: 2, turns: 2, costPerTurnMicroUsd: 2 * price });
    expect(edge("open_trip")).toMatchObject({ count: 1, turns: 1 });
  });

  it("counts a latched escalation once, not once per later step of the turn", async () => {
    const now = freshNow();
    // request_change_tools fires at step 1; the flag stays set on steps 1 to 4.
    await turn(daysBefore(now, 1), {
      entry: "schedule",
      steps: [{ persona: "schedule" }, ...[1, 2, 3].map(() => ({ persona: "schedule", escalated: true }))],
    });

    const report = await personaReport(MAP, 30, now);

    expect(report.edges.find((e) => e.via === "request_change_tools")).toMatchObject({ count: 1, turns: 1 });
  });

  it("credits a self-loop only on the step where its flag first turns true, not on a persona switched to after it", async () => {
    const now = freshNow();
    // Discover escalated and pivoted at step 0; both flags stay latched on Schedule's step after the switch.
    await turn(daysBefore(now, 1), {
      entry: "discover",
      steps: [{ persona: "discover", escalated: true, pivoted: true }, { persona: "schedule", from: "discover", escalated: true, pivoted: true }],
    });
    // Schedule escalates at its second step, after a first step without the flag.
    await turn(daysBefore(now, 2), { entry: "schedule", steps: [{ persona: "schedule" }, { persona: "schedule", escalated: true }] });

    const report = await personaReport(MAP, 30, now);

    const edge = (via: string) => report.edges.find((e) => e.via === via)!;
    expect(edge("request_change_tools")).toMatchObject({ count: 1, turns: 1 });
    expect(edge("switch_intent")).toMatchObject({ count: 0, turns: 0 });
  });

  it("counts a turn with no entry persona, or one off the map, in an unknown row, so the rows add up to the header", async () => {
    const now = freshNow();
    const price = microUsdFor(MODEL, 1000, 50, daysBefore(now, 1))!;
    await turn(daysBefore(now, 1), { entry: "schedule", steps: [{ persona: "schedule" }] });
    await turn(daysBefore(now, 1), { entry: null, steps: [{ persona: null }], outcomes: ["proposal_applied"] });
    await turn(daysBefore(now, 2), { entry: "retired-persona", steps: [{ persona: "retired-persona" }, { persona: "schedule" }] });

    const report = await personaReport(MAP, 30, now);

    expect(report.turns).toBe(3);
    expect(report.unknown).toEqual({ turns: 2, costPerTurnMicroUsd: Math.round((3 * price) / 2), costPerOutcomeMicroUsd: 3 * price });
    expect(report.nodes.reduce((sum, node) => sum + node.turns, report.unknown.turns)).toBe(report.turns);
  });

  it("aggregates in the database: no read returns more rows than the window has turns, and the recent list is one page", async () => {
    const now = freshNow();
    // Each turn makes four calls and gets two outcomes, so a read that ships every call or outcome row returns more rows than there are turns.
    const TURNS = 30;
    for (let i = 0; i < TURNS; i += 1) {
      await turn(new Date(daysBefore(now, 1).getTime() + i * 1000), {
        entry: "schedule",
        steps: [{ persona: "schedule", calls: ["read_trip", "read_trip", "go_to", "open_trip"] }],
        outcomes: ["proposal_applied", "copied"],
        gaps: [{ persona: "schedule", target: "go_to" }],
      });
    }
    const rowCounts: number[] = [];
    const query = db.$client.query.bind(db.$client) as (...args: unknown[]) => Promise<{ rows: unknown[] }>;
    const spy = vi.spyOn(db.$client, "query").mockImplementation((async (...args: unknown[]) => {
      const result = await query(...args);
      rowCounts.push(result.rows.length);
      return result;
    }) as never);

    let report;
    try {
      report = await personaReport(MAP, 30, now);
    } finally {
      spy.mockRestore();
    }

    expect(report).toMatchObject({ turns: TURNS, outcomeTurns: TURNS });
    expect(report.recent).toHaveLength(25);
    expect(report.edges.find((e) => e.via === "go_to")).toMatchObject({ count: 2 * TURNS, turns: TURNS });
    expect(report.nodes.find((n) => n.id === "schedule")!.unusedTools).toEqual(["move_stop", "search_places"]);
    expect(rowCounts.length).toBeGreaterThan(0);
    expect(Math.max(...rowCounts)).toBeLessThanOrEqual(TURNS);
  });

  it("returns nulls, not NaN or zero, for a window with no turns", async () => {
    const report = await personaReport(MAP, 7, freshNow());

    expect(report).toMatchObject({ turns: 0, outcomeTurns: 0, switches: 0, costPerTurnMicroUsd: null, costPerOutcomeMicroUsd: null, recent: [] });
    expect(report.unknown).toEqual({ turns: 0, costPerTurnMicroUsd: null, costPerOutcomeMicroUsd: null });
    expect(report.nodes).toHaveLength(3);
    for (const stats of [...report.nodes, ...report.edges]) {
      expect(stats).toMatchObject({ turns: 0, costPerTurnMicroUsd: null, costPerOutcomeMicroUsd: null });
    }
    expect(report.nodes.find((n) => n.id === "explorer")!.unusedTools).toEqual(["browse"]);
  });

  it("narrows to the window it is asked for", async () => {
    const now = freshNow();
    await turn(daysBefore(now, 2), { entry: "schedule", steps: [{ persona: "schedule" }] });
    await turn(daysBefore(now, 20), { entry: "schedule", steps: [{ persona: "schedule" }] });

    expect((await personaReport(MAP, 7, now)).turns).toBe(1);
    expect((await personaReport(MAP, 30, now)).turns).toBe(2);
  });
});
