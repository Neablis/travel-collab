import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import type { PersonaEdge, PersonaMapDef, PersonaNode, PersonaReport, RecentTurn, TurnStats } from "@/lib/adminPersonas";
import { db } from "@/server/db/client";
import { aiCapabilityGaps, aiTurnOutcomes, aiUsage, aiUsageSteps, aiUsageToolCalls } from "@/server/db/schema";
import { microUsdForRow } from "./usage";

// **The Personas tab's one read** (M57 part 6, ADR-085), in the shape
// `aiModels.ts` reads the ledger: one window, simulated turns left out
// (`turn_model LIKE 'simulated/%'` spends nothing and its calls are scripted),
// priced per step at the rate in force when the turn ran.
//
// **The map is passed in, not imported**, for the reason `aiModelsReport` takes
// its tool names: this module knows no trip tools and no personas (ADR-045
// rule 5, and the assistant kernel's import wall). The page reads
// `personas.ts` and the registry and hands the definition; this attaches the
// window's numbers to it.
//
// **A turn belongs to the persona it entered at** (`entry_persona`), the one
// column the page decides before any switch; a switch or hand-off edge owns the
// turns that crossed it. Its cost is the whole turn's, so a turn that switched
// counts in full at its entry node and again at the edge it took: the node and
// the edge answer different questions, and their figures are not meant to add.
//
// **A successful outcome is a turn someone acted on** — any `ai_turn_outcomes`
// row, whatever its kind. An empty window, or a set with no priced turn or no
// outcome, reports null rather than a division by it or a free-looking zero.
//
// **How each edge is read**: a switch between personas is a step with a
// `from_persona`; a self-loop changes a mode, not a persona, so it is the step
// flag it sets (`escalated` is written only once `request_change_tools` has
// latched the turn's escalation, `pivoted` by `switch_intent`). A hand-off is a
// declined task (`ai_capability_gaps`, by `persona` and `target`) or a
// navigation tool call (`go_to`, `open_trip`) made at one of the persona's steps.

const DAY_MS = 24 * 60 * 60 * 1000;

/** Newest turns listed under the map. */
const RECENT_TURNS = 25;

export async function personaReport(map: PersonaMapDef, days: number, now: Date = new Date()): Promise<PersonaReport> {
  const since = new Date(now.getTime() - days * DAY_MS);
  const inWindow = and(gte(aiUsage.createdAt, since), lt(aiUsage.createdAt, now), sql`${aiUsage.turnModel} NOT LIKE 'simulated/%'`);

  const [turnRows, stepRows, callRows, outcomeRows, gapRows] = await Promise.all([
    db.select().from(aiUsage).where(inWindow).orderBy(desc(aiUsage.createdAt)),
    db.select({ step: aiUsageSteps }).from(aiUsageSteps).innerJoin(aiUsage, eq(aiUsage.id, aiUsageSteps.turnId)).where(inWindow),
    db
      .select({ turnId: aiUsageToolCalls.turnId, stepIndex: aiUsageToolCalls.stepIndex, tool: aiUsageToolCalls.tool, outcome: aiUsageToolCalls.outcome })
      .from(aiUsageToolCalls)
      .innerJoin(aiUsage, eq(aiUsage.id, aiUsageToolCalls.turnId))
      .where(inWindow),
    db
      .select({ turnId: aiTurnOutcomes.turnId, kind: aiTurnOutcomes.kind })
      .from(aiTurnOutcomes)
      .innerJoin(aiUsage, eq(aiUsage.id, aiTurnOutcomes.turnId))
      .where(inWindow),
    db
      .select({ turnId: aiCapabilityGaps.turnId, persona: aiCapabilityGaps.persona, target: aiCapabilityGaps.target })
      .from(aiCapabilityGaps)
      .innerJoin(aiUsage, eq(aiUsage.id, aiCapabilityGaps.turnId))
      .where(inWindow),
  ]);
  const steps = stepRows.map((row) => row.step);

  const stepsOf = new Map<string, (typeof steps)[number][]>();
  for (const step of steps) stepsOf.set(step.turnId, [...(stepsOf.get(step.turnId) ?? []), step]);
  const kindsOf = new Map<string, string[]>();
  for (const outcome of outcomeRows) kindsOf.set(outcome.turnId, [...(kindsOf.get(outcome.turnId) ?? []), outcome.kind]);

  const cost = new Map<string, number | null>(
    turnRows.map((turn) => [turn.id, microUsdForRow(turn, undefined, undefined, stepsOf.get(turn.id) ?? [])]),
  );

  const statsOf = (turnIds: ReadonlySet<string>): TurnStats => {
    let priced = 0;
    let total = 0;
    let acted = 0;
    for (const id of turnIds) {
      const c = cost.get(id) ?? null;
      if (c !== null) {
        priced += 1;
        total += c;
      }
      if (kindsOf.has(id)) acted += 1;
    }
    return {
      turns: turnIds.size,
      costPerTurnMicroUsd: priced === 0 ? null : Math.round(total / priced),
      costPerOutcomeMicroUsd: acted === 0 ? null : Math.round(total / acted),
    };
  };

  // Step personas, to attribute a tool call to the persona whose step made it.
  const personaAt = new Map(steps.map((step) => [`${step.turnId}:${step.stepIndex}`, step.persona]));
  const toolsCalledAs = new Map<string, Set<string>>();
  const calls: { turnId: string; persona: string; tool: string; outcome: string }[] = [];
  for (const call of callRows) {
    const persona = call.stepIndex === null ? null : personaAt.get(`${call.turnId}:${call.stepIndex}`);
    if (persona === null || persona === undefined) continue;
    toolsCalledAs.set(persona, (toolsCalledAs.get(persona) ?? new Set()).add(call.tool));
    calls.push({ turnId: call.turnId, persona, tool: call.tool, outcome: call.outcome });
  }

  const crossings = steps.filter((step) => step.edgeKind === "switch" && step.fromPersona !== null && step.persona !== null);

  const nodes: PersonaNode[] = map.personas.map((persona) => {
    const entered = new Set(turnRows.filter((turn) => turn.entryPersona === persona.id).map((turn) => turn.id));
    const called = toolsCalledAs.get(persona.id);
    return {
      ...persona,
      ...statsOf(entered),
      switchesOut: crossings.filter((step) => step.fromPersona === persona.id && step.persona !== persona.id).length,
      unusedTools: persona.tools.filter((tool) => !called?.has(tool)),
    };
  });

  const edges: PersonaEdge[] = map.edges.map((edge) => {
    const taken =
      edge.kind === "switch"
        ? edge.from === edge.to
          ? // The flags latch onto every later step of a turn, so count the turn once (the edge fixes the persona).
            [
              ...new Set(
                steps
                  .filter((step) => step.persona === edge.from && (edge.via === "request_change_tools" ? step.escalated : edge.via === "switch_intent" && step.pivoted))
                  .map((step) => step.turnId),
              ),
            ]
          : crossings.filter((step) => step.fromPersona === edge.from && step.persona === edge.to).map((step) => step.turnId)
        : [
            ...gapRows.filter((gap) => gap.persona === edge.from && gap.target === edge.via).map((gap) => gap.turnId),
            ...calls.filter((call) => call.persona === edge.from && call.tool === edge.via && call.outcome === "ok").map((call) => call.turnId),
          ];
    return { ...edge, ...statsOf(new Set(taken)), count: taken.length };
  });

  const recent: RecentTurn[] = turnRows.slice(0, RECENT_TURNS).map((turn) => {
    const path = [...(stepsOf.get(turn.id) ?? [])]
      .sort((a, b) => a.stepIndex - b.stepIndex)
      .flatMap((step) => (step.persona === null ? [] : [step.persona]))
      .filter((persona, i, all) => i === 0 || persona !== all[i - 1]);
    return {
      turnId: turn.id,
      at: turn.createdAt.toISOString(),
      personaPath: path.length > 0 ? path : turn.entryPersona === null ? [] : [turn.entryPersona],
      outcome: turn.outcome,
      outcomeKinds: kindsOf.get(turn.id) ?? [],
      costMicroUsd: cost.get(turn.id) ?? null,
    };
  });

  return {
    windowDays: days,
    ...statsOf(new Set(turnRows.map((turn) => turn.id))),
    outcomeTurns: turnRows.filter((turn) => kindsOf.has(turn.id)).length,
    switches: crossings.length,
    nodes,
    edges,
    recent,
  };
}
