### KI-2026-10-05-j — the paid eval's trip has no non-travelling member, so `q-split-travellers` cannot fail — RESOLVED

- **Severity:** test gap. The prompt passes whether the assistant splits a cost over travellers or
  over members.
- **Area:** `apps/web/src/server/ai/eval/live.eval.ts`, `seedJapanTrip()`. The live set entry is
  `q-split-travellers` in `apps/web/src/server/ai/eval/live-set.json`, graded by
  `travellerSplitOfDay` in `cases.ts`.
- **Symptom / What happens:** the paid lane seeds its trip with `CreateTrip` and the Japan
  commands, so the eval actor is the only member. With one member, splitting day 1 over travellers
  and splitting it over members give the same number ($990). The expectation is computed from
  the seeded trip, and `grade.test.ts` proves the grader tells $990 from $792 on the demo roster,
  which includes Kenji, a member who is not travelling. The live run never sees that case.
- **Fix:** have `seedJapanTrip()` add one member who is not travelling, using `grantMembership`
  then `setTravelling(false)`, mirroring the demo's Kenji. The change shifts the comparison
  baseline for all 17 prompts, so do it in the same paid run that M35's eval gate box asks for,
  and note the baseline change in that run's record.
- **Cross-reference:** M35 exit gate (assistant live set re-run), travellers spec D6, M33 evals.
- **First noted:** 2026-10-05, PR #335 assistant review fixes.
- **Proof (resolved 2026-10-24, KI sweep):** the paired paid run could not be waited for: M35's
  eval box was ticked on Mitchell's word at its close (2026-10-06) without one. Reproduced with
  no model in a new integration test, `seedMembers.int.test.ts`, which seeds the trip as
  `seedTripFor` does: with the seeding as it was, `expected [ 99000 ] to not include 99000` —
  $990 over travellers and over members alike — and one member where two were expected. Fix:
  `seedMembers.ts`'s `addNonTraveller` upserts `eval-kenji`, grants him editor
  (`grantMembership`) and has the owner mark him not travelling (`setTravelling`), returning the
  detail with `effectiveMembers`; `seedTripFor` calls it for every trip prompt. The test is green
  (the stored trip's effective members match, and the split is the subtotal over one traveller,
  not over two members). **Baseline note:** every trip prompt's comparison baseline moves with
  this commit; the next paid run's record must say so. The paid lane itself was not run.
