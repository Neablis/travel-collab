### KI-2026-10-24-e — `noRawSyntax.test.tsx` hit Vitest's 5 s timeout once

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
