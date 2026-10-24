### KI-2026-10-11-c — `suggestions.test.tsx` fails once under a full local web unit run — RESOLVED

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
- **Resolved, 2026-10-24 (KI sweep):** **reproduced under load, in the same place every time.**
  With four copies of the file running at once on a 4-CPU container already at load 11, seven
  runs of eight failed `TestingLibraryElementError: Unable to find role="button" and name
  "Suggested: Added Gelato to Day 2"` at `suggestions.test.tsx:138`, the first test's first
  `findByRole`. With eight copies, eight of eight failed there, and some runs also failed the
  first wait of another test (`"4 suggestions"`, `"1 suggestion"`). **Mechanism, measured:** each
  test's first wait covered the board's whole mount *and* the suggestions read behind it, now
  also an idle wait (a 200 ms timer in jsdom), on Testing Library's default 1 s. The first test
  pays the cold mount: 0.55 to 0.6 s to draw the trip with one copy running and 1.7 to 3.7 s
  with eight. The suggestion itself followed in 0.1 to 0.8 s. **Fix (test only):** `mount` is
  async and waits for the board to draw the trip on its own measured `BOARD_DRAWN_BUDGET_MS`
  (10 s, measurements in its comment). Each test's wait for a suggestion keeps the 1 s default,
  so it still bounds the read. **Proof:** with four copies running, one batch gave 4 of 4 `Tests
  25 passed (25)`. Two more batches, matching the eight runs above and at load 16 by then, gave 6
  of 8. The two reds were only Vitest's 5 s *test* timeout (`:149`, the first test, and `:291`,
  the suggester's unsent stop) and never the 1 s wait. That residual is 4x CPU oversubscription
  and is left alone (see below). This entry's 2026-10-11 failure text was never captured, and the
  idle wait came later, so tying that failure to this cold-mount budget is an inference. The cold
  mount inside a 1 s `findBy` was already there in 2026-10.
- **Left alone:** at about four times CPU oversubscription the file's two longest tests can still
  exceed Vitest's default 5 s. With four copies at load 13 the slowest test took 1.4 to 1.7 s,
  three times inside it, so this was not raised.
