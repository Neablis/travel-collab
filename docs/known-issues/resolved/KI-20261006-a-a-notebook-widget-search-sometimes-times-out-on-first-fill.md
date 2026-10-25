### KI-2026-10-06-a — a notebook test sometimes times out on its first fill of the widget search — RESOLVED

- **Severity:** minor. One retry-pass in a full ci-like run. A retry passes, and so do repeats
  of the test on its own.
- **Area:** `apps/web/e2e/m14-notebook-widgets.spec.ts:754`, *a sentence inserted mid-sentence
  lands after it, never splitting it*. It fails at `search.fill`, while waiting for
  `getByRole('searchbox', { name: 'Search widgets' })`.
- **Symptom / What happens:** in the full `pnpm --filter web test:e2e:ci-like` run on M37 part 5
  (2026-10-06), the run reported 243 passed and 1 flaky.
  - This test timed out on its first attempt and passed on retry.
  - Rerun alone against the same production build with `--repeat-each=8`, it passed 8 of 8.
  - The branch touches nothing in the notebook or widget code.
- **Not yet known:** whether it fails in the same place every time. Rule 2 says a failure whose
  location moves is a timeout, and one that stays put is a defect. One sighting cannot tell
  them apart.
- **Next step:** if it recurs, record where it fails. If it fails at the same `search.fill`,
  look at what opens the widget rail before the search box mounts.
- **First noted:** 2026-10-06, M37 part 5's Tier 3 run.
- **Resolved:** 2026-10-25, KI sweep 2. Reproduced: `--repeat-each=12` against a production build
  failed 3 of 12, and 5 of 16 on a second batch, always at the **second** `search.fill` (the
  mid-heading insert, not the first), `locator.fill: Test timeout of 30000ms exceeded … waiting for
  getByRole('searchbox', { name: 'Search widgets' })`, with *The days in detail*'s settings in the
  column. Mechanism, from an editor transaction log in the failing runs: the repeat just inserted is
  a ProseMirror node selection; `heading.click()` puts the DOM caret in the heading, but ProseMirror
  adopts it only on Chrome's `selectionchange`, a task later. The walk pressed Home within ~10 ms of
  the mouseup, so Home and the arrows moved from the repeat (no transaction for the click at all),
  and the second ArrowRight node-selected the day widget after it. The rail never returned, so the
  searchbox never mounted. Fix (`e2e/m14-notebook-widgets.spec.ts`): after the click, wait for the
  rail's searchbox, the product's own signal that nothing is selected, before pressing a key. Proof:
  the same test `--repeat-each=20` on the same build, 20/20; then
  `pnpm --filter web test:e2e:ci-like e2e/m42-demo-trips.spec.ts e2e/m37-trip-covers.spec.ts
  e2e/m46-trip-chat.spec.ts e2e/m14-notebook-widgets.spec.ts e2e/responsive.spec.ts`, 104 passed,
  none flaky. The pre-fix reds are the seen-it-fail. The same keypress-before-`selectionchange` gap
  may be KI-2026-09-26-a's mechanism (a click into a heading right after binding a link widget
  "did not reach the heading"); not checked here.
