### KI-2026-10-24-d — MacroView's "every widget is legal inside a paragraph" sweep fails about one local run in four

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
