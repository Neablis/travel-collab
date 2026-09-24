### KI-2026-09-24-f — two source-sweep unit tests time out at 5000ms under full-suite load and pass alone — RESOLVED

- **Severity:** reliability — a red `pnpm check` that is not a defect in the code
  under test, which is exactly the kind of red that trains people to re-run.
- **Area:** `apps/web/src/server/billing/soleWriter.test.ts` ("writes the
  subscriptions table from two files and no others"),
  `apps/web/src/server/entitlements/planVersions.fourthPlan.test.ts` ("compares
  a plan id in no gate anywhere in the app"), and the helper they share,
  `apps/web/src/test-support/stripComments.ts`.
- **Symptom / What happens:** both tests fail with `Error: Test timed out in
  5000ms.` in a full `pnpm check`, and pass when their files are run alone. A
  second fixer saw both time out at a load average of 8.6 the same day.
- **Mechanism:** each sweep ran `stripComments` — a full
  `ts.createSourceFile` parse plus a `getChildren()` walk of every node — on
  every non-test source file under `apps/web/src` (~400 of 837), and
  `soleWriter` did it twice, once per sweep. The regexes were never the cost.
  Measured on this 4-core box: **idle 2.4–4.5s per test** (already most of the
  budget), and with 4× `yes > /dev/null` on top of other agents (load ~7):
  `writes the subscriptions table … 14463ms`, `moves an account's held plan …
  11105ms`, `compares a plan id in no gate … 14418ms`, all three
  `→ Test timed out in 5000ms.`
- **Why not fixed when first seen:** noted during the 2026-09-24 KI pass
  (cross-referenced from KI-2026-09-22-e's second observation) while working a
  different entry.
- **Cross-reference:** KI-013 (the same wall-clock-budget-under-load mechanism
  in jsdom), KI-2026-09-22-e (where the full-run timeouts were first recorded).
- **First noted:** 2026-09-24, full local `pnpm check` on the KI pass branch.
- **Fix (2026-09-24):** fixed the cost, not the timeout — no timeout was
  raised. A new `apps/web/src/test-support/sourceSweep.ts` walks the tree once
  per module (skipping `node_modules`, `.next`, `test-results`), reads each file
  once, strips each at most once, and offers `strippedIfMentions(file, token)`,
  which skips the parse when the raw text lacks a literal token every sweep
  pattern requires (`subscriptions`; `planId|planVersion`; a quoted plan id).
  That is sound, not a heuristic: `stripComments` only blanks characters to
  spaces, so a token present in the stripped text is present in the raw text.
  Parses drop from ~400 per sweep to 8, 44 and 13 files. Side effect, stricter
  not looser: `fourthPlan`'s old walk skipped every dot-directory, so
  `src/app/.well-known/**/route.ts` (shipped code) was never swept; it now is.
- **Proof:** after the fix, idle: 443 / 761 / 387ms (then 372 / 974 / 275ms);
  under the same 4× `yes` load (load ~11): 722 / 661 / 1718ms (then 608 / 481 /
  2168ms), no timeouts. Strictness, by mutation: appending
  `db.insert(subscriptions)`, `db.update(users).set({ planId: "plus" })` and
  `plan ===/* sneaky */"premium"` to `server/billing/checkout.ts`, plus a
  `p !== "free"` route under `app/.well-known/`, turned the subscriptions,
  held-plan and checkout sweeps red on `server/billing/checkout.ts` and the
  fourth-plan sweep red on both files; restored, all green. Regression test
  `src/test-support/sourceSweep.test.ts` (walk coverage incl. dot-dirs;
  pre-filter never hides a comment-split comparison) seen red by skipping
  dot-dirs and by testing the pre-filter against the path instead of the text.
  Checks: those four test files plus `stripComments.test.ts` (19/19),
  `eslint` on the touched files, `tsc --noEmit -p apps/web`, docstring wall.
