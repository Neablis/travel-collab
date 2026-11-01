// **The Personas tab's aggregates** (M57 part 6, ADR-085), against a real
// database: turns, switches, cost per turn, cost per successful outcome and
// unused tools, over a window, from seeded ledger and outcome rows.
//
// **Each test reads its own far-future year**, for the reason `aiModels.int.test.ts`
// gives: the report spans every account and other files write at the real `now`.
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
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
      escalated: false,
      pivoted: false,
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
    expect(node("explorer")).toMatchObject({ turns: 1, costPerTurnMicroUsd: price, costPerOutcomeMicroUsd: 0, unusedTools: ["browse"] });

    const edge = (via: string) => report.edges.find((e) => e.via === via)!;
    expect(edge("switch_persona")).toMatchObject({ count: 1, turns: 1, costPerTurnMicroUsd: 2 * price, costPerOutcomeMicroUsd: 2 * price });
    // A self-loop is a mode change inside one persona: the ledger cannot see it.
    expect(edge("request_change_tools")).toMatchObject({ count: 0, turns: 0 });
    expect(edge("nowhere")).toMatchObject({ count: 1, turns: 1, costPerTurnMicroUsd: price, costPerOutcomeMicroUsd: 0 });

    expect(report.recent.map((r) => r.personaPath)).toEqual([["schedule", "discover"], ["schedule"], ["explorer"]]);
    expect(report.recent[0]).toMatchObject({ outcomeKinds: ["proposal_applied"], outcome: "completed", costMicroUsd: 2 * price });
  });

  it("returns zeros, not NaN, for a window with no turns", async () => {
    const report = await personaReport(MAP, 7, freshNow());

    expect(report).toMatchObject({ turns: 0, outcomeTurns: 0, switches: 0, costPerTurnMicroUsd: 0, costPerOutcomeMicroUsd: 0, recent: [] });
    expect(report.nodes).toHaveLength(3);
    for (const stats of [...report.nodes, ...report.edges]) {
      expect(stats).toMatchObject({ turns: 0, costPerTurnMicroUsd: 0, costPerOutcomeMicroUsd: 0 });
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
