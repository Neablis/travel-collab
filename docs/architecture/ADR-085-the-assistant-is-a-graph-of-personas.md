# ADR-085: The assistant is a typed graph of personas, recorded per step, and drawn from code

**Status:** **Accepted — 2026-11-01.** Mitchell answered M57's decisions D1–D8 (D2 chose to split
the trip planner now rather than measure first).
**Deciders:** Mitchell (product); Claude — drafted
Related: M57 (`docs/milestones/M57-assistant-personas.md`), the design
(`docs/specs/2026-10-30-assistant-personas-design.md`), ADR-058 (the intent pivot), ADR-062 and
M31 (the ledger), ADR-072 (palette commands), ADR-084 (`hand_off`, the capability block).

## Context

The assistant already behaves like a set of personas: a **surface** (`SURFACES`,
`apps/web/src/server/assistant/grants.ts:93`) is a toolset, the page picks it
(`resolveSurface`, `admission.ts:896`), and the caps (`grantFor`, `grants.ts:249`) decide what a
person can never reach. Moving between surfaces inside a turn exists only as two special cases in
`prepareStep` (`ai/handleAskRequest.ts:870-918`): the ADR-058 intent pivot and the
`request_change_tools` escalation. Nothing records which surface a turn or step ran on, outcomes
cannot be joined to the turn that produced them, and nothing draws the system or one turn.

## Decision

1. **A persona is a surface with edges.** `assistant/personas.ts` holds `Persona` (id, grants,
   voice, model tier floor, needs), `Edge` (`from`, `to`, `kind: "switch" | "hand-off"`, guard)
   and the entry map from page kind to persona. `SURFACES` is derived from it. The personas are
   Schedule, Discover, Page writer, Account, Playbook editor and Explorer (M57 D2). A trip or day
   page enters at Schedule.
2. **The graph is a typed adjacency map**, not a state-machine or agent-graph library. The only
   event is "switch to X" and the only guards are the existing caps (role, plan, classifier).
3. **Reachability is a generated, committed baseline**, in the pattern of
   `contextBudget.baseline.json`: per entry page and cap combination, the reachable and the
   never-reachable personas. A PR that opens or closes a path shows it in the diff. A Mermaid
   rendering is generated into `docs/architecture/` and drift-checked.
4. **One agent, one thread, one switch a turn.** The model sees `switch_persona({ to, why })`
   whose `to` is a `z.enum` of the current persona's outgoing `switch` edges only. The server
   re-checks the guard, the next step gets the new persona's tools and instruction through
   `prepareStep`, and the whole thread carries over (D3, D6). The ADR-058 pivot and the escalation
   become edges in the same graph. `hand-off` edges remain ADR-084's button.
5. **The ledger records personas and outcomes.** `ai_usage.entry_persona`;
   `ai_usage_steps.persona`, `from_persona`, `edge_kind`; capability gaps as a table; turn outcomes
   (proposal applied, suggestion accepted, hand-off pressed, carried-ask chip pressed, trip created
   from a hand-off) recorded with the server's turn id, which the stream metadata now carries.
6. **Debug views are built from code and the ledger**, for operators only (`callerIsAdmin`): a
   Debug toggle in the Ask panel (the graph from this page, tools per persona, each turn's
   breakdown) and a Personas tab in the operator console (the map with aggregates and recent
   turns). Personas are never shown to people (D4).

## Consequences

- Cost and quality per persona and per edge become SQL over our own tables, and the `ai-usage`
  skill and the console read the same columns.
- Adding a persona or an edge is a typed change with a baseline diff, a Mermaid diff and a
  `contextBudget` diff in the same PR.
- A switch costs one step; capping it at one a turn bounds that cost.
- The trip planner's split halves the tools an edit step sends, at the risk of a turn needing the
  other half; the switch edge and the eval set are how that risk is seen.
- Debug endpoints expose prompts' shapes and tool names to operators only; they never return tool
  outputs or trip contents beyond what the ledger already holds.

## Alternatives rejected

- **LangGraph.js** — replaces the AI SDK loop, streaming, model layer and the ledger instrumentation.
- **XState** — worth it only with timers, nested or parallel states; none exist.
- **Several agents talking** — multiplies tokens; one agent whose persona changes is enough.
- **Langfuse / LangSmith as the debug view** — cannot join a turn's cost to "a trip was created
  from this hand-off"; a preview-only trial stays possible later (M57 D8).
- **A summary across an edge** — an extra step that can lose detail (D6).
