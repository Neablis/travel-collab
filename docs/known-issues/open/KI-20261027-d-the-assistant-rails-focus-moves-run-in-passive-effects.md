### KI-2026-10-27-d — The assistant rail moves focus from passive effects, a task after the commit that drew it

- **Severity:** reliability (tests), low. No user-visible failure is known. A test that reads
  `document.activeElement` straight after a `findBy`/`waitFor` resolves can read it before the
  move, and has to wait for the focus instead.
- **Area:** `apps/web/src/components/assistant/AssistantRail.tsx`: `focusOpenTab` (:717-720),
  called from three `useEffect`s: on mount when `takeFocus` says so (:721-726), on a tab switch
  not made from the strip (:746-759), and when the chat's read lands (:764-769).
- **Symptom / What happens:** M54 part 4 found its unit tests failing about one run in ten under
  load, at a different test each time, because state was read the moment a DOM query resolved
  while a passive effect wrote it a scheduler task later (commit `ab6af0f`). The phone Ask's
  registration moved to layout effects and the race closed. The rail's focus moves were left in
  passive effects; its tests were changed to wait for focus instead (`ab6af0f`, `474a2b9`).
- **Why not fixed here:** outside part 4's fix, and moving focus in a layout effect runs it
  before paint, which needs checking against the PR 442 rule (a sheet's composer taking focus
  raises the phone's keyboard) and the ⌘K open path. Confirmed by reading the code at the M54
  close; not reproduced as a user-facing defect.
- **Fix path / Tripwire:** move the three focus moves to `useLayoutEffect`, then drop the
  focus-waits the part 4 tests added and see them stay green over repeated runs under load.
  If a test that reads focus at once flakes again, this is the first place to look.
- **Cross-reference:** KI-2026-10-13-a (the registration half, fixed in part 4); M54 part 4,
  PR 601; part 7, PR 605.
- **First noted:** 2026-10-27, M54 gate close (candidate from the build's hand-off, confirmed by
  reading `AssistantRail.tsx` at `e9a46b0f`).
