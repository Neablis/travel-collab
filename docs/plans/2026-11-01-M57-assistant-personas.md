# M57 plan — the assistant is a graph of personas, and you can watch it work

Milestone: `docs/milestones/M57-assistant-personas.md` (decisions D1–D8, the gate). ADR-085.
Design: `docs/specs/2026-10-30-assistant-personas-design.md`. Deleted at the close.

Paths below are under `apps/web/src/` unless they start with `packages/`, `apps/web/drizzle`,
`apps/web/e2e` or `docs/`. Line numbers are from `main` at `8d3da51` (survey of 2026-11-01).

## Order

Every part targets `main` and merges on its own. At most two build at once.

```
part 1 (graph) ──► part 2 (ledger) ──► part 3 (outcomes) ─┐
                                   └─► part 4 (switch)  ──┼─► part 6 (console tab)
                                   └─► part 5 (Ask debug)─┘
```

Part 1 first (persona ids). Part 2 after it. Then 3 and 4 together, then 5 and 6 (5 needs only 2,
so it may take 3's slot if 3 stalls). Part 4 is the riskiest: it gets the extra fresh review.

Migrations: part 2 is `0071`, part 3 is `0072` (re-check the journal after merging `main`).

---

## Part 1 — the graph exists, is tested, and is drawn (`claude/m57-part1-persona-graph`)

**Theme.** `personas.ts` with the five personas as they are today (the trip planner still one
persona, `trip-planner`, over trip and day; part 4 splits it), the entry map, edges taken from
today's behaviour (the ADR-058 pivot and the escalation as `switch` edges on the trip planner;
`hand_off` targets and `go_to`/`open_trip` as `hand-off` edges), guards from the caps.
`SURFACES` derived from it. **No behaviour change.**

**Files.**
- New `server/assistant/personas.ts` and `personas.test.ts` (the invariants: every persona
  reachable, viewer never reaches propose, hand-off targets exist, switch edges' needs met).
- `server/assistant/grants.ts` (`SURFACES` :93-181 derived; `SurfaceKind` :35) and
  `grants.test.ts`.
- New `server/assistant/personaReachability.test.ts` + committed
  `server/assistant/personaReachability.baseline.json`, mirroring `ai/contextBudget.test.ts`
  (`SHAPES` :102, `changesBetween` :198, `UPDATE_CONTEXT_BUDGET` write at :221) with its own env
  switch.
- New generator script `scripts/persona-graph.mjs` (or a test-driven writer like the baseline)
  writing `docs/architecture/personas.mmd`, and a drift check wired where `arch-baseline.mjs` is
  wired.
- Must stay green unchanged: `ai/contextBudget.test.ts` / `ai/contextBudget.baseline.json`,
  `server/assistant/admission.test.ts`, `server/ai/capabilityBlock.test.ts`.

**Preview.** Nothing visible. The PR shows `personas.mmd` and the baseline.

## Part 2 — the ledger knows the persona (`claude/m57-part2-ledger-personas`)

**Theme.** Migration `0071`: `ai_usage.entry_persona`, `ai_usage_steps.persona`,
`ai_usage_steps.from_persona`, `ai_usage_steps.edge_kind`, and an `ai_capability_gaps` table
(turn id, persona, target, what was asked, created_at). Admission resolves the entry persona; the
step recorder writes each step's persona (equal to the entry until part 4). `logCapabilityGap`
also inserts a row. The server turn id is added to `AskStreamMetadata` (additive contract change,
`docs/contracts/CHANGELOG.md`).

**Files.**
- `server/db/schema.ts` (:1506-1642) and new `apps/web/drizzle/0071_*.sql` + journal.
- `server/assistant/ledger.ts` (`TurnLedger` :269) and `ledger.test.ts`.
- `server/entitlements/usage.ts` (`recordTurnLedger` :73, inserts :78, :135, :175) and
  `usage.int.test.ts`.
- `server/assistant/admission.ts` (`resolveSurface` :896, `grantTools` :1186) — entry persona on
  the grant.
- `ai/handleAskRequest.ts` (step plans in `prepareStep` :870-918; ledger calls :676, :1466;
  `withUiOutcome` :1690) — persona per step, gap rows.
- `ai/admissionPorts.ts` (`logCapabilityGap` :76).
- `packages/contracts/src/assistant.ts` (`AskStreamMetadata` :694) + `docs/contracts/CHANGELOG.md`.
- `components/assistant/useAskThread.ts` — keep the server turn id on the client turn.
- Tests: `app/api/trips/[tripId]/ask/telemetry.int.test.ts`, `app/api/ask/route.int.test.ts`.

**Preview.** Nothing visible. Production needs `migrate-production` (Mitchell's).

## Part 3 — a turn's outcomes join to it (`claude/m57-part3-turn-outcomes`)

**Theme.** Migration `0072`: `ai_turn_outcomes` (turn id, kind, at, actor). Kinds:
`proposal_applied`, `suggestion_accepted`, `hand_off_pressed`, `carried_ask_pressed`,
`trip_created_from_hand_off`. The proposal carries the turn id to apply; an assistant-stored
suggestion records its turn id; the client posts hand-off and chip presses to one small endpoint
(owner-scoped, rate-limited like other ask routes); a trip created from a hand-off sends the
turn id it carried.

**Files.**
- `server/db/schema.ts` (+ `trip_suggestions` :942) and `apps/web/drizzle/0072_*.sql`.
- `server/assistant/tools/writeTools.ts` (`proposalId` :437) and
  `ai/handleAskRequest.ts` (`handleApplyProposalRequest` :1969).
- `server/suggestions/accept.ts` and `app/api/trips/[tripId]/suggestions/changes/accept/route.ts`.
- New `app/api/ask/outcome/route.ts` + `route.int.test.ts`.
- `components/assistant/TurnWidget.tsx` (`HandOffCard` :210-250), `components/assistant/AssistantRail.tsx`
  (chip :1152-1177), `lib/pendingCarriedAsks.ts` (`takeIntoTrip` :97).
- Tests: `app/api/trips/[tripId]/ask/apply/route.int.test.ts`, `e2e/m56-into-a-new-trip.spec.ts`.

**Preview.** Press a hand-off and a chip; rows appear (the operator console shows them from part 6).

## Part 4 — switching, and the trip planner splits (`claude/m57-part4-switch-persona`)

**Theme.** `switch_persona({ to, why })` built per persona from its outgoing `switch` edges;
`prepareStep` serves the current persona (tools, instruction, model floor) instead of the pivot
and escalation special cases, which become edges; one switch a turn; the server re-checks the
guard and records `from_persona`/`edge_kind` on the step. The trip planner splits into
**Schedule** (entry for trip and day) and **Discover** with switch edges both ways. The tool lists
are chosen with `contextBudget` numbers in the PR body; the live eval runs only on Mitchell's word.

**Files.**
- `server/assistant/personas.ts`, `personas.test.ts`, `personaReachability.baseline.json`,
  `docs/architecture/personas.mmd`.
- New `server/assistant/tools/switchPersona.ts` + `switchPersona.test.ts`;
  `server/assistant/registry.ts` (:61).
- `ai/handleAskRequest.ts` (`prepareStep` :870-918, `buildable` :482, `offeredNames` :516,
  `escalatedNames` :522) and `server/assistant/admission.ts` (:1319-1366).
- `server/assistant/tools/escalate.ts`, `tools/intent.ts` — retired or adapted to edges.
- `server/assistant/capabilities.ts` (`capabilityBlock` :122) — the edge list.
- `ai/contextBudget.test.ts` shapes + `ai/contextBudget.baseline.json`.
- Tests: `app/api/trips/[tripId]/ask/route.int.test.ts`, `server/assistant/intents.test.ts`,
  `server/assistant/tools/escalate.test.ts`, `server/ai/eval/replay.int.test.ts`.

**Preview.** On a trip, "find me a ramen place near day 2's hotel and add it" — answered with one
switch Schedule → Discover (visible in part 5's debug view, or in the ledger).

## Part 5 — debug mode in the Ask panel (`claude/m57-part5-ask-debug`)

**Interaction.** An operator sees a small *Debug* toggle in the Ask panel header (remembered per
browser). On, the panel shows a collapsible strip above the transcript:
- **Graph** — the entry persona for this page highlighted, its switch and hand-off edges, the
  personas reachable under the viewer's caps, and the never-reachable ones greyed.
- **Tools** — per persona: name, domain, effect; the current persona's set first.
- Under every assistant turn (through `renderTurnFooter`), a **breakdown** row that expands to
  the step timeline: persona per step, tools offered/called with outcome and duration, tokens,
  cache hits, cost, the switch or hand-off, and the turn's outcomes.
Non-operators see nothing; the endpoints 404.

**Files.**
- New `app/api/admin/assistant/personas/route.ts` (graph + tools for a scope under the caller's
  caps) and `app/api/admin/assistant/turns/[turnId]/route.ts` (one turn's ledger trace), both
  `requireAdminApi`, + `route.int.test.ts` each.
- New `server/assistant/turnTrace.ts` (reads the three ledger tables + outcomes) + test.
- New `components/assistant/AskDebugPanel.tsx`, `TurnBreakdown.tsx` + tests.
- `components/assistant/AssistantRail.tsx` (:1140), `Transcript.tsx` (`renderTurnFooter` :351).
- `components/account/PreferencesProvider.tsx` (`useIsAdmin` :253).
- New `e2e/m57-ask-debug.spec.ts` (admin login: `e2e/adminBootstrap.ts`).

**Preview.** As an operator on a trip: toggle Debug, read the graph and tools, ask something,
expand the breakdown. As a non-operator: no toggle.

## Part 6 — the console's Personas tab (`claude/m57-part6-console-personas`)

**Interaction.** `/admin?tab=personas`: the map (personas as nodes, edges by kind with guards,
entry pages, dangling hand-offs to *nowhere*), each node and edge labelled with the window's
turns, switches, cost per turn and per successful outcome, and unused tools; a window selector
like the AI models tab's; below, recent turns (persona path, cost, outcome) that open the same
`TurnBreakdown` as part 5.

**Files.**
- `components/admin/consoleTab.ts` (`CONSOLE_TABS` :8-13), `ConsoleTabs.tsx`, `app/admin/page.tsx`.
- New `components/admin/PersonasTab.tsx` + test; reuse `components/assistant/TurnBreakdown.tsx`.
- New `server/entitlements/personaReport.ts` + `personaReport.int.test.ts` (pattern:
  `aiModels.ts` :219).
- Tests: `components/admin/consoleTab.test.ts`, `app/admin/admin.console.test.ts`,
  `e2e/m36-operator-console.spec.ts` or new `e2e/m57-console-personas.spec.ts`.

**Preview.** `/admin?tab=personas` as an operator after a few turns on the preview.
