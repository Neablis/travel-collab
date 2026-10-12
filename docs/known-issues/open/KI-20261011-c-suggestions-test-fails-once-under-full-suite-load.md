### KI-2026-10-11-c — `suggestions.test.tsx` fails once under a full local web unit run

- **Severity:** minor. Local noise only so far; CI's `test / unit` has been green on the same heads.
- **Area:** `apps/web/src/components/board/suggestions.test.tsx`.
- **Symptom:** a full local `pnpm --filter web exec vitest run -c vitest.unit.config.ts` failed
  in this file once in about 5,650 tests, on two different heads of PR 410 (`8511522`, then
  `c68b00b`). Neither head touches suggestions code. Run on its own, the file passes. The
  part-reviewer reported it both times but did not capture the assertion text.
- **Why:** not known. A failure that only appears under full-suite load points at a timeout or
  shared state (a fake timer, a module mock, a global) rather than a defect. CLAUDE.md rule 2: a
  timeout fails in a different place from run to run, and a real defect fails in the same place
  every time. Capture the failure text before deciding.
- **Fix direction:** run the full web unit lane a few times with `--reporter=verbose`, and keep the
  failing assertion and its stack. Then either make the test robust to load (wait for the state it
  needs, not a fixed tick) or fix the shared state it leaks.
- **First noted:** 2026-10-11, M42 (PR 410 review).
