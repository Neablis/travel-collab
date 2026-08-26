# M9 — AI as a planning partner

**Status:** Not started. **Moved to last in the execution order — after M14 —
on 2026-08-25 by ADR-022**, on Mitchell's call that the data layer beneath a
planning partner should exist first and that UI polish and sharing come before
it. Numbers unchanged; this is a placement, the same shape as ADR-018/ADR-021.

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

- [ ] **At least one exit criterion is a real, non-mocked model call, with its
      `meta` pasted into this file.** M7's post-gate retro asked for exactly
      this after seven live failures slipped past a fully green mocked suite;
      "covered locally by mocked tests" was treated as equivalent coverage and
      was not.
- [ ] A plan is built conversationally over several turns, refined by a
      correction, and committed only on approval — as one atomic batch, one
      history entry, one undo.
- [ ] Rejecting a proposal leaves the trip untouched.
- [ ] **The 2026-08-02 Rochester prompt is re-run verbatim and every activity
      with a location has real coordinates in the right region** — no silent
      coordinate-less place, nothing on another continent. This prompt is the
      regression test for grounding — **KI-15 keeps it verbatim, as typed**, so
      it can be replayed exactly rather than approximated.
- [ ] No activity carries a fabricated cost — unknown reads as unknown, not as
      `0`/free.
- [ ] Recorded real-model transcripts replay in CI without a live call.
- [ ] Retro appended at gate close.
