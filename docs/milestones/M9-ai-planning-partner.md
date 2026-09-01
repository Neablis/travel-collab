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

## What is actually left — audit, 2026-09-01

Checked against `main` at `dd61c44`, not against the prose below.
Full working: `docs/reviews/2026-09-01-milestone-audit.md`.

**Four of the seven scope items below are shipped, and half of two more.**

| Scope item | State |
|---|---|
| Grounding (`SearchPlaces` → `placeRef`) | **Not built.** `READ_TOOL_NAMES` is `read_trip`, `read_day`, `find_free_time` — no place search exists |
| Honest unknowns | **Shipped** — `withoutFabricatedCost`, `writeTools.ts:173` |
| Thread contract | **Partial** — messages ride the request; **no conversation table** in `schema.ts`, so a reload loses the thread |
| Streaming | **Shipped** (M16) |
| Propose → review → approve | **Shipped** — `ProposalCard.tsx`, `POST /ask/apply` |
| Refinement | **Shipped** within a session |
| Observability | **Partial** — `askAnalytics.ts` records `steps`, `usageByStep`, `uncalledTools`, `droppedCalls`; **no replay harness exists** |

**So the remaining milestone is three things:** the assistant cites the places
it plans, its conversation survives a reload, and its behaviour is provable in
CI without a live call. That is what the new title names.

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
- [ ] No activity carries a fabricated cost — unknown reads as unknown, not as
      `0`/free.
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
- [ ] **The AI cannot leave a trip half-planned — KI-12.** "Plan me a trip"
      names the trip and sets its dates as part of the same approved batch. The
      headline flow finishes the job it advertises. *(Promoted to a gate box
      2026-09-01 by Mitchell's decision to assign every AI known issue to this
      milestone — see the section below for why three of twelve gate and nine
      do not.)*
- [ ] **Every vendor call goes through the quota — KI-93.** Server-side
      geocoding consults the geocode quota rather than spending the LocationIQ
      key through a second unmetered door. Grounding multiplies the traffic
      through that vendor, so this closes with it, not after it.
- [ ] **The step ceiling holds under concurrency — KI-94.** The quota's
      admission charge no longer lets simultaneous requests overshoot the global
      ceiling together. **KI-97 closes with it**, per its own entry — it is a
      tracking-only duplicate and must not be closed separately.
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
| **KI-93** | The geocoding path spends the LocationIQ key **without consulting the geocode quota at all**. Grounding is about to send far more traffic through that same vendor — closing the second unmetered door is part of building the first one, not a follow-up |
| **KI-94** (+ **KI-97**, its tracking-only duplicate) | The step quota's admission charge is one step, so concurrent requests overshoot the global ceiling together. A spend ceiling with a burst hole is the wrong thing to have when the switch flips. KI-97 closes with it, per its own entry |

### Carried, not gating (six)

Owned by this milestone — a fixer here should take them if the code is already
open — but **not gate boxes**, and the gate does not wait on them.

| KI | Why it does not gate |
|---|---|
| KI-10 | Batches don't recover a reference to an activity created later in the same batch. Reported via `resolutionErrors`, not silent, and the fix is in `resolveBatch` — which this file says explicitly **not** to rewrite. Needs its own call before anyone touches it |
| KI-9 | Model outputs validated ad hoc rather than at one typed boundary. Cleanup, defensive, no known reachable bug |
| KI-22 | The AI response envelope is not in `packages/contracts`. **`AGENTS.md` reserves a contracts change as its own reviewed PR**, so this cannot be a box inside another milestone's gate without breaking that rule |
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
| KI-22 | cleanup | The AI response envelope is not in `packages/contracts` |
| KI-24 | cleanup | `AI_LIVE` on Vercel is warned-about, not prevented |
| KI-80 | cleanup | Two phrasings of the same command list |

The full inventory each of those rows summarises, with severities, is in the
audit: `docs/reviews/2026-09-01-milestone-audit.md` §3a.
