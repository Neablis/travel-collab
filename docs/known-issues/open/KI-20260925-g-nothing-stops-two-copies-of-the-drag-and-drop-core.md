### KI-2026-09-25-g — nothing stops two copies of the drag-and-drop core coming back, and with two, auto-scroll silently does nothing

- **Severity:** reliability — a silent functional loss, not a crash. Found
  because it had already happened: from some point until 2026-09-25, window
  auto-scroll during a card drag never worked.
- **Area:** `apps/web/package.json` (`@atlaskit/pragmatic-drag-and-drop` and the
  `-auto-scroll` / `-hitbox` packages), `pnpm-lock.yaml`,
  `apps/web/src/components/board/Board.tsx` (the auto-scroll registrations);
  comments that still describe window auto-scroll as having worked:
  `Board.tsx`'s monitor comment and `e2e/helpers.ts` `dragCardTo` (the KI-21 note).
- **Symptom:** web pinned core `^2.0.2` while `-auto-scroll@3.2.0` and
  `-hitbox@2.2.0` depend on core `3.1.0`, so two cores were installed. Cards
  registered with 2.0.2's element adapter; auto-scroll listened on 3.1.0's and
  never saw a drag start. Nothing failed: `dragCardTo` scrolls its target into
  view itself, which hid it. KI-2026-09-25-c's fixer bumped web to `^3.1.0`
  (one copy now); nothing prevents the ranges drifting apart again.
- **Why not fixed here:** found by KI-2026-09-25-c's fixer (overnight sweep);
  a guard is a separate change. Intended fix: a root lint wall that fails when
  `pnpm-lock.yaml` holds more than one version of
  `@atlaskit/pragmatic-drag-and-drop` (or a general "these packages must be
  singletons" list — React, the pdnd core), plus correcting the two comments.
- **Cross-reference:** `resolved/KI-20260925-c-dragging-a-card-does-not-scroll-the-day-columns-sideways.md`, KI-21.
- **First noted:** 2026-09-25, overnight KI sweep.
