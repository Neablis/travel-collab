# M57 — The assistant is a graph of personas, and you can watch it work

**Status (2026-11-01): scoped, current.** Minted and placed **ahead of M44** the same day by
Mitchell, choosing it from the candidate list: *"Let's take on #3, 'Strategic for the assistant:
personas'. Remember that as part of this I want to be able to visualize how the agent performed
through its personas in like a debug mode so I can see how well it's working. It should be
possible to see the state tree from a page and the tools available, then break down after agent
run how it did."* (see `docs/milestones/README.md`, *2026-11-01 — minted and placed: M57*).
The design is `docs/specs/2026-10-30-assistant-personas-design.md`; the decisions below change it
where they say so. The mechanisms are **ADR-085**. Six parts and part 0, which merges last. The
plan is `docs/plans/2026-11-01-M57-assistant-personas.md`.

## Why this exists

Most of a persona system is already in the code under other names (the spec's *What exists
today*): a **surface** is a persona's toolset (`SURFACES`, `apps/web/src/server/assistant/grants.ts:93`,
nine rows), the starting page picks it (`resolveSurface`, `admission.ts:896`), the caps decide
what a person can never reach (`grantFor`, `grants.ts:249`), and two narrow in-turn switches exist
as special cases in `prepareStep` (`handleAskRequest.ts:870-918`: the ADR-058 intent pivot and
`request_change_tools` escalation). What is missing:

1. **Surfaces have no edges.** Moving between them is navigation or M56's `hand_off`.
2. **The ledger does not know the surface.** `ai_usage`, `ai_usage_steps` and
   `ai_usage_tool_calls` (`db/schema.ts:1506-1642`) have no surface column; cost per persona cannot
   be asked of the database.
3. **Outcomes are thin and unjoinable.** A proposal applied is logged, but its `proposalId` is a
   random UUID, not the turn id. A suggestion accepted, a hand-off pressed and a carried-ask chip
   pressed never reach the server with a turn attached. The server's turn id is not sent to the
   client at all.
4. **Nothing draws the system, and nothing shows one turn.** There is no graph view and no
   per-turn trace view; the operator console's AI models tab has no surface dimension.

And the cost case: `trip · edit` sends 23 tools, 31,630 chars, on every edit step
(`ai/contextBudget.baseline.json`). Splitting the trip planner sends each step half of them.

## Decisions

Asked and answered 2026-11-01, in this session, each with a recommendation.

- **D1 — Debug mode lives in both places.** *(Recommended; chosen.)* An **operator-only Debug
  toggle in the Ask panel** on any page shows (a) the persona graph from this page's entry
  persona, with what is reachable and what is not under the viewer's caps, (b) the tools each
  persona offers, and (c) **after every run, that turn's breakdown**: each step's persona, the
  tools offered and called with outcome and duration, tokens and cache hits, cost, the switch or
  hand-off taken, and the turn's outcome. The **operator console gains a Personas tab**: the whole
  map, overlaid with aggregates for a time window (turns per persona, switches per edge, cost per
  turn and per successful outcome, tools offered and never called, hand-offs to *nowhere*), and a
  recent-turns list that opens the same breakdown.
- **D2 — Five personas, and the trip planner splits now.** *(Mitchell chose the split over the
  recommendation to measure first.)* The personas are **Schedule** and **Discover** (the trip
  planner, over the trip and day surfaces), **Page writer** (page), **Account** (account),
  **Playbook editor** (playbook, playbook-day) and **Explorer** (discover, city, tag): six ids.
  Schedule holds the tools that retime, re-order, move and remove stops and find free time;
  Discover holds the tools that find places and playbook days and add them. The exact tool lists
  are settled in part 4 from the `contextBudget` numbers, and recorded here at the close. A trip
  or day page enters at **Schedule**.
- **D3 — One switch per turn.** *(Recommended; chosen.)* Like ADR-058's pivot. A second need
  becomes a hand-off or the next turn.
- **D4 — Personas are internal.** *(Recommended; chosen.)* Visible only in debug mode; the person
  sees one assistant, as today.
- **D5 — M56's D1 stands.** *(Recommended; chosen.)* No trip-starting persona; New trip stays a
  deterministic picker, reached through the existing `hand_off` with carried asks.
- **D6 — The whole thread crosses an edge.** *(Recommended; chosen.)* A switch changes tools and
  instruction, not the conversation; the thread store and prompt cache keep working.
- **D7 — Operators only.** *(Recommended; chosen.)* Debug mode and its endpoints use the operator
  console's gate (`callerIsAdmin`, `server/entitlements/admin.ts:130`; `requireAdminApi`), and a
  non-operator gets no toggle and a 404.
- **D8 — No Langfuse trial in this milestone.** *(Recommended; chosen.)* The views are built from
  our own ledger, the only place that can join a turn's cost to its outcome. Sentry keeps the
  `gen_ai` spans.

Settled by the spec and not asked again: the graph is a **typed adjacency map**, not XState or
LangGraph; orchestration stays the Vercel AI SDK's `prepareStep`; the model sees one tool,
`switch_persona`, whose `to` is an enum of only the current persona's outgoing `switch` edges;
`hand-off` edges stay M56's button. The graph view is drawn without a new graph library unless
part 5's builder shows one is needed (none is installed today; `recharts` is).

## Scope

1. **The graph** — `assistant/personas.ts` becomes the source of truth for the personas, their
   grants, entries and edges; `SURFACES` is derived from it with **no behaviour change**
   (`contextBudget.baseline.json` unchanged). A generated reachability baseline pins, per entry
   page and per cap combination, which personas are reachable and which never are. A generated
   Mermaid file in `docs/architecture/` is drift-checked.
2. **The ledger knows the persona** — `ai_usage.entry_persona`, `ai_usage_steps.persona`, and a
   transition marker on a step (`from_persona`, `edge_kind`); `ai.capability_gap` becomes a table;
   the server's turn id reaches the client in the stream metadata.
3. **Outcomes** — a turn's outcomes are recorded with its turn id: proposal applied, suggestion
   accepted, hand-off pressed, carried-ask chip pressed, trip created from a hand-off.
4. **Switching** — `switch_persona`; the ADR-058 pivot and the escalation become ordinary edges;
   the trip planner splits into Schedule and Discover; one switch per turn; the whole thread.
5. **Debug mode in the Ask panel** — D1 (a) to (c), operators only.
6. **The console's Personas tab** — D1's map, aggregates and recent turns.

## Out of scope

- A trip-starting persona (D5), a visible persona label (D4), more than one switch a turn (D3).
- A summarising hand-over between personas (D6).
- Langfuse, LangSmith or any vendor trace viewer (D8); XState or LangGraph.
- Splitting any persona other than the trip planner.
- Personas for the MCP connector (M55); it keeps its own tool surface.

## Exit gate

Ticked at the close, on part 0. CI is the `ci` run on each part's final PR head. "Seen red" is the
part's PR body's red-first table: the source edit and the failure text.

- [ ] **Decisions D1–D8 are answered and recorded here**, and ADR-085 is written.
- [ ] **`personas.ts` is the one source of the personas**, `SURFACES` is derived from it, and part
      1 changes no `contextBudget` shape. Seen red.
- [ ] **Reachability is a test.** A generated baseline pins the reachable and never-reachable
      personas per entry page and cap combination; a test asserts every persona is reachable from
      some entry, a viewer never reaches a `propose` persona, every hand-off target exists, and no
      `switch` edge leads to a persona whose needs its source cannot meet. The Mermaid file is
      generated and drift-checked. Seen red.
- [ ] **Every ledger turn carries its entry persona and every step its persona**, a switch step
      its transition, and capability gaps are rows; migration applied to production by
      `migrate-production`. Int test seen red.
- [ ] **A turn's outcomes join to it**: proposal applied, suggestion accepted, hand-off pressed,
      carried-ask chip pressed and trip created from a hand-off each record the turn id. Seen red.
- [ ] **`switch_persona` offers only legal edges and at most one a turn**; the server re-checks the
      guard and records the transition; the pivot and escalation are edges, not special cases in
      `prepareStep`. Seen red.
- [ ] **The split pays and does not regress.** `contextBudget` shows Schedule's and Discover's edit
      steps each smaller than today's `trip · edit` (31,630 chars), and a live eval run, on
      Mitchell's word, grades no worse than the last baseline.
- [ ] **Debug mode in the Ask panel**: an operator sees the graph from the page, the tools per
      persona, and each turn's breakdown after it runs; a non-operator sees no toggle and gets 404
      from its endpoints. Unit tests seen red; e2e green in CI.
- [ ] **The console's Personas tab** shows the map with per-persona and per-edge aggregates and a
      recent-turns list that opens a turn's breakdown; operators only. Seen red; e2e green in CI.
- [ ] **Mitchell walks the preview** (debug toggle on a trip page, a turn that switches, the
      console tab) and reports nothing to change, or each change is a merged part.
