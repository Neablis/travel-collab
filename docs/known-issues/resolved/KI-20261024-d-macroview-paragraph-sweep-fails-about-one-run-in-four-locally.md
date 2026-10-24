### KI-2026-10-24-d — MacroView's "every widget is legal inside a paragraph" sweep fails about one local run in four — RESOLVED

- **Severity:** reliability (local unit runs). Not seen on CI as of this entry.
- **Area:** `apps/web/src/components/pages/MacroView.test.tsx`, `describe("every widget is legal
  where widgets actually go")` (from about line 475), which renders every registered widget.
- **Symptom / What happens:** run locally during M52 parts 7 to 9, the sweep failed roughly one
  run in four and passed on re-run with no change. The failing widget and message were not
  recorded.
- **Why not fixed here:** prose-only part 0. Next step: run the file in a loop
  (`vitest run -c vitest.unit.config.ts src/components/pages/MacroView.test.tsx`, 20 times) and
  record which widget and assertion fail. M52 added widgets that read a clock (`trip.now`
  re-renders each minute) and chat state, so a timer or an unawaited render is the first suspect.
  A timeout that moves between runs is load; a fixed place is a defect.
- **Cross-reference:** KI-2026-10-14-c (CI unit reds); KI-2026-10-24-e (another local timeout
  the same week).
- **First noted:** 2026-10-24, M52.
- **Resolved, 2026-10-24 (KI sweep): already fixed on `main`, by `d3ed000` (M52 part 8, review
  round 1), which gave the sweep its own 20 s budget.** That commit was not in this entry's
  history, so the entry was filed against the default 5 s. **Mechanism, reproduced:** with the
  `20_000` removed (reverted) and six copies of the file run at once on a 4-core box already at
  load 12, five of six failed `Error: Test timed out in 5000ms` on *renders no block-level element
  inside a paragraph* (killed at 5,034 to 5,568 ms); the sixth passed at 4,507 ms. Always that
  test and never an assertion, because it renders every preset in one test. Nothing else: the
  lazily loaded `TagCharts`, the one chart the sweep does not preload, imports in 8 to 60 ms.
  **Proof on current `main`:** 16 sequential runs at load 10 to 13 gave `Tests 31 passed (31)`
  each time, with the sweep at 2.0 to 2.3 s, and six concurrent runs passed with it at 2.9 to
  3.7 s, about a fifth of its 20 s. No change was needed. The failing widget was never recorded
  when this was filed, so tying those runs to the 5 s timeout rests on the entry's own suspicion
  and on this reproduction.
