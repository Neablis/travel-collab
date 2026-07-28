# M9 — AI as a planning partner

**Status:** Not started. Phase 2. Depends on M8's trip-lifecycle contract work.

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

## Scope

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
- [ ] Recorded real-model transcripts replay in CI without a live call.
- [ ] Retro appended at gate close.
