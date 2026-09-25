# M9 — The assistant cites what it plans

*(Titled "AI as a planning partner" until 2026-09-01. The planning partner is
built; renaming it is recorded in the audit below, not a scope change.)*

**Status:** Not started as a milestone — **but most of its scope shipped early,
and the file below still describes the milestone as it was approved.** Read the
audit block next before planning anything here.

PR #88 (`5a362d3`, merged 2026-08-30 UTC) landed write tools behind
propose → review → approve and `POST /ask/apply`, built overnight on Mitchell's
request to plan a trip with the assistant end to end. M16 and M9 shared a branch
because neither half is testable alone. **This gate did not close and none of
its boxes were ticked there.**

**Placed SECOND, immediately after M17 — Mitchell's decision, 2026-09-01.**
Order: `M17 → M9 → M12 → M13 → M14 → M19`. This supersedes ADR-022's
2026-08-25 placement of M9 last, after M14, which rested on two grounds — the
data layer should exist first, and UI polish and sharing come before it —
**both of which have since happened** (M10's Wave-2 gate, M11/M11a/M11b, M18,
M18b, M16). ADR-022 is not overturned; its conditions are spent. Numbers
unchanged; this is a placement, the same shape as ADR-018/ADR-021.

## Design and plans

**The remainder is designed.** `docs/specs/2026-09-15-M9-assistant-and-new-trip-design.md`
(2026-09-15) scopes everything below that has not shipped, plus the three
additions that arrived with the design handoff (`.design-sync/handoff/SPEC.md`
§30) — escalation and `certainty`, the transcript rebuild, and new trip as a
conversation. **Read §8 (the build order) before starting anything here, and
§10 (the decisions Mitchell owes) before estimating it.**

The build is split into **eight plans**, one per slice of that build order.
Plans live in `docs/plans/` while the milestone is in flight and are **deleted
at gate close**, with anything durable promoted to an ADR or a known issue first
— `docs/plans/README.md`. So this table is the index, and a plan missing from
it either has not been written or has already been retired.

| # | Plan | State |
|---|---|---|
| 1 | `docs/plans/2026-09-15-M9-01-step-quota-concurrency.md` — the step ceiling holds under concurrency | **Merged**, `cacc1af` (#178, 2026-09-15). KI-94 and KI-97 resolved; the gate box below stays unticked and carries an implementation note |
| 4 | `docs/plans/2026-09-15-M9-04-four-turn-new-trip.md` — new trip is four turns | **Written, not executed** (2026-09-15). The first shippable slice. Carries four decisions Mitchell owes (D-A to D-D) and closes KI-2026-09-12-e |
| 5, 8, 9, 10 + §6 | `docs/plans/2026-09-16-M9-remainder.md` — grounding + KI-93, escalation + `certainty`, the replay harness, KI-12, and conversation durability | **Written and executed**, 2026-09-16. One plan for four build-order items plus the un-numbered durability one, because three of them are one dependency chain and two are a handful of files each. What it does NOT cover, and why, is its own first table |

**Plan 4 is only half of build-order item 4.** That item reads *"the four-turn
transcript and the deterministic free path"*; the plan is the transcript half,
which the theme-authoring pass does **not** gate. The free path does need it,
and gets its own plan.

**Still not written: build-order items 2, 3, 6 and 7** — the transcript
rebuild, the theme vocabulary, `TripStatus: "draft"`, and the paid fork. Three
of those are UI or content and the fourth is a contracts PR only an unbuilt
consumer needs; none of them ticks a gate box, and item 3 additionally has an
unanswered ownership question (design §10.6). Numbering follows the design's
build order, not the order they are written in.

## What is actually left — audit, 2026-09-01

Checked against `main` at `dd61c44`, not against the prose below.
Full working: `docs/reviews/2026-09-01-milestone-audit.md`.

**Four of the seven scope items below are shipped, and half of two more.**

| Scope item | State |
|---|---|
| Grounding (`SearchPlaces` → `placeRef`) | **Not built.** `READ_TOOL_NAMES` is `read_trip`, `read_day`, `find_free_time` — no place search exists. **Built 2026-09-16** — `search_places`, cited by `placeRef`, resolved server-side (KI-81, KI-93) |
| Honest unknowns | **Shipped** — `withoutFabricatedCost`, `writeTools.ts:173` |
| Thread contract | **Partial** — messages ride the request; **no conversation table** in `schema.ts`, so a reload loses the thread. **Closed 2026-09-16** by `localStorage` rather than by a table (design §6, Mitchell's decision); there is still no conversation table and there is deliberately not going to be one |
| Streaming | **Shipped** (M16) |
| Propose → review → approve | **Shipped** — `ProposalCard.tsx`, `POST /ask/apply` |
| Refinement | **Shipped** within a session |
| Observability | **Partial** — `askAnalytics.ts` records `steps`, `usageByStep`, `uncalledTools`, `droppedCalls`; **no replay harness exists**. **Built 2026-09-16** — `src/server/ai/eval/` (KI-11) |

**So the remaining milestone is three things:** the assistant cites the places
it plans, its conversation survives a reload, and its behaviour is provable in
CI without a live call. That is what the new title names.

**All three are built as of 2026-09-16** — plus escalation, `certainty` and
KI-12, which arrived with the 2026-09-15 design rather than with this audit.
**What is left of the gate is what a build cannot supply**: a live model call,
and the browser walks that rest on one. `docs/plans/2026-09-16-M9-remainder.md`
is the plan they landed under, and its first table says what it deliberately
did not touch.

**The cost of leaving it last.** `ai-live` defaults to false
(`modelSelection.ts:19-30`) and Vercel holds one real-model record across seven
days, so the assistant is built and dark. What keeps it dark is exactly the
unbuilt link: KI-81 — a model guess laundered into a stored fact. **ADR-022's
two stated grounds for moving M9 last (polish first, sharing first) have both
been met** — M10's Wave-2 gate 2026-08-27, M11/M11a/M11b all closed. **Acted
on 2026-09-01: M9 now runs second, immediately after M17.**

**What changed for this milestone.** **M16** now builds the read half first: a
read-only tool-using agent on its own `/ask` endpoint, three read tools, and the
tool-call analytics and eval harness this file's gate asks for. So M9 no longer
starts from the stateless single-shot RPC described below — it **adds
conversation, write tools and approval to a working agent**, and inherits the
observability rather than building it. Read ADR-022 before planning this
milestone; the scope section below is still true, but its starting point is not.
Specifically: grounding (`SearchPlaces`/`placeRef`) becomes a fourth read tool
under ADR-022's rule, and the approval step should be built on AI SDK v7's
`toolApproval: 'user-approval'` rather than a second mechanism.

## Why this exists

M7 shipped a working AI *substrate* and a poor AI *experience*. The 2026-07-27
audit measured the difference: the resolver is sound (a property test drives
1,000 adversarial batches per run through `resolveBatch` and the real executor
decide loop with zero divergence), while the interaction is a stateless
single-shot RPC —

```
AiRequest = { prompt, surface, pageContext }   // no messages, no thread
generateText(...)                              // not streamText — nothing until done
→ resolveBatch → one atomic commit or nothing  // no preview, no diff, no refusal
```

Every complaint follows from those three lines. No streaming means no real-time
feedback. No message history means there is literally nowhere to put "no, I
meant Tuesday." One-shot commit means nothing to examine or shape. **This is not
a bug list; it is a different architecture** — and the expensive half already
exists.

**A fourth gap surfaced on 2026-08-02 that those three lines do NOT explain, and
this milestone's original framing missed it: the agent has no read tools.** A
dogfood run ("Plan a 3 day trip to Rochester NY, one day at Niagara Falls, one
at the Strong Museum, find lunch and dinner near each") produced a restaurant
with no address, a restaurant that may not exist, a dinner persisted in
Shropshire, England, and `cost: 0` on all nine activities. The model is asked to
*find* places while being unable to *look anything up* — so "find restaurants
near the falls" is answered from parametric memory and is unverifiable by
construction. Geocoding was bolted on afterwards as blind post-processing
(KI-15), which can only confirm or corrupt a decision already made; on that run
it corrupted a correct answer and silently dropped seven others. Streaming,
threads and approval would have made all of this *visible sooner*. None of them
would have made it *right*.

## Phase 0 — the assistant kernel (added 2026-09-10)

**Mitchell, 2026-09-10, against KI-2026-09-05-t:** *"Lets take on refactoring it, and the
entire AI Ask system, i want a really easy to use, add functionality and audit system."*

**Placed as this milestone's Phase 0** — nominally ahead of M17's then-open exit-gate boxes,
which turned out to have been satisfiable since 2026-09-02; M17's gate closed 2026-09-11
regardless, so the interposition displaced a marker and not any work. Mitchell's
placement decision the same day, on the KI's own argument: `handleAskRequest()` being one
455-line function is a *schedule multiplier* on every task below, and this milestone's
estimate assumes it is fixed first. It closes no gate box of its own; it is what the three
boxes are built on top of.

Decision and rules: **ADR-043**. Design, measurements and phase table:
`docs/specs/2026-09-10-assistant-kernel-design.md`.

Planned as six PRs; **it ran as seven phases in two PRs** — P0-P5 shipped together because
each depended on the one before, and only P6 needed its own review. **Complete 2026-09-11.**

| Phase | Lands | Closes / deletes | Landed |
|---|---|---|---|
| P0 | The spec and ADR-043 | — | `bbc5bdb` (#162) |
| P1 | `defineTool` (required output schema, declared `needs`, `spend`), the derived registry, every tool ported, the import wall | ambient `toolsContext`; lands KI-9's type-forcing | `bbc5bdb` (#162) |
| P2 | Domains x effect, `toolsFor`, computed `minimumRoleFor` | `offeredToolNamesFor` + three name manifests (F-F02) | `bbc5bdb` (#162) |
| P3 | `evaluateAiGrant` staged admission; handler becomes orchestration | **KI-2026-09-05-t**, F-F03 | `bbc5bdb` (#162) |
| P4 | Prompt blocks + tool-result tainting | string-concatenated instructions | `bbc5bdb` (#162) |
| P5 | Task classes, tiered model routing, `TurnLedger` | homes for **KI-93** and **KI-94/97** | `bbc5bdb` (#162) |
| P6 | Stream envelope into `packages/contracts` (own PR, per AGENTS.md) | **KI-22** | `845fc48` (#163) |

### What landed, and what it cost

**The measurement the phase was opened on.** `handleAskRequest()` went **455 -> 105
non-comment lines**, while the comment record in the same files **grew 634 -> 996**. That
ratio is the point rather than a curiosity: KI-2026-09-05-t's complaint was never line count,
it was that the reasoning lived in one function's head. ADR-043's rule that no comment in
`handleAskRequest.ts` is deleted — each moves with the step it describes — is what made the
second number go up while the first went down.

**What is true now that was not.** A tool is a module declaring a **required output schema**
and its own dependencies, so a tool cannot reach what it did not declare and the violation is
a compile error. A scope is a grant of **(domain, effect)** pairs and the tool set is a
*filter*, not a hand-written switch. Admission is a **nine-stage declared array whose order a
test asserts**. The system instruction is typed blocks with user-authored tool results fenced
in `⟦…⟧`. A turn returns a `TurnLedger` shaped as M20 link 9's `ai_usage` row, and **model
identity and cost are variable inputs**, not constants — Mitchell's correction on 2026-09-10,
and the reason the ledger takes a rate rather than hard-coding one.

**Known issues.** Closed: **KI-2026-09-05-t**, **KI-22**. Partly closed: **KI-9**. Updated
rather than closed: **KI-93** (the assertion is about shape, not count), **KI-2026-08-30-d**
(the real hazard shape and its recovery — see below). Filed by doing the work:
**KI-2026-09-11-a** (AI console sinks put a `userId` into Sentry breadcrumbs),
**-b** (`simulatedModel`'s `resultFor<T>` is an unchecked cast), **-c** (two `modelSelection`
tests read `serverConfig` at module load), **-d** (`TurnMeter.toolCalls()` returns its live
array).

**Neither gate box moved, as designed.** P5 gave **KI-93** and **KI-94/97** a place to be
fixed; it is not the fix, and this phase ticks nothing in the exit gate above. **The detail
that matters for closing KI-93:** it got a typed place to put a geocode count and *did not get
the count* — no tool declares `spend: "vendor"`, all eight declare `"none"`, and the real
LocationIQ door is `commitProposal`'s geocoder on the **apply** path, which is not a tool at
all. So "every vendor call goes through the quota" is not satisfiable by tagging a tool; the
spec has the measurement at `docs/specs/2026-09-10-assistant-kernel-design.md:683`.

**The squash-merge hazard, because it cost the most.** #162 was squash-merged while P6 was
stacked on it, which is **KI-2026-08-30-d** in a worse form than that entry predicted: it
forecasts duplicated known-issue entries, and here the duplicate check came back *clean*
while **twelve add/add conflicts** appeared on source files instead. A squash preserves the
**tree** and loses only the ancestry, so the recovery is to replay the stacked branch's own
contribution onto the new `main` rather than merge. **The trap in that recipe bit on the
first try, and is the part worth carrying:** the replayed tree silently reverted a docstring
pass — sixteen docstrings across eight `assistant/**` files — that had landed on the base
after the branch last merged it. A *deleted* file shows as `D` and gets caught; a *reverted
docstring reads as the branch's own work*. Copilot caught it in suppressed comments; it was
restored in `1bd9c64`. The check that actually works is comparing the replayed commit's file
set against the branch diff (20 vs 28). CodeRabbit later measured the same damage
independently as a 56.25% docstring-coverage warning, from a walkthrough rendered one commit
before the restoration.

**Verified in a browser, once, on #162's preview.** Six surfaces, signed in: **no `⟦` or `⟧`
in any human-visible output**, including the playbook day name that was the security finding's
specific risk. P6 had no browser walk of its own and says so rather than waving it through —
it changes no rendered output, and the proposal card's text is asserted unchanged by
`ask/route.int.test.ts`.

**One claim in the design spec was false and was disproved by building it.** §2 claimed that
retagging `search_playbooks` would drop it from the page surface. P2 wrote the test and
watched it refuse to fail. Domains are **audit vocabulary now, behaviour later**; the spec
carries the correction.

### Open questions this phase raised for Mitchell

None blocking, and none of them stops M9's real work starting:

1. Whether the usage row carries a `planVersionRef`.
2. Which quota window a **sold** ceiling binds. It is implemented per-day and stated nowhere,
   which is the kind of gap M20 pays for if it is not settled first.
3. Whether the tier map is a Vercel Flag or an env var.

**What it does not do.** No entitlement policy, no `ai_usage` table, no migration — M20 owns
those under four rules already decided 2026-09-01, and this builds only the ports they fill.
`resolveBatch` is not rewritten (KI-10 needs its own call). No comment in
`handleAskRequest.ts` is deleted; each moves with the step it describes.

**Effect on the three gate boxes.** KI-93 and KI-94 are gate boxes and P5 gives each a place
to be fixed rather than only described — but P5 is *not* the fix, and neither box is ticked
by this phase. KI-12 (name a trip, set its dates) is untouched by it.

## Scope

- **Grounding — the agent gets to look things up before it decides.** A
  `SearchPlaces` read tool (one call, array of queries, each region-biased)
  returns numbered real candidates; `AddActivity`/`UpdateActivity` then cite a
  `placeRef: N` instead of a free-text `location`, resolved server-side against
  that turn's search cache. **The model becomes structurally incapable of naming
  a place it did not search for** — the exact guarantee `idFields.ts` already
  provides for UUIDs, extended to locations, and the reason this belongs here
  rather than in a prompt tweak. Blind post-hoc enrichment is demoted to a
  fallback for user-typed text only (closes KI-15).
  - **Source: LocationIQ, which is already wired** (Mitchell, 2026-08-02).
    Decided against Yelp and Google — both prohibit persisting their content
    (Yelp: 24h cache max; Google: `place_id` only), which is the same
    storability constraint that drove ADR-007's vendor choice, and Yelp has no
    free tier as of 2026. Foursquare OS Places / Overture stay the named
    upgrade path if coverage proves thin; they swap behind ADR-007's existing
    `Geocoder` port, which is the consequence that ADR explicitly bought.
  - Use `/v1/search` with `viewbox` + `bounded=1` for region bias, **not** the
    Nearby/POI endpoint — Nearby is public BETA ("format may change without
    notice") with unconfirmed free-tier inclusion, so it is an optional later
    evaluation, never a dependency.
  - **Respect the real rate limit: 2 requests/second on the free tier.**
    Throttle; do not `Promise.all`. This is what actually broke the dogfood run.
  - Costs one extra step per turn (search, then act), not one per place — so
    `meta.steps` should read 2–3, not 18. Watch it; it is still the cost driver.
- **Honest unknowns.** The dogfood run wrote `amountMinor: 0` on every activity,
  which renders as *free* when the truth is *unknown*. `Money` is already
  `.optional()` on `AddActivity` — the contract is fine and needs no change; the
  rule is that the model never writes a value it does not have. Same principle
  as grounding: an absent field is honest, a fabricated one is not. No place API
  in the surveyed set returns a per-meal price anyway (Yelp's `$$` is a band),
  so this is a discipline question, not a data-source question.
- **Thread contract.** Messages, not a bare prompt; conversation persisted so a
  refine turn has something to refine.
- **Streaming.** `streamText`, so the plan appears as it is built.
- **Propose → review → approve.** The AI emits a proposed batch; the user sees
  it as a reviewable diff and accepts or rejects before it becomes truth. This
  is the "AI Preview" idea already captured in `TODO.md`; the two directions
  (a pending branch on the history substrate vs. an intermediate validated
  model) get decided in the design spec.
- **Refinement.** "No, not that — make it Tuesday" against the standing
  proposal.
- **Observability, which does not exist today.** Persisted request/response with
  the `meta` envelope, a replay harness over recorded real-model transcripts,
  and a small fixed eval set. Closes **KI-11** and supplies the infrastructure
  the "best model for my buck" item in `TODO.md` needs.

## What is already settled

Do **not** rewrite `resolveBatch` — it was attacked deliberately and held. Do
**not** trim the context envelope for token cost: it measures ~623 tokens for a
7-day/21-activity trip and the whole per-round-trip payload is ~1,900. The
33.5k-input run was ~18 round-trips; **step count is the cost driver, and
`meta.steps` already measures it.** Keep the telemetry, trim the steps.

Conversation design lives in this milestone — how a proposal is shown, how
progress reads, how rejection feels — not in M10.

## Exit gate

**Three of these six are already satisfied by shipped code (audit
2026-09-01) and are annotated below rather than ticked — ticking a box is part
of a gate close, which this was not.**

- [ ] **At least one exit criterion is a real, non-mocked model call, with its
      `meta` pasted into this file.** M7's post-gate retro asked for exactly
      this after seven live failures slipped past a fully green mocked suite;
      "covered locally by mocked tests" was treated as equivalent coverage and
      was not. **Still open** — and it is the same shape as M16's caveat, where
      the gate rests on one real record plus a human pass.
- [ ] A plan is built conversationally over several turns, refined by a
      correction, and committed only on approval — as one atomic batch, one
      history entry, one undo.
      **Mechanism shipped, walk outstanding (2026-09-01).** Multi-turn threads,
      the proposal, the approval and the atomic batch all exist (PR #88); what
      nobody has done is drive it end to end and record it. This box needs a
      walk, not a build.
- [ ] Rejecting a proposal leaves the trip untouched.
      **Met by construction (2026-09-01).** Rejecting is `POST /ask/apply` not
      being called — there is no reject path that could get it wrong, and the
      route file says so. Confirm at the gate; do not rebuild.
- [ ] **The 2026-08-02 Rochester prompt is re-run verbatim and every activity
      with a location has real coordinates in the right region** — no silent
      coordinate-less place, nothing on another continent. This prompt is the
      regression test for grounding — **KI-15 keeps it verbatim, as typed**, so
      it can be replayed exactly rather than approximated.
      **Grounding is built (2026-09-16) and this box is a LIVE RUN, not a
      build.** `search_places` numbers what a vendor returned, the write tools
      cite `placeRef: N`, and the server resolves the citation into the place
      that commits — so the model is structurally incapable of naming a place it
      did not search for, which is what makes the Rochester run answerable at
      all. KI-81 is resolved; KI-15 narrowed to its enrichment residual
      (`placeNameVerdict` still has no caller on the request path). The replay
      lane asserts the resolution on a fixed transcript, which is evidence about
      the code and not about what a model will do with it.
- [ ] No activity carries a fabricated cost — unknown reads as unknown, not as
      `0`/free.
      **And since 2026-09-16 it is watched rather than only enforced**: the
      replay lane asserts it over every transcript, one of which is a model
      writing `amountMinor: 0` on the shipped path. Verified to catch the
      regression by deleting `withoutFabricatedCost` from `buildProposal` and
      watching it go red.
      **Met, and enforced more strongly than written (2026-09-01).**
      `withoutFabricatedCost` runs in `buildProposal` *and* again in
      `parseApprovedCommands` (`writeTools.ts:412`), so a client cannot post a
      `cost: 0` back on approval. The trade it bought is recorded as **KI-82**:
      the assistant can never mark a stop genuinely free. Confirm at the gate;
      do not rebuild.
- [ ] Recorded real-model transcripts replay in CI without a live call.
      **M16's identical box moved here on 2026-08-29 by Mitchell's explicit
      decision, so this box now carries both milestones' weight.** It was
      Task 7 of PR #88's plan — the eval set plus replay harness — dropped
      rather than half-landed, on the grounds that it measures the agent
      rather than making it work. The foundation it builds on (per-ask
      analytics, `ai.ask` records with `usageByStep`, `uncalledTools` and
      `droppedCalls`) **is already shipped** by that PR's Task 3. This is also
      the criterion that closes **KI-11**, open since M7's post-gate retro.
      **THE HARNESS IS BUILT AND THE BOX STAYS UNTICKED, 2026-09-16, and the
      gap is one word.** `src/server/ai/eval/` replays a transcript through the
      real handler — the model is a recording, everything else is the shipped
      path — and the lane asserts shape, never prose, over a discovered set. It
      found a defect on its first run (**KI-2026-09-16-a**: a truncated tool
      input ends the whole turn, losing the reads it had already paid for),
      which is precisely the class KI-11 says CI cannot see. **KI-11 is
      resolved by it.** What is missing is *recorded*: the five transcripts that
      ship declare `source: synthetic` — hand-written from a recorded incident,
      each naming it — because no lane here has a gateway key.
      `recordAskTranscript` is the wrapper that makes a real one, and the
      harness carries the three lines. One live run ticks this.
- [ ] **The AI cannot leave a trip half-planned — KI-12.** "Plan me a trip"
      names the trip and sets its dates as part of the same approved batch. The
      headline flow finishes the job it advertises. *(Promoted to a gate box
      2026-09-01 by Mitchell's decision to assign every AI known issue to this
      milestone — see the section below for why three of twelve gate and nine
      do not.)*
      **KI-12 is resolved, 2026-09-16, and the box needs the walk.** The entry's
      diagnosis had gone stale — `SetTripName` and `SetTripDates` are both
      `BatchableCommand` members and both derived into tools — and what
      reproduced the symptom was P5's `TASK_CLASSES_FOR` cut plus a missing
      instruction. Both fixed, conditioned on the trip being EMPTY so an
      assistant never renames a trip somebody already named. A second defect
      closed with it and was live: the simulated classifier excludes the word
      "plan", so on every Vercel environment *"plan me a six day trip"*
      classified as a question and got no write tools — this flow, dark on the
      only path anyone can click (KI-2026-09-12-a).
- [ ] **Every vendor call goes through the quota — KI-93.** Server-side
      geocoding consults the geocode quota rather than spending the LocationIQ
      key through a second unmetered door. Grounding multiplies the traffic
      through that vendor, so this closes with it, not after it.
      **Done, 2026-09-16, exactly as this line predicted — with grounding, and
      there turned out to be TWO doors rather than one.** Grounding added the
      second (`search_places`'s port) in the same change that closed the first
      (`enrichCommandLocations`, both passes, the city fallback included), so a
      fix covering one would have swapped an unmetered door for another. The
      mid-batch question the entry said was owed is answered: a ceiling stops
      further lookups and never fails the request. `grants.test.ts` now measures
      the set of `spend: "vendor"` tools as a filter over the registry, so a
      third door is a decision somebody notices. **Confirm at the gate; do not
      rebuild.**
- [ ] **The step ceiling holds under concurrency — KI-94.** The quota's
      admission charge no longer lets simultaneous requests overshoot the global
      ceiling together. **KI-97 closes with it**, per its own entry — it is a
      tracking-only duplicate and must not be closed separately.
      *(Implemented 2026-09-15, M9 plan 1 — `reserveAiSteps` + `release`.
      Confirm at the gate; do not rebuild.)*
- [ ] Retro appended at gate close.

## The AI known issues — all nine assigned here, 2026-09-01

**Mitchell's decision, 2026-09-01: every open AI known issue belongs to this
milestone.** Nine of them named no milestone at all; this file cited three
(KI-11, KI-15, KI-81) and the rest had accumulated since it was written. **M9
now owns all twelve.** Each entry's own file carries the cross-reference, so
the assignment is visible from either end.

**Owning is not the same as gating**, and the difference is the whole reason
this section exists rather than twelve new boxes. A gate box is something whose
absence means the milestone is not done. Loading all twelve in would rebuild
exactly the grab-bag this milestone was just cut down from — it went from a
seven-item architecture replacement to three real pieces of work, and the value
of that is lost if the gate grows back by another route.

So they split two ways, by one test: **does it have to be true before `ai-live`
can be turned on?** That is what this milestone is for.

### Promoted to gate boxes (three)

Written as real boxes in the Exit gate above, because each one is a thing that
breaks or costs money the moment the assistant goes live.

| KI | Why it gates |
|---|---|
| **KI-12** | *"The AI cannot name a trip or set its dates, so 'plan me a trip' can't produce a complete one."* This milestone exists to make the planning flow trustworthy; a flow that cannot finish is not trustworthy. Correctness, on the headline path |
| **KI-93** | The geocoding path spends the LocationIQ key **without consulting the geocode quota at all**. Grounding is about to send far more traffic through that same vendor — closing the second unmetered door is part of building the first one, not a follow-up. **Resolved 2026-09-16, and the sentence was right in a way it did not expect: grounding added a THIRD door, so all of them had to close at once** |
| **KI-94** (+ **KI-97**, its tracking-only duplicate) | The step quota's admission charge is one step, so concurrent requests overshoot the global ceiling together. A spend ceiling with a burst hole is the wrong thing to have when the switch flips. KI-97 closes with it, per its own entry |

### Carried, not gating (six)

Owned by this milestone — a fixer here should take them if the code is already
open — but **not gate boxes**, and the gate does not wait on them.

| KI | Why it does not gate |
|---|---|
| KI-10 | Batches don't recover a reference to an activity created later in the same batch. Reported via `resolutionErrors`, not silent, and the fix is in `resolveBatch` — which this file says explicitly **not** to rewrite. Needs its own call before anyone touches it |
| KI-9 | Model outputs validated ad hoc rather than at one typed boundary. Cleanup, defensive, no known reachable bug |
| ~~KI-22~~ | The AI response envelope is not in `packages/contracts`. **`AGENTS.md` reserves a contracts change as its own reviewed PR**, so this cannot be a box inside another milestone's gate without breaking that rule. **Resolved 2026-09-11 by Phase 0 P6**, which is that PR |
| KI-24 | `AI_LIVE` on Vercel is warned-about, not prevented. Defense-in-depth on a switch, not a live bypass — worth doing while the switch is the subject, but the switch works |
| KI-80 | Two phrasings of the same command list. Both read the same `BatchableCommand`s, so they cannot disagree about facts, only wording |
| KI-15 / KI-81 / KI-11 | Already load-bearing in the boxes above — KI-15 and KI-81 are what grounding closes, KI-11 is what the replay harness closes. Listed for completeness, not carried separately |

| KI | Severity | What it is |
|---|---|---|
| **KI-12** | correctness | The AI cannot name a trip or set its dates, so "plan me a trip" cannot produce a complete one. The headline flow, unowned |
| **KI-93** | correctness | The AI handler's geocoding spends the LocationIQ key without consulting the geocode quota |
| **KI-94** | correctness | The step quota's admission charge is one step, so concurrent requests overshoot the ceiling together (KI-97 is its tracking-only duplicate) |
| KI-10 | correctness | Batches don't recover a reference to an activity created later in the same batch |
| KI-9 | cleanup | Model outputs validated ad hoc per call site, not at one typed boundary |
| ~~KI-22~~ | cleanup | The AI response envelope is not in `packages/contracts` — **resolved 2026-09-11 (Phase 0 P6)** |
| KI-24 | cleanup | `AI_LIVE` on Vercel is warned-about, not prevented |
| KI-80 | cleanup | Two phrasings of the same command list |

The full inventory each of those rows summarises, with severities, is in the
audit: `docs/reviews/2026-09-01-milestone-audit.md` §3a.

### Parked 2026-09-24 — nine AI entries filed after the 2026-09-01 audit

The 2026-09-01 rule — *every open AI known issue belongs to this milestone* — was
applied once, to the entries open that day. Nine more have been filed since and
named no owner. A KI pass on 2026-09-24 parked them here, each **carried, not
gating**, by the same test as above (none has to be true before `ai-live` flips;
KI-2026-09-17-c and KI-2026-09-14-b come closest, and both are accounting on a
path that already records usage). Each entry's own **Milestone:** line points
back here.

| KI | What it is |
|---|---|
| KI-2026-09-05-ad | The notebook assistant is page-scoped but has no page read, so it cannot answer what is on the page |
| KI-2026-09-08-c | The simulated assistant answers a library request with invented sample stops |
| KI-2026-09-12-f | `ProposalBuffer.collected()` is a shallow copy; the comment promises a real one |
| KI-2026-09-14-b | The `ai_usage` row is best-effort on the abort and error paths |
| KI-2026-09-16-a (truncated tool input) | A tool call with cut-off arguments ends the whole turn — found by the replay harness, cited above |
| KI-2026-09-17-b | LocationIQ pacing is per invocation, so concurrent lookups can exceed the key's rate |
| KI-2026-09-17-c | An escalated turn records all of its usage against the model it started on |
| KI-2026-09-24-h | A page-only batch touching two or more pages still hides an accepted card's Undo (the residue of KI-2026-09-23-f) |
| KI-2026-09-20-a | KI-39's wrong-venue geocode check is written and tested, and called from `savedDayPins.ts` — but not wired into live enrichment's `resolveOne` (re-verified 2026-09-25) |
| ~~KI-2026-09-20-j~~ | ~~The page assistant's "hangs up on a turn in flight" test failed once~~ — **resolved 2026-09-24**: a test race on the unchanged autosave that entering Editing sent; fixed at the cause in `PageEditor` |

## 2026-09-19 — three designed surfaces routed here by the parity survey

From M26's five-survey sweep (`docs/milestones/M26-design-parity.md`). M26 is a
parity milestone over data that already exists; these three are designed, drawn,
and blocked on this milestone. Recorded here so they are not rediscovered a
third time.

**1. The new-trip fork's paid half (SPEC §30.3).** After the last answer the
conversation forks on entitlements. **The free half is not blocked and M26 link
9 builds it** — one description, a quiet Plus note, a *See plans* button, and
the dock **absent rather than disabled** (§31.3). The **paid half is M9's**: a
live composer that continues the conversation in the trip's context, *"tell me
what to change and I will redraw it before you open it"*. That is generation,
and it stays behind `<Preview id="wizard-assistant-draft">`
(`NewTripWizard.tsx:444-452`) until this milestone lands it.

Note what the build already says out loud in its closing turn: the days are
empty, and *"what you said about pace and what the trip is about is not built in
yet"* — because `pace` and `feel` are collected and stored **nowhere**. There is
no field on `CreateTrip` or `TripDetail` for either. **If M9's generation is
meant to read the five answers, that field is this milestone's to add**, and it
is not currently in anyone's scope.

**2. `add-stop-suggestions` (`ActivityEditor.tsx:189`).** Still shelled, still
correctly tagged M9, still waiting on grounded place search — which is this
milestone's remaining link 1. No change; listed for completeness, because
`preview-registry.ts` now holds six entries rather than eleven and two of the
six are M9's.

**3. `Ask` in read-only, and it is the one with a real decision in it.**
SPEC §27 requires it: *"Ask stays available in read-only. A reader with a
question is the most likely visitor the demo has, and answering is not
changing."* The design goes further and specifies the guard rails — `propose()`
refuses and says why, both proposal **Keep** handlers are gated, and the
context line reads *"Reading &lt;trip&gt; · answers only"* so the limit is
stated **before** someone asks.

The build removes the assistant from `/demo` in four places and the server 403s
`demo-trip-unsupported`. **That is not an oversight; it is `KI-079`**, which
records why: `requireTripAccess` resolves a demo visitor as `viewer` *before*
`auth()`, so a viewer-gated `/ask` would be an **unauthenticated,
internet-facing model proxy on the operator's key**, with one shared
`demo-visitor` quota bucket and a Postgres write on a path ADR-031 keeps
DB-free.

**Three product decisions have to land before any of it is buildable** — who
pays for an anonymous turn, whether the `/demo` path may touch Postgres at all,
and what an anonymous prompt may reach. KI-079 names all three and is already
carried by this milestone. **M26 does not touch it**, and its file says so in
*Deliberately not here*.

**Also relevant to this milestone's own surfaces, from the same survey.** §9's
*"one panel, three presentations, and the user picks"* is **half built**: all
three geometries exist in `AssistantRail.tsx:311`, but the choice is hardcoded
per surface (`docked` on the trip board, `floating` in the notebook) and nobody
can pick. Dragging, clamping and re-clamp-on-resize are not built at all, and
`AssistantBubble.tsx:44-46` says so. **M26 link 10 takes this**, because it is
presentation over no new data — but it lands a **persisted position and open
state**, and that makes §29's *"the dock on `plans` is hidden, not unmounted"*
rule live for the first time. If M9 moves the dock or changes what it holds,
that rule is now load-bearing rather than theoretical.
