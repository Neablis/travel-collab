### KI-2026-10-24-e — `noRawSyntax.test.tsx` hit Vitest's 5 s timeout once — RESOLVED

- **Severity:** reliability. Seen once; passed on re-run.
- **Area:** `apps/web/src/components/pages/editor/noRawSyntax.test.tsx`; the shared detector in
  `apps/web/src/test-support/rawSyntax.ts`.
- **Symptom / What happens:** during M52 one test in the file failed with Vitest's default
  `Test timed out in 5000ms`, then passed unchanged. Which test was not recorded.
- **Why not fixed here:** one occurrence. The file renders every widget through the editor, and
  M52 added several. If it recurs, record the test, and either split the walk per widget or give
  that test an explicit timeout with a comment naming the measured run time. Do not raise the
  timeout without measuring.
- **Cross-reference:** KI-2026-10-24-d (MacroView's registry-wide sweep, the same shape).
- **First noted:** 2026-10-24, M52.
- **Resolved, 2026-10-24 (KI sweep):** the test is *in Reading* or *in Editing*, the two that
  mount one page holding every preset and every registered widget through the editor, on the
  default 5 s. **Reproduced:** measured with `--reporter=verbose` on a 4-core box, alone they
  take 1.0 to 1.6 s. With six copies of the file running at once they took 2.5 to 4.2 s. With
  eight (load average 15) three of the sixteen failed `Error: Test timed out in 5000ms`: once
  *in Editing* (6,046 ms) and once both in one run (5,147 and 5,557 ms). Always these two, never
  an assertion, so it is load, not a defect. The page-of-repeats tests already had their own
  budget and now take about 40 ms. **Fix (test only):** a measured `WHOLE_PAGE_BUDGET_MS =
  20_000` on those two tests, with the measurements in its comment, the same shape as
  `MacroView.test.tsx`'s sweep (`d3ed000`). **Proof:** eight concurrent copies again, at load
  average 21: `Tests 9 passed (9)` in all eight, the two tests at 3.3 to 9.5 s.
