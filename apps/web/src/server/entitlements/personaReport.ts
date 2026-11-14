import { and, desc, eq, gte, inArray, isNotNull, lt, sql } from "drizzle-orm";
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
// A turn whose entry persona is null, or names no node on the map, counts in
// `unknown`, so the nodes and `unknown` add up to the header's turns
// (KI-2026-11-01-z).
//
// **A successful outcome is a turn someone acted on** — any `ai_turn_outcomes`
// row, whatever its kind. An empty window, or a set with no priced turn or no
// outcome, reports null rather than a division by it or a free-looking zero.
//
// **How each edge is read**: a switch between personas is a step with a
// `from_persona`; a self-loop changes a mode, not a persona, so it is the step
// flag it sets (`escalated` is written once `request_change_tools` has latched
// the turn's escalation, `pivoted` by `switch_intent`). A flag stays set on
// every later step, including the steps of a persona switched to afterwards,
// so a self-loop is credited only at the step where its flag first turns true
// (KI-2026-11-01-z). A hand-off is a declined task (`ai_capability_gaps`, by
// `persona` and `target`) or a navigation tool call (`go_to`, `open_trip`)
// made at one of the persona's steps.
//
// **Counted in the database, priced here** (KI-2026-11-01-y). Tool calls,
// outcomes, gaps and edge crossings are grouped in SQL (by persona, by edge
// kind), each group carrying only the ids of the turns that took it, so no
// call, outcome or gap row reaches Node. Steps are read as rows, narrowed to
// the columns pricing and the persona path read, for the reason `aiModels.ts`
// gives: the rate record is a committed file and each step is rounded on its
// own, so summing tokens in SQL would move a cost off Financial's. Outcome
// kinds are read for the recent-turns page only.

const DAY_MS = 24 * 60 * 60 * 1000;

/** Newest turns listed under the map. */
const RECENT_TURNS = 25;

/** One SQL group of edge crossings: how often it was taken, and by which turns. */
interface EdgeGroup {
  kind: "switch" | "flag" | "hand-off";
  /** The persona the edge leaves. */
  persona: string;
  /** The persona switched to, the flag's tool, or the hand-off's target or tool. */
  key: string;
  taken: number;
  turnIds: string[];
}

/** The persona map for the last `days` days, with per-persona and per-edge turn and cost figures and the newest turns. */
export async function personaReport(map: PersonaMapDef, days: number, now: Date = new Date()): Promise<PersonaReport> {
  const since = new Date(now.getTime() - days * DAY_MS);
  const inWindow = and(gte(aiUsage.createdAt, since), lt(aiUsage.createdAt, now), sql`${aiUsage.turnModel} NOT LIKE 'simulated/%'`);
  const handOffVias = [...new Set(map.edges.filter((edge) => edge.kind === "hand-off").map((edge) => edge.via))];

  const [turnRows, steps, calledRows, switchAndFlagRows, gapRows, navRows] = await Promise.all([
    db
      .select({
        id: aiUsage.id,
        createdAt: aiUsage.createdAt,
        outcome: aiUsage.outcome,
        entryPersona: aiUsage.entryPersona,
        turnModel: aiUsage.turnModel,
        turnTokensIn: aiUsage.turnTokensIn,
        turnTokensOut: aiUsage.turnTokensOut,
        classifierModel: aiUsage.classifierModel,
        classifierTokensIn: aiUsage.classifierTokensIn,
        classifierTokensOut: aiUsage.classifierTokensOut,
        // Spelled out: in a one-table select Drizzle renders `aiUsage.id` as a bare "id", which the subquery reads as the outcome's own.
        acted: sql<boolean>`exists (select 1 from ai_turn_outcomes o where o.turn_id = ai_usage.id)`,
      })
      .from(aiUsage)
      .where(inWindow)
      .orderBy(desc(aiUsage.createdAt)),
    db
      .select({
        turnId: aiUsageSteps.turnId,
        stepIndex: aiUsageSteps.stepIndex,
        persona: aiUsageSteps.persona,
        model: aiUsageSteps.model,
        tokensIn: aiUsageSteps.tokensIn,
        cacheReadTokens: aiUsageSteps.cacheReadTokens,
        cacheWriteTokens: aiUsageSteps.cacheWriteTokens,
        tokensOut: aiUsageSteps.tokensOut,
      })
      .from(aiUsageSteps)
      .innerJoin(aiUsage, eq(aiUsage.id, aiUsageSteps.turnId))
      .where(inWindow),
    // Which tools each persona's steps called: one row per persona and tool.
    db
      .select({ persona: sql<string>`${aiUsageSteps.persona}`, tool: aiUsageToolCalls.tool })
      .from(aiUsageToolCalls)
      .innerJoin(aiUsageSteps, and(eq(aiUsageSteps.turnId, aiUsageToolCalls.turnId), eq(aiUsageSteps.stepIndex, aiUsageToolCalls.stepIndex)))
      .innerJoin(aiUsage, eq(aiUsage.id, aiUsageToolCalls.turnId))
      .where(and(inWindow, isNotNull(aiUsageSteps.persona)))
      .groupBy(aiUsageSteps.persona, aiUsageToolCalls.tool),
    // Switches by (from, to), and self-loops at the step whose flag the previous step did not have.
    db.execute<{ kind: "switch" | "flag"; persona: string; key: string; taken: number; turn_ids: string[] }>(sql`
      with s as (
        select st.turn_id, st.persona, st.from_persona, st.edge_kind, st.escalated, st.pivoted,
          coalesce(lag(st.escalated) over t, false) as was_escalated,
          coalesce(lag(st.pivoted) over t, false) as was_pivoted
        from ${aiUsageSteps} st
        join ${aiUsage} on ${aiUsage.id} = st.turn_id
        where ${inWindow}
        window t as (partition by st.turn_id order by st.step_index)
      )
      select 'switch' as kind, from_persona as persona, persona as key, count(*)::int as taken, array_agg(distinct turn_id::text) as turn_ids
        from s where edge_kind = 'switch' and from_persona is not null and persona is not null
        group by from_persona, persona
      union all
      select 'flag', persona, 'request_change_tools', count(*)::int, array_agg(distinct turn_id::text)
        from s where escalated and not was_escalated and persona is not null
        group by persona
      union all
      select 'flag', persona, 'switch_intent', count(*)::int, array_agg(distinct turn_id::text)
        from s where pivoted and not was_pivoted and persona is not null
        group by persona
    `),
    db
      .select({
        persona: aiCapabilityGaps.persona,
        target: aiCapabilityGaps.target,
        taken: sql<number>`count(*)::int`,
        turnIds: sql<string[]>`array_agg(${aiCapabilityGaps.turnId}::text)`,
      })
      .from(aiCapabilityGaps)
      .innerJoin(aiUsage, eq(aiUsage.id, aiCapabilityGaps.turnId))
      .where(inWindow)
      .groupBy(aiCapabilityGaps.persona, aiCapabilityGaps.target),
    handOffVias.length === 0
      ? Promise.resolve([])
      : db
          .select({
            persona: sql<string>`${aiUsageSteps.persona}`,
            tool: aiUsageToolCalls.tool,
            taken: sql<number>`count(*)::int`,
            turnIds: sql<string[]>`array_agg(${aiUsageToolCalls.turnId}::text)`,
          })
          .from(aiUsageToolCalls)
          .innerJoin(aiUsageSteps, and(eq(aiUsageSteps.turnId, aiUsageToolCalls.turnId), eq(aiUsageSteps.stepIndex, aiUsageToolCalls.stepIndex)))
          .innerJoin(aiUsage, eq(aiUsage.id, aiUsageToolCalls.turnId))
          .where(and(inWindow, isNotNull(aiUsageSteps.persona), eq(aiUsageToolCalls.outcome, "ok"), inArray(aiUsageToolCalls.tool, handOffVias)))
          .groupBy(aiUsageSteps.persona, aiUsageToolCalls.tool),
  ]);

  const groups: EdgeGroup[] = [
    ...switchAndFlagRows.rows.map((row) => ({ kind: row.kind, persona: row.persona, key: row.key, taken: row.taken, turnIds: row.turn_ids })),
    ...gapRows.map((row) => ({ kind: "hand-off" as const, persona: row.persona, key: row.target, taken: row.taken, turnIds: row.turnIds })),
    ...navRows.map((row) => ({ kind: "hand-off" as const, persona: row.persona, key: row.tool, taken: row.taken, turnIds: row.turnIds })),
  ];

  const stepsOf = new Map<string, (typeof steps)[number][]>();
  for (const step of steps) stepsOf.set(step.turnId, [...(stepsOf.get(step.turnId) ?? []), step]);
  const cost = new Map<string, number | null>(
    turnRows.map((turn) => [turn.id, microUsdForRow(turn, undefined, undefined, stepsOf.get(turn.id) ?? [])]),
  );
  const acted = new Set(turnRows.filter((turn) => turn.acted).map((turn) => turn.id));

  const statsOf = (turnIds: ReadonlySet<string>): TurnStats => {
    let priced = 0;
    let total = 0;
    let actedOn = 0;
    for (const id of turnIds) {
      const c = cost.get(id) ?? null;
      if (c !== null) {
        priced += 1;
        total += c;
      }
      if (acted.has(id)) actedOn += 1;
    }
    return {
      turns: turnIds.size,
      costPerTurnMicroUsd: priced === 0 ? null : Math.round(total / priced),
      costPerOutcomeMicroUsd: actedOn === 0 ? null : Math.round(total / actedOn),
    };
  };

  const toolsCalledAs = new Map<string, Set<string>>();
  for (const { persona, tool } of calledRows) toolsCalledAs.set(persona, (toolsCalledAs.get(persona) ?? new Set()).add(tool));
  const switches = groups.filter((group) => group.kind === "switch");
  const mapped = new Set(map.personas.map((persona) => persona.id));

  const nodes: PersonaNode[] = map.personas.map((persona) => {
    const entered = new Set(turnRows.filter((turn) => turn.entryPersona === persona.id).map((turn) => turn.id));
    const called = toolsCalledAs.get(persona.id);
    return {
      ...persona,
      ...statsOf(entered),
      switchesOut: switches.filter((group) => group.persona === persona.id && group.key !== persona.id).reduce((sum, group) => sum + group.taken, 0),
      unusedTools: persona.tools.filter((tool) => !called?.has(tool)),
    };
  });

  const edges: PersonaEdge[] = map.edges.map((edge) => {
    const kind = edge.kind === "hand-off" ? "hand-off" : edge.from === edge.to ? "flag" : "switch";
    const key = kind === "switch" ? edge.to : edge.via;
    // A flag group's key is the tool that sets it, so a self-loop whose tool sets no flag matches nothing.
    const taken = groups.filter((group) => group.kind === kind && group.persona === edge.from && group.key === key);
    return {
      ...edge,
      ...statsOf(new Set(taken.flatMap((group) => group.turnIds))),
      count: taken.reduce((sum, group) => sum + group.taken, 0),
    };
  });

  const page = turnRows.slice(0, RECENT_TURNS);
  const kindRows =
    page.length === 0
      ? []
      : await db
          .select({ turnId: aiTurnOutcomes.turnId, kinds: sql<string[]>`array_agg(${aiTurnOutcomes.kind} order by ${aiTurnOutcomes.at})` })
          .from(aiTurnOutcomes)
          .where(inArray(aiTurnOutcomes.turnId, page.map((turn) => turn.id)))
          .groupBy(aiTurnOutcomes.turnId);
  const kindsOf = new Map(kindRows.map((row) => [row.turnId, row.kinds]));

  const recent: RecentTurn[] = page.map((turn) => {
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
    outcomeTurns: acted.size,
    switches: switches.reduce((sum, group) => sum + group.taken, 0),
    nodes,
    unknown: statsOf(new Set(turnRows.filter((turn) => turn.entryPersona === null || !mapped.has(turn.entryPersona)).map((turn) => turn.id))),
    edges,
    recent,
  };
}
