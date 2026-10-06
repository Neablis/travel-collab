### KI-2026-10-06-a — a notebook test sometimes times out on its first fill of the widget search

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
