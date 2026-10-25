### KI-2026-10-24-p — e2e command-palette keyboard walk flakes on palette focus

- **Severity:** reliability. A timing flake in shard `test / e2e (2/2)`: when it flakes it
  fails the run, and it passes on a later head with no related change.
- **Area:** `apps/web/e2e/m41-command-palette.spec.ts` (the "a trip walked from the
  keyboard alone" test), `apps/web/e2e/helpers.ts` (palette dialog assertions).
- **Symptom / What happens:** the keyboard-walk test fails on palette focus
  assertions. On the observed occurrence, Retry #1 also failed:
  - `expect(locator).toBeVisible()` failed for
    `getByRole('dialog', { name: 'Go to or do' }).getByRole('option', { name: /PaletteOther/ })`
    (strict-mode violation reported on the option locator).
  - `expect(locator).toBeFocused()` failed for
    `getByTestId('day-column').nth(1).getByRole('button', { name: /^Day 2/ })`
    (5s timeout, received inactive).
  The test drives the whole trip from the keyboard, so a focus assertion that fires
  before the dialog option renders, or before focus lands on the day column, fails
  the test even though nothing about the feature changed.
- **Evidence (the occurrence):** PR #548, CI run 40146841543, job 121029932539,
  `test / e2e (2/2)`, head `20519705` (a main-merge commit): 1 failed, 1 flaky,
  177 passed. The failed test is `[desktop] e2e/m41-command-palette.spec.ts:48:1`.
  The flaky companion in the same run, `e2e/m4-money-and-lenses.spec.ts:5:1`
  (click timeout waiting for a "create an empty one" button), passed on retry and
  did not fail the run.
- **Why it is a flake, not a regression:** both e2e shards passed on the
  pre-merge head `fcd851ba` (run 40140715678) and on the fix head `e44db129`
  (all CI green, `ci-ok` success). The only commit between `20519705` and
  `e44db129` touched a unit-test mock and two generated JSON snapshots — no e2e
  code, no palette code, no board code. The failure is unrelated to the PR under
  test and did not reproduce on either adjacent head.
- **Why not fixed here:** one occurrence does not distinguish a slow runner from
  a real race in palette focus timing, and there is nothing to act on yet.
- **Fix path / Tripwire:** on the next occurrence, capture the run's Playwright
  report artifact and record the failing assertion here. If it recurs on
  unrelated PRs, investigate the palette dialog's option-render vs focus-assertion
  race (or the day-column focus handoff) rather than re-running blindly; if it
  keeps passing on re-run, leave this entry as the record of a one-off.
- **Cross-reference:** KI-20261024-c (CI's e2e went red once, cause unknown).
  This is the first NAMED occurrence of that phenomenon: the `-c` entry's
  "naming the next one" note predicted the github reporter would name the spec,
  test and message, and it did. The `-c` entry stays open, since the cause here
  is still suspected timing, not found.
- **First noted:** 2026-10-24, on PR #548's CI.
