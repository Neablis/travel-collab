### KI-2026-10-13-c — an unpriced live-eval turn counts as nothing against `EVAL_MAX_USD`, so a run can pass its cap unnoticed

- **Severity:** correctness. The cap is the eval runner's one guard on paid spend, and a turn it
  cannot price does not count towards it. Each case seen so far cost cents, but nothing bounds
  how many turns in a run go unpriced.
- **Area:** `apps/web/src/server/ai/eval/spend.ts:18` (`turnMicroUsd`, which returns null when
  `microUsdForSteps` or the classifier's `microUsdFor` returns null);
  `apps/web/src/server/ai/eval/live.eval.ts:249` (each turn's `microUsd`), `:324` (the skip
  check, `spentMicroUsd >= capMicroUsd`, the cap read from `EVAL_MAX_USD`) and `:354-355` (an unpriced turn adds 1 to
  `unpricedTurns` and nothing to `spentMicroUsd`); `apps/web/src/server/entitlements/usage.ts:281`
  (`microUsdForSteps`, null when any step is null).
- **Symptom:** a live-eval turn on a model that has a rate still comes back `unpriced` when one
  of its steps, or its classifier call, reports no token usage. The runner prints
  `cost: unpriced` and the summary adds `(+ N unpriced turn(s))`, but the cap check only reads
  `spentMicroUsd`, so the turn costs $0 as far as the cap is concerned. Seen twice:
  - `c-remove` (Opus 5.5, 3 steps, 36,377 tokens in, 228 out) at `main` `940df19`. About $0.09
    estimated from the other Opus turn in the same run, which would put the run near $0.47
    against the $0.3795 it reported.
  - `a-open-trip` (Sonnet 5.5, 2 steps, 4238 tokens in, 97 out) at PR 429's head `87c01b0`.
    About $0.0095 estimated at Sonnet's rate, against a reported run total of $0.0007.

  Both models have a rate (`t-reads-and-says-nothing` on Opus was priced in the same run, and
  Sonnet's rate is pinned at `modelRates.test.ts:40`), so the gap is a missing usage field and not
  a missing rate. Which step reported no usage cannot be read back: the run's private database
  is dropped at teardown.
- **Why not fixed here:** found by the live evals that closed M45. Filing it was Mitchell's call
  (2026-10-13), and part 0 is prose only. **Likely fix:** count an unpriced turn conservatively
  against the cap rather than as zero. Price it from whatever token counts the ledger does have,
  or charge a per-model ceiling for the missing part, and still flag it as an estimate in the
  report and the results JSON. Then find which step drops its usage, and say so in the turn's
  output rather than only "unpriced".
- **Cross-reference:** M33 (the spend cap, `spend.ts`'s header); M45's retro, *Leftovers*
  (`docs/milestones/M45-the-assistant-beyond-one-trip.md`); PR 420, PR 429.
- **First noted:** 2026-10-13, M45 close: the live eval at `940df19`, then PR 429's live eval at
  `87c01b0`.
