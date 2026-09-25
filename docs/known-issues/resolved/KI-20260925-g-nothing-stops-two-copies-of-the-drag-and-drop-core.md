### KI-2026-09-25-g — nothing stops two copies of the drag-and-drop core coming back, and with two, auto-scroll silently does nothing — RESOLVED

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
- **Resolved (2026-09-25, overnight KI sweep):** a new root wall,
  `scripts/check-singletons.mjs`, chained into `pnpm lint` after
  `check-migration-journal.mjs`. It reads `pnpm-lock.yaml`'s `packages:`
  section and fails when a declared singleton holds more than one version. It
  also fails if it finds no packages at all, so a lockfile format change cannot
  make it pass on nothing. The list is `@atlaskit/pragmatic-drag-and-drop`
  (the element adapter's drag registry lives in module scope), `react` (the hook
  dispatcher lives in module scope) and `react-dom` (must share `react`'s copy,
  and owns the root). Each has exactly one version in today's lockfile (3.1.0,
  19.2.8, 19.2.8). `Board.tsx`'s window auto-scroll comment and `e2e/helpers.ts`
  `dragCardTo`'s KI-21 note no longer imply that window auto-scroll ever worked
  before 2026-09-25 (comment-only edits).
  **Proof:** the wall run against the lockfile from before KI-2026-09-25-c
  (`git show 3726dcc^:pnpm-lock.yaml`) exits 1 with
  `singleton with more than one version: @atlaskit/pragmatic-drag-and-drop → 2.0.2, 3.1.0`.
  Against today's lockfile it prints `singleton check OK (3 singletons, 1017 packages)`.
  `scripts/__tests__/check-singletons.test.mjs` uses fixture lockfiles: two
  core versions fail, one passes, and a lockfile with no packages fails. It was
  seen red twice. With the `> 1` threshold raised to `> 99`, the two-versions
  case failed (`actual: 0, expected: 1`). With the no-packages guard disabled,
  the vacuous case failed (`actual: 0`). A third mutation, also reading
  `snapshots:`, stayed green. That is expected: v9 snapshot keys repeat the
  `packages:` versions with peer suffixes, so the fixture claim that the test
  covered this asserted nothing and was removed.
- **Decision (2026-09-25 overnight sweep):** a new standalone
  `scripts/check-singletons.mjs` with a general singleton list, not a
  pdnd-only check. Rejected: (a) **extending an existing wall.** No existing
  `check-*.mjs` reads the lockfile; the closest (`check-migration-journal`,
  `check-case-collisions`) guard unrelated invariants. (b) **`pnpm.overrides`
  pinning one version.** That hides a range mismatch instead of reporting it,
  the same reason KI-2026-09-25-c rejected it. (c) **Also listing the
  `-auto-scroll` / `-hitbox` packages or `react-is`.** A second copy of those
  does not split shared state. The bug only happens when the core they import
  is duplicated, and the core is already listed.
