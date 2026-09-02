---
name: write-a-test
description: Write a test in travel-collab that is worth its cost — pick the right layer, reuse what exists, take data from @tc/factories, and prove the test can fail before calling it done. Use when adding a test, covering a case, or when a fix needs regression coverage.
---

# Write a test

`docs/guidelines/testing.md` is the reference. This is the procedure. Follow the
steps in order; **step 6 is the one that matters and the one most likely to be
skipped.**

## Procedure

1. **Name the failure mode in one sentence.** "If X changed, Y would break and
   nobody would notice." If you cannot write that sentence, stop — there is no
   test to write here. A test written because a PR "should have tests" is a cost
   with no return.

2. **Pick the layer** from the decision table in `docs/guidelines/testing.md` §1.
   One layer. If the answer is "styling only", the answer is **no test** — the
   colour wall owns that.

3. **Check whether it is already covered.** This is the step that stops the
   suite regrowing.
   - `grep -rn "<the function or component>" --include=*.test.ts --include=*.test.tsx apps packages`
   - If a test file for that unit exists, **extend it** — do not add a file.
   - If an existing test would already go red for your failure mode, you are
     done. Say so instead of writing a duplicate.

4. **Take data from `@tc/factories`.** `tripDetailFixture(overrides)`, or a
   named state from `packages/factories/src/scenarios.ts`. If neither fits, add
   a scenario **there**, not a hand-built object in the test. Hand-built
   rollups drift from the real shape and then prove nothing.

5. **Copy the canonical example** for that layer from
   `docs/guidelines/testing.md` §6, and follow the locator ladder in §5 — find
   by role or label, never by text. Property test? It carries a `witness` floor,
   and the floor is **measured**, never guessed: log the real count over a few
   runs, set it near half the observed minimum.

6. **Prove it can fail. Red first.**
   - Break the code the test protects — delete the guard, flip the comparison,
     return the wrong branch.
   - Run the test. **Read the failure message.** It must fail *for your reason*,
     not because something threw.
   - Restore the code. Run again, green.
   - Put the source edit and the real failure text in the PR under
     *Verification actually performed*.

   If it passes with the fix removed, it proves nothing — no matter how
   reasonable it looks. Three tests in one session on 2026-09-02 passed while
   asserting nothing, and every one was caught only here. Common shapes:
   a `waitFor` on a value that cannot change between retries; an effect keyed
   so it never re-runs; an assertion on a value derived from the same source as
   the expectation.

   Too many branches for "delete the fix" to mean one thing? Use
   `pnpm mutate <paths>` instead and read the surviving mutants.

7. **Run the narrowest command that covers it** — chain to the
   `minimal-check-subset` skill. Not `pnpm check`.

8. **Re-read what you wrote and apply the three questions**
   (`docs/guidelines/testing.md` §2): can you name a change that breaks it; would
   that change break no other test; would that change be a real bug rather than
   a refactor? Any "no" → delete it.

## What the walls will reject

Do not discover these by failing `pnpm lint`: no `toHaveClass` outside
`src/components/ui/**`; no `container.querySelector` or node traversal; no
`waitForTimeout` without an `e2e-sleep-allowed:` reason; `findBy*` over
`waitFor` + `getBy*`; no `screen.debug()` left in. And **never copy a
`KI-2026-09-02-b` disable comment into new code** — those are grandfathered
violations, not examples.
