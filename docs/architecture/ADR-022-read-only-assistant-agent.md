# ADR-022: A read-only tool-using assistant, and M16 ahead of M15

**Status:** Accepted — 2026-08-25
**Deciders:** Mitchell (product/eng), Claude (architect)
Amends: ADR-015 §2 ("two derived tool families, never hand-written")
Related: ADR-018, ADR-021 (execution-order placements without renumbering)
Milestone: `docs/milestones/M16-assistant-read-agent.md`

## Context

M9 "AI as a planning partner" was next in the execution order. On 2026-08-25
Mitchell declined to open it, for two stated reasons: the data layer underneath
it is not strong enough yet, and the UI and sharing work he wants first sit
ahead of it in value. What he asked for instead was small and concrete — the
right-hand sidebar styled to the design, the inert suggestion cards removed, and
**single, context-scoped questions that work**.

Scoping that surfaced a structural fact that neither M9's file nor the M10 delta
plan records.

**The AI endpoint is a command endpoint. It cannot answer a question.**

`handleAiRequest` derives its user-facing `message` from the *committed
commands*, via `summarizeBatch` — deliberately, so the response "can never claim
an edit the batch didn't make" (`planSummary.ts`). The model's own text is
discarded. When a turn resolves to zero commands, the endpoint returns a fixed
string: *"I couldn't turn that into any changes, so nothing was applied."*
(`handleAiRequest.ts:323`). A user asking *"where is the most free time?"* gets
that sentence no matter how good the model's answer was.

A second gap compounds it. `summarizeTrip` (`context.ts`) puts each activity in
the envelope as `{ id, title }` and each day as its cost subtotal. **No time
windows reach the model at all.** Even with a channel to answer through, there is
no free time in the data it receives — it would have to invent one. This is the
same failure shape as KI-15 (locations were model guesses), one layer up.

Mitchell's two acceptance cases make the split concrete:

1. *"Add a coffee stop before the temple"* — a **command**, already expressible:
   `AddActivity` + `MoveActivity(position)` resolve in one batch, and the
   no-temple case already answers sanely.
2. *"Where is the most free time?"* — a **question**, and not expressible at all.

The cheap fix — return `gen.text` as an extra field on the existing endpoint —
was considered and rejected in conversation on the grounds that it layers a
second concern onto the command pipeline rather than giving questions a
foundation of their own.

## Decision

### 1. A third tool family: read tools, and a rule for earning one

ADR-015 §2 established two tool families, both **derived** from schemas —
planning tools from `@tc/contracts` command schemas, page tools from the
`@tc/pages` macro registry — and its Consequences say "no hand-written tool
manifests". That rule exists to stop a tool schema drifting from the command it
executes. **A read tool executes no command, so the rationale does not
transfer** — but the wording is broad enough that a hand-written read tool
contradicts the ADR on its face. This amends it.

Read tools are a third family. They are hand-written, and bound by this rule
instead of derivation:

> **A new tool is earned by a new computation or a new capability boundary —
> never by a new phrasing of a question.**

A tool exists when it removes a class of error the model would otherwise make,
or enforces a boundary the harness needs. It does not exist because a user might
phrase a question a particular way: **new questions land on existing tools as
typed parameters.** "Free time after 9pm" is `find_free_time({ after })`, not a
second tool.

The opening set is three:

| Tool | Why it is earned |
|---|---|
| `read_trip()` | The trip noun. No computation; the model's own reading is fine. |
| `read_day(day)` | The day noun, with the time windows the envelope never carried. |
| `find_free_time({ day?, after?, before?, minMinutes? })` | **A computation.** Time arithmetic is what a small model gets silently wrong. |

Two more are foreseen and deliberately not built: `check_conflicts()` (the
domain's conflict engine — overlaps, impossible geography, over-budget — is not
reproducible by a model) and `search_places()` (external I/O; M9 already owns it
as `SearchPlaces`). Both would be earned under the rule. Neither is needed for
M16's gate.

### 2. Computations live in the domain; tools are thin wrappers

`findFreeGaps` is a pure function in `packages/domain/src/trip/`, beside
`conflicts.ts` and `costs.ts`, unit-tested with no server, DB or model in the
way. The tool wraps it. The same doctrine `TripDetail.tripCostTotal` already
follows — summed server-side, never recomputed downstream — and it means the
calculation survives independently of whether a model ever calls it.

### 3. Trip and actor identity come from context, never from the model

The agent's tools declare `contextSchema` and receive `{ tripId, userId }`
through `toolsContext` (AI SDK v7 `ToolLoopAgent`). **No read tool takes a
`tripId` parameter**, so "read a different trip" is not expressible in any tool's
schema. This is the same guarantee `idFields.ts` gives for UUIDs and that ADR-015
§4 calls layered defense, applied to reads: the constraint is structural, not
prompted.

### 4. The command path is untouched

The read agent is a **new endpoint** — `POST /api/trips/[tripId]/ask` — beside
the existing `POST /api/trips/[tripId]/ai`. `handleAiRequest`, `planningTools`,
`batchResolver`, `flushPlanningBatch`, `geocodeEnrichment` and `planSummary` are
not modified and not deleted. M9's write tools return by wrapping that pipeline
from inside the agent, not by reimplementing it.

The `ai-live` flag seam (ADR-019) and `selectAiModel()` are reused, so the kill
switch keeps covering every model call. **Because this is the second AI entry
point, ADR-019 gains a 2026-08-25 amendment** making that chokepoint enforced
rather than conventional (a lint wall around `@/server/ai/gateway`) and widening
the decision to `selectAiModel({ surface, userId })` returning `live` /
`simulated` / `denied` — so AI can later be gated per user, and a user without
access gets a refusal rather than a simulated answer that edits their trip.
M16 implements that amendment. `simulatedModel.ts` gains a
read-agent branch — without it the flag-off path, which is *every* Vercel
environment, cannot answer at all.

### 5. Execution order

**M16 executes immediately after M10's Wave-2 gate closes, ahead of M15.
M9 moves to last, after M14.**

New execution order:
`M8 ✓ → [Phase 1 gate review ✓] → M10 → M16 → M15 → M11 → M12 → M13 → M14 → M9`

Milestone **numbers are unchanged** — an execution-order placement, the same
shape and the same reasoning as ADR-018 and ADR-021. M9 keeps its number and its
file; what changes is when it runs and what it inherits. M15's placement from
ADR-021 ("right after M10's gate, before M9") is not reversed, only shifted by
one: M16 goes first.

M9's move to last is Mitchell's call, on the stated grounds that the data layer
M13 and M14 build should exist before conversation and write tools rely on it.
M16 is the part of M9 that does not need to wait.

## Consequences

- A second AI entry point exists. Both route through the gateway and the flag;
  neither can spend without `ai-live`.
- M9's scope shrinks and changes shape. **Thread contract, streaming, and
  propose→review→approve stay with M9**, but they arrive as additions to a
  working agent rather than a rewrite of a one-shot RPC. M9's grounding work
  (`SearchPlaces`, `placeRef`) becomes a fourth read tool under this ADR's rule.
- `toolApproval: 'user-approval'` (AI SDK v7) is the mechanism M9's approval step
  should be built on. Recorded here so M9 does not invent a second one.
  **Amended 2026-08-29 — see the Amendment below; M9 did not use it, and why.**
- Observability starts in M16, not M9. Per-ask tool-call records and a fixed eval
  set begin closing **KI-11**; M9 inherits the harness instead of building it.
- **KI-23** (the simulated model's `combined` surface never composes a page) is
  untouched — a different surface on the untouched endpoint.
- The tool surface is expected to converge, not grow: the domain has four nouns
  (trip, day, activity, cost). If tool count ever approaches a dozen while still
  leaving questions uncovered, that is the signal to revisit — see the rejected
  alternatives.

## Alternatives rejected

- **Return the model's text as an extra field on the existing `/ai` endpoint.**
  The cheapest possible fix, and the one first proposed. Rejected by Mitchell:
  it puts a second concern (answering) inside a pipeline whose whole design
  guarantee is that its output is derived from committed commands, and it still
  leaves the model unable to see a time window. It would be replaced within one
  milestone.
- **One general `query_trip(filter)` tool — a small query DSL.** Maximum
  flexibility from one tool, no growth pressure. Rejected for now: the model
  composes DSLs badly, its errors are opaque where a typed parameter's are not,
  and output size becomes unbounded. This is the right answer at a scale this
  domain does not have.
- **Programmatic tool calling — the model writes code against the read model in
  a sandbox.** Strictly more capable, and the correct end state for a large tool
  surface. Rejected on cost: a sandbox and its security boundary are a larger
  lift than the entire milestone it would serve.
- **Wait and do all of it in M9.** The status quo. Rejected because it leaves a
  visibly broken sidebar on the deployed app through four milestones, and
  because M9's own file says its interaction is "a different architecture" —
  building the read half first is how that architecture gets tested cheaply.
- **Build the assistant's three presentations (`SPEC.md` §9) now.** Bubble,
  floating and docked with dragging and viewport clamping. Deferred by Mitchell
  in favour of the docked rail alone; recorded as owned by M16's file so it stays
  routed. It is interaction work, not a prerequisite for answering a question.

## Amendment (2026-08-29) — how M9's approval step was actually built

The Consequences above name `toolApproval: 'user-approval'` as the mechanism
M9 should build on. **M9 did not use it.** Recording the reason here, in the
ADR that made the recommendation, so the next reader does not "fix" the
deviation back.

`toolApproval: 'user-approval'` works as advertised: the SDK emits
`tool-approval-request` parts instead of executing, the client replays a
`tool-approval-response`, and the resumed run executes the approved calls
(`ai@7.0.34`, `resolveToolApproval` / `processToolApprovals`). Three things
about this repo's shape made it the wrong fit, and none of them is a defect in
the SDK:

1. **It guards `execute`, and `execute` is not what commits.** The write tools
   are the derived planning tools, whose `execute` only records a raw intent
   (`{ queued: true }`). The commit is `resolveBatch` → `enrichCommandLocations`
   → `flushPlanningBatch`, which the harness owns. Gating `execute` would have
   protected the one step that was already harmless.
2. **It puts the commit after a second model turn, inside a stream.** On
   resumption the tools execute, the loop continues, and the model speaks —
   then the batch would commit, in `onEnd`, after the answer is already on
   screen. A refused batch (a stale ref, a lost race) would arrive after a
   confident sentence describing it, which inverts `planSummary.ts`'s design
   guarantee that the message is derived from what committed. It also puts a
   Postgres write after the response is flushed, which is the classic
   serverless dropped-write shape.
3. **Approval per tool call is not the decision being made.** ADR-013 says an
   approved plan is ONE batch, one history entry, one undo. `user-approval`
   issues one request per call, which the client would have to re-aggregate
   into the single yes/no the user is actually being asked for.

**What was built instead** (the fallback this task's plan pre-authorised): the
write tools stay collect-only, the turn's final stream chunk carries a resolved
`AssistantProposal` as message metadata, and the client posts the reviewed
commands to `POST /api/trips/:id/ask/apply`, which runs enrichment and commits
one batch. Nothing commits without approval because `commitProposal` has
exactly one caller and it is that endpoint; rejecting is that endpoint not being
called, so the no-op path has no code that could get it wrong.

If `SearchPlaces` grounding (KI-81) or a future turn ever needs the model to
*continue* after an approval — "approve this, then keep planning" — that is the
case `toolApproval` is genuinely for, and this amendment is the note to
re-read.
