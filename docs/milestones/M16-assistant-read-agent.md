# M16 — The assistant answers questions

**Status:** **Done, gate closed 2026-08-29.** Phase 2. Approved 2026-08-25 by
**ADR-022** to execute immediately after M10's Wave-2 gate, ahead of M15 — in
the event M15 (2026-08-26), M11 (2026-08-28) and M18 (2026-08-29) all closed
first, so this ran last of the four. Implementation landed in **PR #88**
(`5a362d3`, merged 2026-08-30 UTC), which deliberately flipped no status flag
because everything in it ran simulated; the gate closed afterwards on
Mitchell's live confirmation. Retro and gate evidence at the end of this file.
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

- [x] **At least one exit criterion is a real, non-mocked model call, with its
      `meta` pasted into this file.** Same rule M9's gate carries, for the same
      reason: M7's post-gate retro asked for it after seven live failures slipped
      past a fully green mocked suite.
- [x] Wave 1 verified in a real browser **below 1180px as well as above** — the
      viewport gap that let M10's Wave-1 gate pass with a page-blocking scrim.
- [x] No `<Preview>` shell remains in the assistant rail, and
      `preview-registry.ts` agrees.
- [x] **Mitchell's four acceptance assertions**, run live. Each pair is the
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
- [x] **It does not invent what is not there.** Day-scoped, on a day with no
      temple on it: *"what time is the temple visit?"* → it says there isn't
      one, rather than producing a plausible time.
- [x] A question no tool covers still gets an answer by reasoning over
      `read_day` / `read_trip` output, rather than an error. Graceful degradation
      is the property that makes an incomplete tool set safe.
- [x] Wave 3's per-ask record exists for every gate run above, and the tool-usage
      numbers are pasted into this file — including any tool that was never
      called.
- [x] **The kill switch covers both endpoints.** With `ai-live` off, `/ask`
      answers from the simulated path and contacts no provider — asserted, not
      assumed. The lint rule is in place and fails a build that imports
      `@/server/ai/gateway` from anywhere but `modelSelection.ts`.
- [x] `selectAiModel()` takes the actor and returns `live` / `simulated` /
      `denied`; `denied` has a defined status and response shape, exercised by a
      test even though nothing returns it in production yet.
- [~] **Recorded transcripts replay in CI without a live call — moved to M9's
      gate, 2026-08-29, by Mitchell's explicit decision.** This was Task 7 of
      PR #88's plan (the eval set plus replay harness), *dropped rather than
      half-landed*: it measures the agent rather than making it work. No
      harness exists — there is no eval, replay, cassette or recording file
      anywhere in `apps/web/src`, `packages` or `scripts`, verified at gate
      close. **M9's gate already carries the identical criterion**
      (`M9-ai-planning-partner.md`), and M9 is where the write agent it would
      measure lives, so the box moves there rather than being waived here.
      **KI-11 stays open** — this is the criterion that would close it, and it
      is now M9's to close. The M7 precedent for waiving instead was
      considered and rejected: M7's waived "AI demo" box is the one criterion
      that would have caught all seven of its live failures.
- [x] Retro appended at gate close.

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

## Gate evidence and retro — closed 2026-08-29

**How this gate was verified, stated precisely, because the two halves have
different strength.** Mitchell confirmed the four acceptance assertions, the
no-invention check and the graceful-degradation check by running them live.
Three further boxes were verified mechanically against `main` at `5a362d3` and
are reproducible by anyone:

- **No `<Preview>` shell in the rail.** The only surviving `Preview` references
  are M9's (`wizard-pace-tags`, `wizard-assistant-draft`, `GhostProposal`).
  `preview-registry.ts` records the rail's nudge chips and the "What I noticed"
  shelf as **deleted**, not shelved.
- **Kill switch and lint wall.** `scripts/check-lint-wall.mjs` actively proves
  an out-of-bounds `@/server/ai/gateway` import is rejected — for `aiModel` and
  `aiClassifierModel` both — `eslint.config.mjs:125` carries the restriction,
  and `modelSelection.ts:5` is the only importer in the repo.
  `modelSelection.test.ts:100` asserts the flag-off path constructs no provider.
- **`selectAiModel()` / `denied`.** `modelSelection.test.ts:120` and `:151`
  exercise the outcome and `deniedResponse`'s status and shape, though nothing
  returns `denied` in production yet.

### The real, non-mocked call

One `ai.ask` record with `simulated: false` exists in Vercel's runtime logs,
from the preview of `claude/m16-m9-assistant` (`dpl_fp1BeaibH4m1LuhEeBJt57MWWRwV`),
2026-08-30 05:16:18 UTC. Pasted verbatim, per the box:

```json
{"event":"ai.ask","scope":{"kind":"trip"},"question":"How is the trip looking?",
 "turn":"opening","simulated":false,"model":"deepseek/deepseek-v4-flash-0731",
 "steps":2,"toolCalls":[{"name":"read_trip","input":{}}],"toolCallCount":1,
 "offeredTools":["read_trip","read_day","find_free_time"],
 "uncalledTools":["read_day","find_free_time"],
 "classification":{"intent":"question","source":"model","failedOpen":false,
   "latencyMs":1561,"usage":{"inputTokens":198,"outputTokens":49,"totalTokens":247}},
 "answered":true,"outcome":"completed","cause":null,"finishReason":"stop",
 "usage":{"inputTokens":3363,"outputTokens":512,"totalTokens":3875},
 "usageByStep":[{"inputTokens":1332,"outputTokens":76,"totalTokens":1408},
                {"inputTokens":2031,"outputTokens":436,"totalTokens":2467}],
 "droppedCalls":[],"latencyMs":8067}
```

**What it proves:** a live model, the intent classifier returning a structured
verdict without failing open (KI-88's fix, observed rather than assumed), a
two-step loop, one tool call, no dropped calls, 3,875 tokens and 8.1s end to
end.

### The honest limit on the tool-usage numbers

**The four acceptance assertions are not in these logs.** Vercel holds exactly
one `ai.ask` record across seven days, and it is the trip-scoped opener above —
not any of the four. Mitchell's confirmation runs were local (`AI_LIVE=true` in
`.env.local`), where the per-ask records go to the local console and never reach
Vercel. So Wave 3's box is ticked on **one** record plus a confirmed live pass,
not on a record per gate run as the box's wording asks.

This is worth naming rather than smoothing over, because it is KI-11's exact
shape one layer up: the behaviour was confirmed by a human at a keyboard and the
*evidence* is a single log line. **The fix is the box that just moved to M9** —
a replay harness would have produced a record per assertion as a by-product.

### Open question 1 is deliberately NOT answered

*"Does an unused tool get deleted at gate close?"* — the one record shows
`uncalledTools: ["read_day","find_free_time"]`, i.e. two of three tools unused.
**n=1, on a question that should only ever have called `read_trip`.** Deleting a
tool on that would be exactly the fixture-shaped reasoning Mitchell rejected at
M18's gate: *"I don't think the shape of the fixture should drive
functionality."* Both tools stay. Decide it when the analytics have a real
spread — which is what `/ai-usage` and the Monday cost-drift routine are for.
Open question 2 (`check_conflicts()`) likewise stays open; nothing in one record
shows the model reasoning badly about overlaps.

### What this milestone learned

- **A dropped stretch task is cheaper than a half-landed one, and it still has
  to be tracked.** PR #88 dropped Task 7 cleanly and said so. What it did not do
  was reconcile that against the exit gate, which carried the box regardless —
  so the gap surfaced at gate close rather than at plan close. Moving it to M9
  is the resolution; noticing it needed one is the lesson.
- **A merged PR that deliberately flips no status flag still has to update
  `STATUS.md`.** PR #88 correctly left the four gate flags alone — the gate had
  not passed. But it also left `STATUS.md` saying *"Next action: Open M16"* and
  this file saying *"not started"*, for a milestone whose implementation was on
  `main`. A session reading the resume-from-here file would have rebuilt it.
  The gate-close checklist governs the four flags; **"where the work is" is a
  separate obligation that fires on every merge.**
- **Live testing found what review did not, again.** Every item in PR #88's
  second table — the 55px mobile rail, the 14-call Nara scan, the classifier
  failing open, the dead suggestion chips — came from Mitchell using it, not
  from a green suite. Third gate running.
