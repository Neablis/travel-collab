# M57 — The assistant is a graph of personas, and you can watch it work

**Status (2026-11-01): scoped, current.** Minted and placed **ahead of M44** the same day by
Mitchell, choosing it from the candidate list: *"Let's take on #3, 'Strategic for the assistant:
personas'. Remember that as part of this I want to be able to visualize how the agent performed
through its personas in like a debug mode so I can see how well it's working. It should be
possible to see the state tree from a page and the tools available, then break down after agent
run how it did."* (see `docs/milestones/README.md`, *2026-11-01 — minted and placed: M57*).
The design is `docs/specs/2026-10-30-assistant-personas-design.md`; the decisions below change it
where they say so. The mechanisms are **ADR-085**. Six parts and part 0, which merges last. The
plan (`docs/plans/2026-11-01-M57-assistant-personas.md`) is deleted at the close.

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
part's PR body's red-first table: the source edit and the failure text. Part PR heads and `ci`
runs: PR 668 `1411211` run 41320094857, PR 670 `ea559f9` run 41324757720, PR 671 `d6c6cff` run
41329821024, PR 672 `f788d75` run 41348167445, PR 673 `8edb9de` run 41348170692, PR 674
`bfacb7d` run 41357541647 (`ci-ok` check run 125002637451). Each is attempt 1 and green; the
earlier heads of PR 674 were red, and `325b6e1` and `bfacb7d` fixed two real causes (a phone
Ask-panel mount race and an m41 test that depended on shared-user trips), not a re-run.

- [x] **Decisions D1–D8 are answered and recorded here**, and ADR-085 is written. *Evidence:*
      *Decisions* above; `docs/architecture/ADR-085-the-assistant-is-a-graph-of-personas.md`,
      to which the close added decisions 7 to 9 (the gaps table kept forever, no public API for
      AI endpoints, personas internal).
- [x] **`personas.ts` is the one source of the personas**, `SURFACES` is derived from it, and part
      1 changes no `contextBudget` shape. Seen red. *Evidence:* PR 668 (merge `f9cfd3d`), its
      red-first table, `ci` run 41320094857.
- [x] **Reachability is a test.** A generated baseline pins the reachable and never-reachable
      personas per entry page and cap combination; a test asserts every persona is reachable from
      some entry, a viewer never reaches a `propose` persona, every hand-off target exists, and no
      `switch` edge leads to a persona whose needs its source cannot meet. The Mermaid file is
      generated and drift-checked. Seen red. *Evidence:* PR 668 (`personaReachability.baseline.json`,
      `docs/architecture/personas.mmd`), regenerated by PR 672; `ci` runs 41320094857 and
      41348167445.
- [x] **Every ledger turn carries its entry persona and every step its persona**, a switch step
      its transition, and capability gaps are rows; migration applied to production by
      `migrate-production`. Int test seen red. *Evidence:* PR 670 (merge `233bc7a`, migration
      `0071_ai_personas.sql`), `ci` run 41324757720; `migrate-production` run 41351040591
      (success, 2026-11-01 21:15Z, on `951ebe6`, which holds `0071` and `0072`).
- [x] **A turn's outcomes join to it**: proposal applied, suggestion accepted, hand-off pressed,
      carried-ask chip pressed and trip created from a hand-off each record the turn id. Seen red.
      *Evidence:* PR 671 (merge `951ebe6`, migration `0072_ai_turn_outcomes.sql`, applied by the
      same run 41351040591), `ci` run 41329821024.
- [x] **`switch_persona` offers only legal edges and at most one a turn**; the server re-checks the
      guard and records the transition; the pivot and escalation are edges, not special cases in
      `prepareStep`. Seen red. *Evidence:* PR 672 (merge `3d0db6a`), its red-first tables, `ci`
      run 41348167445.
- [ ] **The split pays and does not regress.** `contextBudget` shows Schedule's and Discover's edit
      steps each smaller than today's `trip · edit` (31,630 chars), and a live eval run, on
      Mitchell's word, grades no worse than the last baseline. **Open, two halves, neither
      claimed.** *Size:* `apps/web/src/server/ai/contextBudget.baseline.json` on `main` gives
      Schedule's edit step 28,786 chars (20 tools; 3,002 fewer than before, PR 672's table), but
      `trip · edit · switched to discover`, Discover's edit step, 31,963 chars (23 tools), which
      is 333 **more** than 31,630. Discover is the old trip planner's whole grant by design, so
      the gate's "each smaller" is met for Schedule only. *Grades:* no before/after baseline was
      run. Mitchell's decision (2026-11-01): he chose not to run one. He ran the four persona
      cases instead and all pass: `s-ramen-near-hotel` (after its prompt was reworded, on PR 674
      head `85c6202`; see KI-2026-11-01-x) and `d-coffee-near-now`, `s-named-place`,
      `s-move-museum` on `main`. Per turn on `main` (n=4): about 63k input tokens, about 550
      output, 5 steps, about $0.053. That is a pass of four cases, not a comparison with a
      baseline, and is not recorded as one. Ticking it needs Mitchell to accept both.
- [x] **Debug mode in the Ask panel**: an operator sees the graph from the page, the tools per
      persona, and each turn's breakdown after it runs; a non-operator sees no toggle and gets 404
      from its endpoints. Unit tests seen red; e2e green in CI. *Evidence:* PR 673 (merge
      `f5bbd18`), `ci` run 41348170692; the Ask-panel specs also ran in PR 674's full run
      41357541647. Mitchell walked the operator Debug toggle on 2026-11-01.
- [x] **The console's Personas tab** shows the map with per-persona and per-edge aggregates and a
      recent-turns list that opens a turn's breakdown; operators only. Seen red; e2e green in CI.
      *Evidence:* PR 674, red-first tables in its body; `ci` run 41357541647 on `bfacb7d`, with
      `ci-ok` (check run 125002637451) and both e2e shards (check runs 125000762442 and
      125000762524) success; `e2e/m57-console-personas.spec.ts`.
- [x] **Mitchell walks the preview** (debug toggle on a trip page, a turn that switches, the
      console tab) and reports nothing to change, or each change is a merged part. *Evidence:*
      Mitchell's word, 2026-11-01. He walked the previews of PR 674: the Personas graph, where his
      layout feedback was fixed in `5ff1488`
      with border-clipped curved edges and per-node "nowhere" stubs (he asked to check it on a
      phone too), and the operator Debug toggle in the Ask panel. Ticked on his word.

## Retro — written 2026-11-01 (9 of 10 boxes ticked)

Drafted on part 0 (PR 667) after all six parts were built: parts 1 to 5 are on `main` (last merge
`f5bbd18`), part 6 is PR 674 at `bfacb7d`, not yet merged. One box is left open on purpose (below).

### What went well

- **Five of six parts merged with a green first-attempt `ci` run each.** PR 668 run 41320094857,
  PR 670 run 41324757720, PR 671 run 41329821024, PR 672 run 41348167445, PR 673 run 41348170692;
  PR 674's final head `bfacb7d` is green on run 41357541647 (`ci-ok` check run 125002637451).
- **The migrations went in between merges.** `migrate-production` run 41351040591 applied `0071`
  and `0072` on `951ebe6`, before parts 4 to 6 landed.
- **The red e2e on PR 674 had two real causes, and each was fixed, not re-run.** `325b6e1` fixed a
  phone Ask-panel mount race and `bfacb7d` an m41 test that depended on trips shared between
  users; the head before them was red in the same places each run, so it was a defect rather than
  a timeout (CLAUDE.md rule 2).
- **Mitchell's walk found a layout problem and it was fixed the same day.** The Personas graph
  was redrawn in `5ff1488` (edges clipped to node borders, curved pairs, per-node "nowhere"
  stubs), and he asked to see it on a phone as well.
- **The product rules were settled in writing.** The three close-time decisions are in ADR-085
  decisions 7 to 9 and ADR-062 (the gaps table kept forever, no public API for AI endpoints,
  personas internal).

### What could be better

- **The size half of the "split pays" box was written as if both halves of the split shrink, and
  one does not.** Schedule's edit step is 28,786 chars against 31,630, but Discover's edit step
  after a switch is 31,963 (`contextBudget.baseline.json`, `trip · edit · switched to discover`),
  because Discover is the old trip planner's whole grant. PR 672's body said so (+175 per step
  after a switch); the gate was not reread against it until the close. Would have prevented it:
  the plan's part 4 should have stated Discover's size as a number the gate could check.
- **The live-eval half of the same box was not run as a comparison.** Mitchell chose not to run a
  before/after baseline; he ran the four persona cases and all pass (about 63k input tokens,
  about 550 output, 5 steps, about $0.053 a turn, n=4, on `main`). The box stays open until he
  accepts that and the Discover size (below).
- **A live-set prompt was edited under its old id.** `s-ramen-near-hotel` was reworded in
  `85c6202` (the seed has no day-2 hotel) against the file's "never edit, only add" rule. Filed
  as KI-2026-11-01-x, with Mitchell's ruling pending.
- **PR 674's final head was red twice before it was green.** The two causes above cost two fix
  rounds (a 44-call implementer, 485k units, the costliest agent of the close session).
- **Orchestrator share missed its target** (25.1% in the close session, 15.9% in the earlier ones).
- **Session-metrics covered only the close session.** The earlier build sessions' transcripts were
  not readable in this container, so their figures below are the ones carried in the hand-off.

### Leftovers

- **The open box** (Discover's edit step 333 chars over 31,630, and no baseline comparison of
  grades): Mitchell's call, either accept both and tick it, or amend the gate.
- **KI-2026-11-01-w** (the simulated model calls `find_places_near_now` from Schedule),
  **-x** (`s-ramen-near-hotel` edited under its id; Mitchell has not ruled),
  **-y** (the Personas report loads every row in the window into Node), **-z** (node turns need
  not sum to the total; a self-loop can be credited with an earlier escalation) and **-aa**
  (`EdgeDef` duplicates `DebugEdge`): filed at this close, from PR 674's body.
- **Tablet widths (768 to 1099px):** the assistant sheet now shows the phone's `contextLine`
  (`TripBoardScreen.tsx`, about lines 1918 to 1931). Desktop is unchanged and it matches
  `emptyHint`. Noted in review; not a defect, so no known issue. Mitchell's call if he wants the
  desktop line back at tablet width.
- **Migration:** none outstanding for M57 (`0071` and `0072` are applied; PR 674 adds none).

## Spend

Four sessions worked on M57. Only the last could be measured, and its block is pasted unchanged.
`pnpm -s session-metrics` read this container's transcript (the close session, including the
four Sonnet subagents before the close agent and the close agent itself, read while the close was
still running, so its own last calls are not in it). It could not read the earlier sessions'
transcripts, which went with their containers; their figures are the ones carried in the hand-off
and are not re-derived here.

<!-- session-metrics:milestone v1 -->

6 agents, 126 API calls, 1.65M units. One call is one assistant `message.id`; units = input + 1.25 × cache write + 0.1 × cache read (output excluded, transcripts understate it).

**By agent type**

| Who | Agents | Calls | Avg context | Peak context | Units | Share |
|---|---|---|---|---|---|---|
| `phase-implementer` | 2 | 58 | 61k | 97k | 620k | 37.6% |
| `general-purpose` | 1 | 32 | 123k | 147k | 562k | 34.1% |
| `orchestrator` | 1 | 22 | 115k | 130k | 342k | 20.8% |
| `part-reviewer` | 2 | 14 | 30k | 37k | 124k | 7.5% |

**Costliest agents**

| Agent (description) | Type | Calls | Avg context | Peak context | Units |
|---|---|---|---|---|---|
| Close M57 gate on part 0 | `general-purpose` | 32 | 123k | 147k | 562k |
| Fix PR 674 red e2e | `phase-implementer` | 44 | 68k | 97k | 485k |
| Fix PR 674 review minors | `phase-implementer` | 14 | 39k | 46k | 135k |
| Re-review PR 674 bfacb7d | `part-reviewer` | 8 | 30k | 34k | 64k |
| Review PR 674 e2e fix | `part-reviewer` | 6 | 31k | 37k | 61k |

**Orchestrator turns, by what started them**

| What started the turn | Turns | Units | Share of orchestrator | Idle |
|---|---|---|---|---|
| GitHub / trigger notification | 0 | 0 | 0.0% | 0 of 0 (0 units) |
| Subagent report | 4 | 117k | 34.3% | – |
| Subagent finished | 1 | 41k | 12.0% | – |
| Harness | 0 | 0 | 0.0% | – |
| Human | 3 | 184k | 53.7% | – |
| Other (unrecognised frame) | 0 | 0 | 0.0% | – |

**Follow-ups and cache re-writes**

| Measure | Count | Tokens |
|---|---|---|
| `SendMessage` calls by the orchestrator | 0 | – |
| Coordinator messages received mid-life, by 0 subagent(s) | 0 | – |
| Full cache re-writes in subagents | 1 | 66k |
| — directly after a coordinator message | 0 | 0 |

**Guard hooks**

| Hook | deny | note |
|---|---|---|
| `implementer-brief-check` | 1 | 0 |

**Targets**

| Target | Result | Measured |
|---|---|---|
| Orchestrator share of units < 15% | missed | 20.8% |
| No phase-implementer averaging > 250k context | met | worst 68k |
| GitHub wakes per merged part < 5 | met | 0 / 6 = 0.0 |
| Dollars per 1k lines added < 20 | not measurable | needs --cost-usd and --lines-added |
| Coordinator-message re-writes <= 2 | met | 0 |

### All sessions

| Session | Figures | Source |
|---|---|---|
| Earlier orchestrators | orchestrator share 15.9% (target under 15%, missed); worst phase-implementer context 182k (met); coordinator re-writes 0; `orchestrator-context-limit` hook fired 4 times | carried in the hand-off |
| Plan session | 2 agents, 110 API calls, 1.77M units (Explore 60.3%, orchestrator 39.7%) | carried in the hand-off |
| Build session 2 (handed off at about 252k context) | about 17 subagents: reviewers, fixers, triage and one Opus audit; session-metrics could not read the transcripts | counted from the hand-off, no units |
| Close session | 4 Sonnet subagents before the close agent (2 fixers, 2 reviewers), plus the close agent | the generated block above |

No total across sessions is given: the build sessions have no units, and `--cost-usd` and
`--lines-added` were not available to the block, so dollars per 1,000 lines is not measurable.
Lines added, by PR additions without `docs/` (they still include the migrations' generated
snapshots, so this is an upper bound): PR 668 1,113; PR 670 4,768; PR 671 4,914; PR 672 1,674;
PR 673 1,224; PR 674 1,096.

### Spend against the last milestone

M43 is the last closed milestone (continuation session: orchestrator 32.1%, $5.86 per 1,000 lines,
worst builder 70k).

- **Orchestrator share (under 15%):** missed at 15.9% in the earlier orchestrators (M43: 32.1%) and
  at 25.1% in the close session. The close session's orchestrator is a small total, so its share
  is large.
- **Worst phase-implementer context (under 250k):** met, 182k earlier and 68k in the close session.
- **Cache re-writes after a coordinator message (2 or fewer):** met, 0 (close session: 0).
- **GitHub wakes per merged part (under 5):** met in the close session, 0 of 6.
- **Dollars per 1,000 lines added (under 20):** not measurable, no cost was recorded for the
  block. M43: $15.28 by the rule.
