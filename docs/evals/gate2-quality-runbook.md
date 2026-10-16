# Gate 2 — Quality parity at lower cost: runbook

**What this is.** The second offline gate for the plan-retrieval RAG stack
(Part 5). Gate 1 proved examples can be *found* (recall@5 0.740). Gate 2 proves
plans built *from* them cost less at the same quality. Failing it stops the
stack — the flag stays off.

**The bar (agreed).** Quality parity PLUS either:
- (a) ≥25% fewer output tokens (same tier, with vs without examples), OR
- (b) a successful tier drop (cheaper tier + examples matches the stronger
  tier's quality without examples).

## Running it

Mitchell runs paid evals himself. The eval refuses without confirmation:

```sh
# From the repo root, on the Part 5 branch (or main once merged):
GATE2_PRODUCTION=1 GATE2_USER_ID=<your-user-id> GATE2_CONFIRM=1 \
  TRAVEL_COLLAB_EVAL_KEY=<your-gateway-key> DATABASE_URL=<neon-url> \
  RAG_PLAN_RETRIEVAL=1 \
  pnpm --filter web eval:run -- planRetrieval.gate2
```

Notes:
- `RAG_PLAN_RETRIEVAL=1` is required: `getPlanExamples` is flag-gated, and the
  eval measures the flag-on path against the flag-off baseline.
- Production mode uses the already-backfilled Neon. Fixture mode (default)
  seeds and embeds first — slower, for development.
- 10 queries × 3 arms (strong, strong+examples, mid+examples) + 20 judge calls
  (cheap tier). Expect dollars, not cents. The run prints the plan first.

## What it measures

For each query, three arms generate a plan from the same prompt template —
the ONLY variable between A and B is the example block:

| Arm | Model tier | Examples | Purpose |
|-----|-----------|----------|---------|
| A | strong | none | Baseline: today's path |
| B | strong | yes | Does retrieval cut tokens at parity? |
| C | mid | yes | Does a cheaper tier + examples match A? |

An LLM judge (cheap tier) compares B vs A and C vs A on completeness,
specificity, coherence, and relevance. Verdict per pair: `A_BETTER`,
`B_BETTER`, or `TIE`.

**PASS** = judge never rates A strictly better than B (parity holds) AND
(mean token reduction ≥25% OR judge never rates A strictly better than C).

The JSON report lands in `apps/web/eval-results/gate2-*.json` (git-ignored).

## Rollout plan (after Gate 2 passes)

The flag is `RAG_PLAN_RETRIEVAL` (env var, off by default).

**Stages:**
1. **Off (today).** No behavior change. Baseline ledger numbers accumulate.
2. **On for Mitchell only.** Set the env var on a preview deployment, or gate
   by user id in code. Dogfood: run real plan turns, check the `rag: plan
   examples` logs for retrieved-vs-used.
3. **On in production.** Set `RAG_PLAN_RETRIEVAL=1` on the Vercel production
   env. This is a deploy-time switch — no percentage rollout without a Vercel
   Flag (left as a future option; the user base is small enough that a binary
   switch is proportionate).
4. **Watch for one week**, then decide on the tier drop (decision 7 in M48).

**Monitoring (what to watch):**
- `rag: plan examples` logs: retrieved count per turn, and the `used` heuristic
  from Part 4. If retrieval consistently returns examples the model ignores,
  the prompt injection needs work.
- Error rate: `rag: plan example lookup failed` — should be rare; the path is
  fail-open, so failures are silent to users but visible here.
- Latency: retrieval runs under a 2s budget inside the turn. Watch p95 turn
  latency for regressions.
- Ledger: output tokens per plan turn (the M31 ledger), flag on vs the
  baseline. This is the dollars-per-plan-turn number M48 cares about.

**Rollback:**
Set `RAG_PLAN_RETRIEVAL=0` (or unset) and redeploy. The serving path is
byte-identical to today's with the flag off (pinned by Part 4 test), so
rollback is a config change, not a code revert. If quality drops are observed,
rollback first and diagnose second.

## If Gate 2 fails

- **Quality drops (judge rates A better):** the examples are hurting, not
  helping. Likely causes: irrelevant examples (retrieval precision), or the
  prompt injection confusing the model. Do NOT ship; revisit the example
  selection or prompt format.
- **Tokens don't drop <25%:** the model writes as much with examples as without.
  The feature still works (quality parity), but the cost thesis fails. Options:
  fewer/longer examples, a stronger "adapt, don't invent" instruction, or close
  the milestone — the ledger decides.
- **Tier drop fails but (a) passes:** ship on token savings alone; revisit the
  tier drop when models change.
