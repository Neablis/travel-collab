### KI-2026-10-28-e — `createEmptyTripViaWizard`'s *create an empty one* button detaches during the click and is never found again

- **Severity:** reliability (e2e). A first-attempt failure in whichever spec happens to create a
  trip at that moment; it has passed on retry each time it has been seen.
- **Area:** `apps/web/e2e/helpers.ts` (`createEmptyTripViaWizard`, the `create an empty one`
  click), and what it drives: the new-trip sheet's quiet row (SPEC §35.2).
- **Symptom / What happens:** Playwright logs `element was detached from the DOM, retrying` on the
  `create an empty one` button, then the click times out after 30 s with the button not found.
  Seen once in about 135 runs of `m49-cover-reposition.spec.ts` (with and without
  `m4-money-and-lenses.spec.ts` beside it) during the 2026-10-28 KI sweep. It is the same signature
  KI-2026-10-24-c records for `m4-money-and-lenses.spec.ts:5` on PR 548 and PR 565 ("create an
  empty one" detached during the click).
- **Hypothesis, not verified:** the sheet re-renders the quiet row (or the whole turn) after the
  name is typed, for example when a place lookup for the typed name answers, so the node Playwright
  resolved is replaced and the replacement is hidden or renamed. A row that never comes back
  suggests the sheet moved to another turn, not a plain re-render.
- **Hypothesis now unlikely (review of PR 642, 2026-10-30):** M56 part 2 replaced the typed
  name with a picked place. The e2e helper's fake place has `hasPlaybooks: false`, so no
  `searchPlaybooks` read answers after the pick, and the helper waits for the pick to settle
  (`new-trip-decided`) before clicking. The click is still there, so this stays open on its
  tripwire.
- **Why not fixed here:** found while fixing KI-2026-10-26-x (2026-10-28 KI sweep, e2e group). It
  did not recur in the runs after, so there was nothing to measure a fix against.
- **Fix path / Tripwire:** on the next occurrence, capture the trace and check what the sheet
  shows when the click fails. If a lookup answer re-renders the row, wait for the sheet to settle
  (the lookup's response, or a settled attribute) before clicking. Measure with
  `--repeat-each=30 --retries=0` on `m4-money-and-lenses.spec.ts` and
  `m49-cover-reposition.spec.ts` together.
- **Cross-reference:** KI-2026-10-24-c (unnamed e2e reds; m4's flaky companion); KI-2026-10-26-x.
- **First noted:** 2026-10-28, KI sweep (e2e group).
