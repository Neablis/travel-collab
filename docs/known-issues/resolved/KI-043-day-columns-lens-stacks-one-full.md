### KI-43 — The Day-columns lens stacks one full-width Banner per conflict above the board — RESOLVED

- **Severity:** cosmetic (no wrong data — but it hides the surface it sits on)
- **Area:** `apps/web/src/components/board/Board.tsx:201` (`ConflictBanner`)
- **Symptom:** `ConflictBanner` renders one full-width `Banner variant="warning"`
  per undismissed conflict, unbounded, between the tab strip and the day
  columns. The Japan seed carries 12, which is ~700px of stacked warning: at
  1440×900 the first day column is entirely below the fold, and the lens looks
  broken on open. Each banner also repeats both stops' full geocoded addresses,
  so a single line wraps to two.
- **Why the design disagrees:** the handoff never stacks conflicts. Timeline
  attaches `act.conf` (a compact tinted strip with Fix/Dismiss) directly under
  the activity it belongs to; Day columns puts a one-line `act.confShort` chip
  *inside* the card. `Column.tsx`/`ActivityCard.tsx` **already render that
  in-card treatment** — it receives `overlap` and `conflictIds` and uses them —
  so the wall above is redundant with it rather than the only route to the
  information.
- **Not just cosmetic in one respect:** Timeline's inline `OverlapWarning`
  covers *overlaps* only. The seed's conflicts are mostly distance conflicts
  ("~309 km apart on the same day"), which on Timeline reduce to a bare warning
  `Badge` with no explanation anywhere. So deleting the wall without moving the
  copy would lose it. The fix is to move the copy inline, not to drop it.
- **Fix path:** render the conflict against its subject the way the design does
  (in-card in Day columns, under-the-row in Timeline), and keep at most a
  collapsed summary at the top if a whole-trip count is still wanted.
- **Partly fixed (2026-08-26, PR #55):** the summary half is in. Above two
  undismissed conflicts the list collapses to one line ("12 things to look at
  on this trip" + Show), so the first day column now sits at y=420 of a 950px
  window instead of below the fold. Collapsed, not truncated — expanding still
  gives every conflict with its own Dismiss and jump.
- **Resolved (2026-08-28):** the second half is in, at a location Mitchell
  chose on a Vercel preview thread rather than the one the fix path above
  guessed: **the activity editor**, not an in-card chip. Opening a stop for
  editing now lists every conflict naming it
  (`apps/web/src/components/trip/editor/ActivityConflicts.tsx`, rendered by
  `ActivityEditorSheet`), in the conflict's own `description` — the same
  string `ConflictBanner` renders, so there is no second copy to keep in sync.
  Distance conflicts therefore have somewhere the words exist besides the
  board list, which is what this entry was actually about.
- **Deliberate difference from the fix path above:** the copy did not move
  in-card in Day columns or under-the-row in Timeline, and the collapsed board
  list stays exactly as PR #55 left it. Both surfaces keep their compact
  treatment (chip / `OverlapWarning` / triangle); the editor is the place the
  full text always exists. The handoff's per-lens conflict treatment
  (`act.conf` under a Timeline row, `act.confShort` inside a Day-columns card)
  is therefore still unbuilt as drawn — a design question that outlived this
  entry rather than a defect it is still carrying. If it is picked up, it
  starts from `docs/design-feedback/2026-08-26-design-sync-ui-audit.md` A2 and
  `.design-sync/handoff/DRIFT.md`, not from here.
- **Dismissed conflicts are shown too, marked rather than hidden**, and that
  is load-bearing rather than a flourish. It is what made it safe to fix the
  sibling bug in `overlapData.ts`'s `badgeableConflictSubjects`
  (2026-08-28): its dismissal exclusion was folded into the overlap branch
  (`c.kind !== OVERLAP_KIND || !surfaced(c)`), so a dismissed **non**-overlap
  still badged its card forever — banner gone, triangle stranded, nothing on
  screen to explain it or dismiss it again. Dismissal now suppresses the badge
  for every kind, because the editor is the surface that never filters.
- **First noted:** 2026-08-26 (design-sync UI audit, `docs/design-feedback/2026-08-26-design-sync-ui-audit.md` A2). **Resolved:** 2026-08-28.
