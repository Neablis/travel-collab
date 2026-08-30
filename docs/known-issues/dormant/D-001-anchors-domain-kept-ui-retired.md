### D-1 — Anchors: domain kept, UI retired
- **Decided:** 2026-07-28 (Mitchell), during the Phase 1 gate review. **Executed in M8.**
- **What stays:** the `Anchor` contract, the anchor-violation conflict rules in
  `packages/domain/src/trip/conflicts.ts`, and their tests
  (`anchor-conflicts.test.ts`, `anchors-state.test.ts`,
  `apps/web/src/server/anchors.int.test.ts`).
- **What goes:** `apps/web/src/components/board/AnchorEditor.tsx` and every UI
  entry point to it.
- **Why:** anchors were never made legible. M3's gate proved the *rules* fire,
  never that anyone could see or use them. `publicHoliday` was worse than
  invisible — a selectable option with a country picker whose oracle is a
  permissive stub (`isPublicHoliday: () => true`), so it could never produce a
  conflict. A control that cannot do anything is a lie in the UI.
- **The tripwire — this is the point.** The anchor domain tests stay in the
  suite, so a future change that breaks anchors **fails the build**. Whoever
  hits it should read this entry and *decide* — revive with a real UI, or
  delete the feature — rather than reflexively repairing code no user can
  reach. A comment alone would never have surfaced; a failing test will.
- **Related dead weight, cleared:** `ConflictContext.timezone`, injected from
  `TRIP_TIMEZONE` and read by no rule, was removed in M8 Wave B (Task B2), in
  the same pass as the anchors-UI retirement. See the Amendment (2026-08-07)
  in `docs/architecture/ADR-006-conflict-evaluation-context.md`.
