### KI-2026-09-20-b — three orphans of the deleted Timeline lens are still in the tree — RESOLVED

- **Severity:** cosmetic, but actively misleading. The code reads as shipped
  behaviour, is maintained by lint and type checks, and describes a surface
  users cannot reach.
- **Area:** `apps/web/src/components/lenses/OverlapWarning.tsx`,
  `apps/web/src/components/trip/EndOfTrip.tsx`,
  `apps/web/src/components/lenses/timelineData.ts`, and their tests.
- **Symptom / What happens:** SPEC §24 deleted the Timeline lens. These three
  modules were its, and none has a production importer. `OverlapWarning` and
  `EndOfTrip` survive only as prose in other files' comments —
  `ActivityCard.tsx:39` ("the columns' compact form of the timeline's
  `OverlapWarning`"), `overlapData.ts:55`, `ActivityConflicts.tsx:13`, and
  `Board.tsx:68-75`, which is the clearest account of what happened: *"§24
  deleted that lens, which took `EndOfTrip` — and with it this button, its
  dialog and the whole insert half of the keep-a-day loop — out of the running
  app entirely."*

  `timelineData.ts` has no references at all, in code or comment.

- **Why this is worth an entry rather than a silent delete:** the comments
  above are load-bearing — they explain why `Board` carries controls that look
  misplaced. Deleting the modules without reading those four references would
  strand explanations that point at files which no longer exist. The cleanup is
  small; the reading is the work.

- **How it was found:** the 2026-09-20 no-production-importer sweep, described
  in `KI-2026-09-20-a`.

- **Fix sketch (not done):** delete the three modules and their tests, then fix
  the four comments to describe the behaviour rather than the vanished
  component — `ActivityCard.tsx:39`'s "the timeline's `OverlapWarning`" wants to
  become a description of the overlap rule itself. Check `Board.tsx:68-75`
  survives as the record of §24's deletion, because that note is the reason
  anyone can follow the keep-a-day loop today.

- **First noted:** 2026-09-20.

- **Fix (2026-09-24):** deleted `lenses/OverlapWarning.tsx`,
  `trip/EndOfTrip.tsx`, `lenses/timelineData.ts` and their three tests, plus
  their three grandfathered lines in `scripts/docstring-wall-baseline.json`.
  The wall fails on a stale baseline entry, so the deletion needs that edit.
  Comments that described the deleted modules as live now describe the
  behaviour instead: `ActivityCard.tsx` states the overlap rule (the chip hangs
  off the later stop of a pair, the one that would move); `overlapData.ts`
  says Board is now the only caller of the badge rule; `ActivityConflicts.tsx`
  names the card's overlap chip; `AddSavedDayButton.tsx` and
  `preview-registry.test.ts` both said `EndOfTrip` mounts the button, and now
  say Board's "One more day?" column does; `rackDropWindow.ts` no longer cites
  `timelineData.ts`'s untimed sort. **`Board.tsx`'s change is comment-only.**
  The header paragraph that explained why it did *not* import `EndOfTrip.tsx`
  now says the column started as the Timeline block's twin and is now the only
  end-of-trip surface. The §24 note at the "Add a saved day" slot (`:68-75`) is
  **kept as written**, because it was already past tense and is the record of
  the deletion. Past-tense history elsewhere (`TripBoardScreen.tsx`,
  `lib/time.ts`, `db-seed.ts`, the other `preview-registry.test.ts` notes) was
  left alone.

- **Proof:** before the change,
  `git grep -nE "from \"[^\"]*(OverlapWarning|EndOfTrip|timelineData)\""`
  matched only the three modules' own tests. There was no production importer,
  static or dynamic. After it, `pnpm --filter web typecheck` exits 0,
  `pnpm --filter web lint` exits 0, `node scripts/check-docstring-wall.mjs`
  prints `docstring wall OK (587 files, … 442 grandfathered)`, and the unit
  tests of every file whose comments changed pass (5 files, 68 tests). No
  regression test was added: this was dead code, not a behaviour, and guarding
  against orphaned modules belongs to the sweep (`KI-2026-09-20-a`), not to
  this entry.
