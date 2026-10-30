# Assistant personas: a graph of who the assistant is, what it can do, and what that is worth

**Status:** candidate, not scheduled. Asked by Mitchell 2026-10-30 while weighing M56 part 5's
prompt cost (PR 641). Nothing here is decided; the open decisions are at the end.

## The idea, in Mitchell's words

> "I kinda imagined we would have personas, and those personas define what tools are available
> … a tool that could let the AI switch its personas, but we would initialize the persona from
> the page they start from."

and then:

- a **directed graph** between personas plus the starting page, so some personas are never
  reachable, by walking a finite state machine;
- a **visualization** of the tools and that graph, so a developer can see what is built and how
  well it is doing (a debug mode);
- **AI metrics tied to it**, so the return on the assistant is visible;
- possibly an existing orchestration or observability library as the foundation.

## What exists today (main, plus M56 parts 5 and 6)

Most of a persona system is already here under other names. Paths are under
`apps/web/src/server/`.

| Persona concept | Today | Where |
|---|---|---|
| A persona's toolset | A **surface**: ten rows of `{domain, max}` grants | `assistant/grants.ts:91-173` (`SURFACES`) |
| Starting persona from the page | `AskScope` from the client, checked by admission's `resolveSurface` | `assistant/context.ts:46`, `assistant/admission.ts:900-950` |
| Personas a person can never reach | Caps: role (viewer → read), plan (`ai.command`), classifier (`question` → read) | `grants.ts:241` `grantFor`, `admission.ts:1202-1218` |
| Switching inside a turn | Two narrow cases: the page **intent pivot** (ADR-058, once per turn) and **escalation** (`request_change_tools`) | `ai/handleAskRequest.ts:843-889` (`prepareStep`) |
| An edge to another persona | `go_to` / `open_trip` (ADR-072) and, from M56, **`hand_off`** to `new_trip`, `plan_page`, `upgrade` or `nowhere` (ADR-084) | P5 `assistant/tools/ui.ts:100` |
| The persona knowing its edges | M56's generated **capability block** ("From this page you can change …; not from here: X → hand_off") | P5 `assistant/capabilities.ts:122` |
| Cost per step | The `contextBudget` baseline: 11 turn shapes | `ai/contextBudget.test.ts` |
| Metrics | `ai_usage`, `ai_usage_steps`, `ai_usage_tool_calls` (M31); `ai.ask`, `ai.grant`, `ai.capability_gap`, `ai.proposal.apply` log lines; Sentry `gen_ai` spans and metrics | `db/schema.ts:1495-1633`, `assistant/askAnalytics.ts:518`, `ai/aiMetrics.ts` |
| Quality | The eval harness: 36 live prompts, 7 replayed transcripts, `grade.ts` | `ai/eval/` (M33) |
| A developer view | The M36 operator console's AI models tab; **no graph or per-turn trace view** | `components/admin/AiModelsTab.tsx` |

The gaps that matter:

1. **Surfaces have no edges.** Moving between them is navigation or a hand-off; a thread is
   stored per scope on the client (`components/assistant/askThreadStore.ts:63`), so a switch
   always starts a new conversation.
2. **The ledger does not know the surface.** None of the three `ai_usage` tables has a surface
   column; it lives only on the `ai.grant` and `ai.capability_gap` log lines. Cost per persona
   cannot be asked of the database today.
3. **Outcomes are thin.** Proposal applied or refused is recorded. A suggestion accepted
   (ADR-067), a hand-off button pressed, a carried-ask chip pressed and a trip created from a
   hand-off are not.
4. **Nothing draws the system.** The grant table, the registry (41 tools on part 5) and the
   edges exist only as code and tests.

## Design

### 1. A persona is a surface with edges

One typed module, `assistant/personas.ts`, replaces `SURFACES` as the source of truth:

```ts
type Persona = {
  id: PersonaId;                    // "trip-planner", "account", "page-writer", …
  grants: Grant[];                  // today's SURFACES row, unchanged
  voice: InstructionBuilder;        // today's per-surface instruction blocks
  tier: TierFloor;                  // the cheapest model it may run on
  needs: Needs;                     // what must exist: a trip, a page, an edit role, a plan
};

type Edge = {
  from: PersonaId; to: PersonaId;
  kind: "switch" | "hand-off";      // in place, or through navigation
  guard?: Guard;                    // role / plan / "a trip is open"
  carries: HistoryFilter;           // what of the conversation the next persona sees
};

const ENTRIES: Record<PageKind, PersonaId>;  // the starting page picks the first persona
```

- **`switch`** edges change persona inside the same turn and thread: the next step gets the new
  persona's tools and instruction through `prepareStep`, which is how the intent pivot and
  escalation already work. They are allowed only where `to.needs` is already satisfied (Account
  → Explorer: nothing new must exist).
- **`hand-off`** edges need something the current page does not have (a trip that does not exist
  yet, a trip the person must open). They stay M56's button, with its carried asks.
- **Guards** are the existing caps. A viewer has no edge into a persona whose grants are
  `propose`; a plan without `ai.command` has an `upgrade` hand-off instead of the edge.

ADR-058's intent pivot and the escalation become two ordinary edges in this graph instead of two
special cases in `prepareStep`.

### 2. The finite state machine and reachability

The graph is static and typed, so reachability is a test, not a runtime question:

- From each entry page, under each cap combination (role × plan), compute the reachable
  personas. Pin the result in a generated baseline next to `contextBudget.baseline.json`, so a
  PR that opens or closes a path shows it in the diff.
- Assert every persona is reachable from some entry, every hand-off target is a persona or a
  palette command (ADR-072), and no `switch` edge leads to a persona whose `needs` the source
  cannot meet.
- A **"never reachable"** set per cap is the answer to "some personas are never accessible": a
  viewer on a shared trip can never reach the trip planner's write tools, by construction.

At runtime the model sees one tool, `switch_persona({ to, why })`. Its `to` is a `z.enum` of
**only the current persona's outgoing `switch` edges**, so an illegal edge cannot even be
expressed; the server re-checks the guard and records the transition. A turn may switch at most
once or twice (ADR-058 allows one pivot); a switch costs a step, and Anthropic's own guidance is
that multi-agent setups multiply tokens. So this is **one agent whose persona changes over a
shared conversation**, not several agents talking.

Whether XState is worth it: the only event is "switch to X" and the only guards are the caps, so
a typed adjacency map is enough. XState (MIT) becomes worth its weight only if personas gain
timers, nested states or parallel regions.

### 3. Prompt cost, and why personas can make it smaller

The persona's capability block becomes its **edge list**: a line per outgoing edge, which is
what M56's block already is. The new cost is one small tool (`switch_persona`).

The saving is the real argument. Today the trip surface sends 18 itinerary tools on every edit
step (`trip · edit` is 30,780 chars on part 5). Splitting the trip planner into narrower personas
(for example *Schedule* — free time, re-order, move — and *Discover* — find places and playbook
days to add) with a switch edge between them sends each step only one half's tools. Whether a
split pays is measurable before it ships: the `contextBudget` shapes give the chars, and the eval
set gives the quality.

### 4. Debug mode

Two views, both generated from code so they cannot drift:

- **The map** (operator console, a new tab beside AI models): personas as nodes, edges coloured
  by kind with their guards, each persona's tools with domain and effect, and the entry pages.
  Overlaid from the ledger for a chosen window: turns per persona, switches per edge, cost per
  turn, outcome rate, tools offered and never called (already computed for the AI models tab),
  and `capability_gap` hand-offs drawn as dangling edges to *nowhere*, the backlog of tools not
  built. Rendered with Mermaid or React Flow; no vendor needed.
- **One turn's trace**: the step timeline with the persona per step, the tools offered, the tools
  called with their outcome and duration, tokens and cache hits, the switch or hand-off, and the
  outcome. The ledger already holds all of this except the persona.

The same generator writes a Mermaid file into `docs/` on every build, so a PR changing the graph
shows a picture in review.

### 5. Metrics tied to value

Ledger changes (one migration):

- `ai_usage.entry_persona`, `ai_usage_steps.persona`, and a transition marker on the step where a
  switch happened (`from_persona`, `edge_kind`).
- An **outcome** per turn, joined from events the app already emits or should: proposal applied,
  suggestion accepted, hand-off button pressed, trip created from a hand-off, carried chip
  pressed, place added from `show_options`. `ai.capability_gap` becomes a table, so the backlog
  can be queried past log retention (ADR-084 already names this as the later migration).

The questions it answers, per persona and per edge: **cost per successful outcome**, switch
success (did the persona switched to finish the task), dead ends (hand-offs to *nowhere* by
task), tools nobody calls, and the before/after of any prompt change such as M56's +3.1k. The
`ai-usage` skill and the AI models tab read the same columns.

**Measure first.** The persona columns and outcomes can ship before any persona changes, giving a
baseline per surface to judge the graph against.

### 6. Foundation: build or adopt

Researched 2026-10-30. Several vendor pages were blocked from the session, so prices below are
from secondary sources and need checking before any purchase.

| Option | What it would give | Verdict |
|---|---|---|
| Vercel AI SDK 7 (in use, `ai` ^7.0.153) | `prepareStep` / `activeTools` per step, which the persona switch needs; `ToolLoopAgent`; OTel GenAI spans | **Keep.** The persona graph is a module on top of it |
| LangGraph.js (1.0, swarm / supervisor handoffs, Studio) | A graph runtime with handoff tools | **No.** It replaces the AI SDK loop, streaming and model layer, and the ledger instrumentation with it |
| LangSmith | Hosted traces and evals; works with the AI SDK via `wrapAISDK`; free 5k traces/month, about $39/seat; self-host Enterprise only | **Not now.** Only if LangGraph is adopted |
| Langfuse (MIT core, ClickHouse-owned since 2026) | Hosted or self-hosted traces with AI SDK v7 support; free Hobby, about $29/month Core | **The trial**, if a hosted trace viewer is wanted |
| Braintrust | Strongest evals product, from about $249/month | Overlaps M33's harness; not now |
| XState v5 + Stately | A typed FSM and visualizer | Only if the graph gains timers or nested states |

The deciding point is that **value lives in our database**. No vendor can join a turn's cost to
"a trip was created from this hand-off" or "the suggestion was accepted"; our ledger can. So:

1. Orchestration stays the AI SDK plus `personas.ts`.
2. Observability stays the ledger, extended with personas and outcomes; Sentry already receives
   `gen_ai` spans (ADR-032).
3. The cheapest reversible experiment: send the AI SDK's OTel spans, tagged with persona, with
   **prompts and tool outputs off** (they carry people's trip data), to a Langfuse Cloud project
   on preview deployments only, for a week. Leaving it means removing one exporter.

## A possible split into parts

| Part | What | Why first |
|---|---|---|
| 1 | Persona and outcome columns in the ledger; `capability_gap` as a table; outcome events | A baseline before anything changes |
| 2 | `personas.ts` from `SURFACES` with no behaviour change; edges from today's hand-offs, pivot and escalation; the reachability baseline test | The graph exists and is tested |
| 3 | The map and one-turn trace in the operator console; the generated Mermaid file | Developers can see it |
| 4 | `switch_persona` for in-place edges; threads carry their persona | The new behaviour |
| 5 | Split one heavy persona (the trip planner) if the numbers say so | The cost saving, measured |
| — | Optional: the Langfuse preview trial | Independent; any time |

## Open decisions for Mitchell

1. **Which personas.** Today's surfaces map to about five: trip planner (trip, day), page writer,
   account, playbook editor, explorer (discover, city, tag). Is that the set, and which should
   split?
2. **A trip-starting persona.** Mitchell's example *"create a trip from scratch person"* that
   ticks the trip-type boxes would reopen **M56's D1**, which made New trip a deterministic picker
   with no model. Keep D1 (the picker stays, hand-off into it) or reopen it?
3. **Switches per turn**: one, like ADR-058, or more?
4. **What history crosses an edge**: the whole thread, or a summary the next persona starts from?
5. **Whether a persona is visible to the person** (a name or label on the rail), or only internal.
6. **The trace trial**: run the Langfuse preview experiment, or stay on the ledger and Sentry only?
