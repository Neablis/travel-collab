### KI-2026-09-25-c — dragging a stop card toward a day column off screen to the right does not scroll the columns sideways

- **Severity:** usability, desktop Plan. A card can still reach any day (scroll
  the row first via the sticky bar, the day chips or shift+wheel, then drag),
  but the gesture a reader tries first — drag to the edge and wait — does
  nothing.
- **Area:** `apps/web/src/components/board/Board.tsx` — only
  `autoScrollWindowForElements` is registered for drag-and-drop; the
  `[role="group"][aria-label="Day columns"]` row has no element auto-scroll.
- **Symptom:** with a trip wider than the viewport, dragging a card to the
  row's right edge scrolls nothing; the target column stays off screen.
- **Why not fixed here:** found by KI-2026-09-22-b's fixer (2026-09-25
  overnight sweep); pre-existing and outside that entry. Intended fix: register
  `autoScrollForElements` on the row (pragmatic-drag-and-drop's element
  auto-scroll), and extend `m1-board.spec.ts`'s drag walk to a column that
  starts off screen.
- **Cross-reference:** `resolved/KI-20260922-b-the-day-columns-scrollbar-starts-below-the-fold.md`.
- **First noted:** 2026-09-25, overnight KI sweep.
