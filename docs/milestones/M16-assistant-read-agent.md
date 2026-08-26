# M16 — The assistant answers questions

**Status:** Approved 2026-08-25, not started. Phase 2. Executes immediately
after M10's Wave-2 gate closes, ahead of M15 — **ADR-022**.
**Depends on:** M10 Phase 1b (the header adopts `SPEC.md` §1's focus-scope
model). M16 needs one authoritative answer to "is a day selected"; Phase 1b is
inside M10's gate, so ordering satisfies this.

## Why this exists

Mitchell declined to open M9 on 2026-08-25: the data layer underneath a planning
partner is not strong enough yet, and the UI and sharing work he wants comes
first. What he asked for instead: *"get the sidebar on right"* — styled to the
design, the inert suggestion cards gone, and **single context-focused prompts
that work**, plus whatever crashes and missing handlers that shakes out. The
conversational partner comes later, with more tools layered on.

Scoping it surfaced a structural fact recorded in full in ADR-022 and summarised
here, because it is the reason this milestone is not a styling task:

**The AI endpoint is a command endpoint. It cannot answer a question.** The
response `message` is derived from the committed commands (`planSummary.ts`), by
design, so the model's own text is thrown away; a turn that resolves to zero
commands returns the fixed string *"I couldn't turn that into any changes, so
nothing was applied."* And `summarizeTrip` puts no time windows in the envelope
at all — so even with a channel to answer through, there is no free time in the
data the model receives. It would have to invent one, which is KI-15's failure
shape one layer up.

So the milestone is: **style the rail, then give questions a foundation of their
own, then measure whether the model uses it well** — before anything is layered
on top of it.

## Scope

Three waves, in order. Each is verifiable on its own.

### Wave 1 — the rail, styled

No AI changes. `SPEC.md` §9's **docked** presentation only.

- The rail becomes a **flex sibling** of the plan, not `position: fixed` over it
  — the plan shrinks instead of being overlaid. **This deletes the scrim
  outright.** KI-16 (a full-page click sink below 1180px) and KI-17 (sheets and
  dialogs rendering underneath the rail) are both already resolved; what this
  removes is the thing that produced them, so the class cannot recur.
- Left edge is a **2px `--color-border-strong`** divider, not a hairline —
  `SPEC.md` §9: "a structural wall, not a card edge". Width stays 356px, full
  height under the header.
- **Both `<Preview>` blocks are deleted** — the "What I noticed" suggestion cards
  and the quick-ask chip row. Nothing generates real ones, and they are the
  "bigger suggestions in the middle" this milestone was asked to remove.
  `lib/preview-registry.ts` is updated in the same change (KI-31's orphan guard
  trips otherwise).
- Copy follows the docked mode — no "drag the header to park it anywhere", since
  that interaction does not exist here.

**Deferred, and owned by this milestone so it stays routed:** `SPEC.md` §9's
**bubble** (56px brand circle) and **floating** (364×476 draggable card)
presentations, with their corner-planted expand, viewport clamping and re-clamp
on resize. Deferred by Mitchell 2026-08-25 in favour of the docked rail alone.
§9 was never in the 2026-08-23 routing table; this is where it now lives.

### Wave 2 — one question, one answer

A read-only tool-using agent on a **new** endpoint. Architecture, the tool rule
and the amendment to ADR-015 are in **ADR-022**; the build shape is:

- `POST /api/trips/[tripId]/ask`, beside the untouched
  `POST /api/trips/[tripId]/ai`. Request carries `{ question, scope }`, where
  scope is `{kind:"trip"}` or `{kind:"day", dayRef}` — `SPEC.md` §1's focus
  scope, so a selected day narrows the context and no selection means the trip.
- `ToolLoopAgent` (AI SDK v7 — `ai@7.0.34` is what is installed) with a short
  instruction, `stopWhen` bounded, and three tools: `read_trip()`,
  `read_day(day)`, `find_free_time({ day?, after?, before?, minMinutes? })`.
- **`findFreeGaps` is a pure domain function** in `packages/domain/src/trip/`,
  beside `conflicts.ts` and `costs.ts`, unit-tested without server or model. The
  tool wraps it.
- **`{ tripId, userId }` arrive via `toolsContext` / `contextSchema`.** No tool
  takes a `tripId` parameter, so reading another trip is not expressible.
- **No mutations, no history, no thread.** One question, one answer.
- **The AI kill switch stays a single chokepoint — see ADR-019's 2026-08-25
  amendment, which this milestone is obligated to implement.** This endpoint is
  the *second* AI entry point in the codebase, which is the moment a convention
  becomes a risk, so three things land in this wave:
  - The `/ask` route reaches a model **only** through `selectAiModel()`. No
    second gateway construction, no second flag read.
  - A **lint rule** makes it enforced rather than conventional:
    `@/server/ai/gateway` becomes importable only from `modelSelection.ts`,
    joining the domain wall and the `@/server/*` UI wall already in
    `eslint.config.mjs`.
  - `selectAiModel()` **takes the actor** (`{ surface, userId }`) and returns a
    **three-way** outcome — `live` / `simulated` / `denied`. Mitchell may gate AI
    behind a paid tier later; "off" today means *simulated*, and a simulated
    answer that mutates the trip is the wrong response to "you don't have
    access". `denied` is typed and unreachable until an entitlement source
    exists, but the shape must admit it before anything depends on the boolean.
    This milestone defines `denied`'s HTTP status and response shape.
- `selectAiModel()` and the `ai-live` flag seam (ADR-019) are otherwise reused
  unchanged. **`simulatedModel.ts` gains a read-agent branch** — it maps everything to
  `planCalls()`/`pageCalls()` today, so without this the flag-off path, which is
  every Vercel environment, cannot answer at all and the deployed sidebar looks
  broken.
- The rail renders the answer as the model's prose, visibly distinct from the
  derived receipts the command path produces. An unanswerable question says so.

**The existing command code is not removed.** `handleAiRequest`,
`planningTools`, `batchResolver`, `flushPlanningBatch`, `geocodeEnrichment` and
`planSummary` stay exactly as they are; M9's write tools wrap that pipeline from
inside the agent rather than reimplementing it.

### Wave 3 — measure the tool use

The point of Wave 3 is to know whether the tool design works *before* more tools
are layered on it.

- `onStepEnd` / `onEnd` (AI SDK v7 lifecycle callbacks) persist, per ask: which
  tools were called and with what arguments, **how many calls it took to reach
  an answer**, step count, token usage, latency, and whether it answered at all.
- **Which tools never get called** is a reported number, not an inference — an
  unused tool is a design finding.
- A **fixed eval set** of ~10 questions with verifiable outcomes, replayed in CI
  against recorded real-model transcripts. This begins closing **KI-11** ("no AI
  test ever calls a real model, so the real-model ≠ mock bug class is invisible
  to CI"); M9 inherits the harness rather than building it.
- Metrics beyond accuracy are the point: tool-call count per answer, correct-tool
  rate, tokens, error rate.

## What is deliberately not here

Conversation history and refine turns; any write or mutation tool; the
propose→review→approve interaction; streaming; `SPEC.md` §9's bubble and floating
modes; place search / grounding. **All M9**, which ADR-022 moves to last, after
M14.

## Exit gate

- [ ] **At least one exit criterion is a real, non-mocked model call, with its
      `meta` pasted into this file.** Same rule M9's gate carries, for the same
      reason: M7's post-gate retro asked for it after seven live failures slipped
      past a fully green mocked suite.
- [ ] Wave 1 verified in a real browser **below 1180px as well as above** — the
      viewport gap that let M10's Wave-1 gate pass with a page-blocking scrim.
- [ ] No `<Preview>` shell remains in the assistant rail, and
      `preview-registry.ts` agrees.
- [ ] **Mitchell's four acceptance assertions**, run live. Each pair is the
      **same question text** in both scopes — only the context differs, which is
      the whole point of the test:
      1. A day is selected, *"summarize what I have planned"* → **that day
         only**, and it does not mention activities from any other day. Leaking
         another day's stops is the real failure mode of scope narrowing, so it
         is the assertion, not a footnote.
      2. No day selected, same question → the **whole trip** — its shape, day
         count and dates — not one day's detail.
      3. A day is selected, *"where is the most free time"* → the largest gap
         between two activities **on that day**.
      4. No day selected, same question → **the day** with the most free time.

      *(Assertions 1–2 exercise the read tools, 3–4 the computation, so the four
      cover both halves of the tool set rather than testing one twice. They
      replace an earlier pair — "add a coffee stop before the temple" — dropped
      2026-08-25 as command-shaped, and so a poor fit for a read-only gate.)*
- [ ] **It does not invent what is not there.** Day-scoped, on a day with no
      temple on it: *"what time is the temple visit?"* → it says there isn't
      one, rather than producing a plausible time.
- [ ] A question no tool covers still gets an answer by reasoning over
      `read_day` / `read_trip` output, rather than an error. Graceful degradation
      is the property that makes an incomplete tool set safe.
- [ ] Wave 3's per-ask record exists for every gate run above, and the tool-usage
      numbers are pasted into this file — including any tool that was never
      called.
- [ ] **The kill switch covers both endpoints.** With `ai-live` off, `/ask`
      answers from the simulated path and contacts no provider — asserted, not
      assumed. The lint rule is in place and fails a build that imports
      `@/server/ai/gateway` from anywhere but `modelSelection.ts`.
- [ ] `selectAiModel()` takes the actor and returns `live` / `simulated` /
      `denied`; `denied` has a defined status and response shape, exercised by a
      test even though nothing returns it in production yet.
- [ ] Recorded transcripts replay in CI without a live call.
- [ ] Retro appended at gate close.

## Open questions

1. **Does an unused tool get deleted at gate close, or kept?** Wave 3 will name
   any tool the model never reaches for. The rule in ADR-022 says a tool is
   earned by a computation or a boundary — a tool that is never called may still
   be earned (the model may simply not have been asked). Decide with the numbers
   in hand, not now.
2. **Does `check_conflicts()` belong in M16 after all?** It is earned under the
   rule — the domain's conflict engine is not reproducible by a model — and the
   envelope already carries conflicts by `ref` for the command path. Left out to
   keep the opening set at three; revisit if the gate runs show the model
   reasoning badly about overlaps.
