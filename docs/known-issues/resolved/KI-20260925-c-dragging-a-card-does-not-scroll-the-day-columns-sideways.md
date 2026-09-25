### KI-2026-09-25-c — dragging a stop card toward a day column off screen to the right does not scroll the columns sideways — RESOLVED

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
- **Resolved:** 2026-09-25, overnight KI sweep. There were two causes, and
  registering the row alone did not fix it.
  (1) The row was never registered. `Board.tsx` now calls
  `autoScrollForElements({ element: row })` on the Day-columns row (desktop
  only; the phone's one-day column does not scroll sideways).
  (2) **Two copies of the drag-and-drop core.** `apps/web` pinned
  `@atlaskit/pragmatic-drag-and-drop@^2.0.2`, while
  `pragmatic-drag-and-drop-auto-scroll@3.2.0` (and `-hitbox@2.2.0`) depend on
  core `3.1.0`, so both were installed. The cards registered with 2.0.2's
  element adapter, and auto-scroll's scheduler listened on 3.1.0's, so it
  never saw a drag start. With the row registered and the attribute confirmed
  on it (`data-auto-scrollable="true"`, pointer inside the row), the row still
  did not scroll. The same mechanism means `autoScrollWindowForElements` has
  never worked either (inferred from the mechanism, not separately tested).
  web's range is now `^3.1.0`. The lockfile change only removes the 2.0.2
  entries: 3.1.0 was already locked, so nothing new was downloaded and
  `minimumReleaseAge` is unaffected. Core 3.0.0's only major change adds new
  entry points and keeps the old ones as shims.
  **Proof:** a new `m1-board.spec.ts` case builds an 8-day trip, drags day 1's
  card to 60px inside the row's right edge and holds it there. It asserts that
  the row's `scrollLeft` rises, that the last day comes fully into view, that
  the sticky stand-in bar follows, and that the drop lands in that last column.
  It was red with the registration but the old core
  (`the row scrolls right while a card is held at its right edge … Expected: > 0
  Received: 0`). It was red again, the same way, with the new core but the
  registration removed. It is green with both:
  `pnpm --filter web test:e2e:ci-like e2e/m1-board.spec.ts`, 4/4. Also green,
  against the same ci-like build: the other drag specs (`m10-unscheduled-rack`,
  `m2-history`, `m3-place-and-time`, `m4-money-and-lenses`, `m8-make-it-real`,
  9/9). `pnpm --filter web typecheck` and `lint` are clean. Board and rack
  unit tests pass, 236/236.
  **Test trap, recorded in the spec:** 8px from the edge, the test passed
  with *no* fix. Chromium's native HTML5-drag auto-scroll starts a few pixels
  from a scroller's edge. 60px is inside pdnd's band (a quarter of the row,
  capped at 180px) and outside the browser's.
- **Decision (2026-09-25 overnight sweep):** bump web's
  `@atlaskit/pragmatic-drag-and-drop` from `^2.0.2` to `^3.1.0`, the version the
  auto-scroll and hitbox packages already bring. That is the same package
  family and a version already in the lockfile. Rejected:
  (a) **Downgrade auto-scroll/hitbox to releases built on core 2.x.** That
  needs versions not in the lockfile (a fresh supply-chain pick) and moves
  backwards.
  (b) **A `pnpm.overrides` forcing one core version.** That hides the mismatch
  instead of declaring the dependency web actually needs.
  (c) **Hand-rolling the row scroll in the Board's monitor.** That would
  duplicate pdnd's own edge/time dampening, and it would leave window
  auto-scroll dead.
