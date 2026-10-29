### KI-2026-10-26-x — `m49-cover-reposition` e2e flakes: fails on a first attempt, passes on retry — RESOLVED

- **Severity:** reliability. A flake, not a known product defect: the spec passes on retry and
  has passed in every ci-like run recorded on M49 part 4 (PR 585) and M54.
- **Area:** `apps/web/e2e/m49-cover-reposition.spec.ts` (the drag test at :90 and the keyboard
  test at :136), and what it drives: `apps/web/src/components/trip/cover/RepositionCover.tsx`,
  `apps/web/src/components/trip/cover/TripCoverBanner.tsx`, and
  `apps/web/src/components/cover/CoverImage.tsx`, which M54 part 4
  made fade in on load.
- **Symptom / What happens:** seen flaking during M54's parts. The failing line and error text
  were not captured when this entry was filed: the check-run annotations of the 16 CI runs on
  `claude/m54-*` branches since 2026-10-25 do not name this spec, because a flake that passes on
  retry leaves a green job with no annotations. **Record the first failure text, its line and
  the run id here on the next occurrence.** If the failing line moves between runs, it is a
  timeout (CLAUDE.md rule 2), not a defect.
- **Frequency known so far:** intermittent during M54 (2026-10-26); no rate measured.
- **Why not fixed here:** not root-caused. Filed from M54's part 0 (prose-only) so the next
  occurrence is recorded against an entry rather than called flaky from memory.
- **Fix path / Tripwire:** on a failure, compare its line with this entry. If it is a cover
  fade-in race (part 4's `CoverImage` change), assert on the cover's settled state rather than
  its first paint. Run `pnpm --filter web test:e2e:ci-like e2e/m49-cover-reposition.spec.ts
  --repeat-each=20 --retries=0` to measure a rate.
- **Cross-reference:** M54 part 4 (covers fade in); M49 part 4 (PR 585); KI-20261024-c (CI red
  once, cause unknown).
- **First noted:** 2026-10-26, M54.
- **Reproduced (2026-10-28, KI sweep, production build):** `e2e/m49-cover-reposition.spec.ts
  --repeat-each=10 --retries=0` passed 20 of 20; at `--repeat-each=30`, **2 failed of 60**, both in
  the keyboard test (:136), at two different places:
  1. :160, `expect.poll(framing) Expected: 60 / Received: 61`, the Esc half's `ArrowDown` moving
     nothing. `startRepositioning(page, "keyboard")` returned once *Drag image to reposition* was
     visible, but `RepositionCover` focuses its slider in an effect after that paint, and the arrow
     was pressed in between. The first half already waited for the slider's focus; the second did
     not. **This is the cover's own flake, and the fix.**
  2. `createEmptyTripViaWizard` (`helpers.ts:521`), `create an empty one` *element was detached
     from the DOM, retrying*, then never found again for 30s. Not a cover fade-in race and not
     m49's: it is the shared wizard helper, the same signature KI-2026-10-24-c records on
     `m4-money-and-lenses.spec.ts:5`. Not reproduced in 75 further runs of m4 and m49 together
     (`--repeat-each=25`, 0 failed), and not fixed here: it needs an entry of its own.
- **Fix:** `startRepositioning` waits for the slider to be focused before a keyboard caller
  presses anything (`e2e/m49-cover-reposition.spec.ts`). No app change; the cover fade-in
  (`CoverImage`) was not involved in either failure.
- **Proof:** `--repeat-each=30 --retries=0` after the fix, **60 passed of 60**; with m4 at
  `--repeat-each=25`, 75 of 75. The failure seen before the fix is the red: it is the arrow
  landing before focus, and the new wait is on exactly that focus.
