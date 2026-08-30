### KI-4 — Minor M5 Wave-3 cosmetic/dead-code notes — RESOLVED
- **Severity:** cosmetic / cleanup
- **Area:** `apps/web/src` (various)
- Non-blocking findings from the Wave-3 per-task + final whole-branch reviews
  (all shipped as-is by decision — no wrong behavior reachable by a user);
  all five closed in Task 19 (2026-08-09):
  - **FIXED:** `board/Column.tsx` — the `sectionRef` prop was dead (its only
    caller, the removed day-pager `scrollToDay`, was already gone); deleted
    the prop, its type, and the `ref={sectionRef}` wiring. `Board.tsx` never
    passed `sectionRef` to `<Column>`, so no call site changed.
  - **FIXED:** `lenses/MapLens.tsx` — removed the inert `grow` class from
    `.map-lens-canvas`; the `minHeight`/`height: 70vh` inline styles do the
    actual sizing, unchanged.
  - **CLOSED BY OBSOLESCENCE:** `lenses/TimelineLens.tsx` — the hour-gridline
    `<div>`s lacking `pointer-events-none`. Task 10's structural rewrite
    (horizontal Gantt-bar-with-hour-axis → vertical day-header + activity-row
    list) removed the hour-gridline code entirely; there is nothing left in
    the file for this bullet to apply to.
  - **CLOSED BY OBSOLESCENCE:** `lenses/TimelineLens.tsx` — axis tick labels
    clipping at narrow widths. Same Task 10 rewrite; there is no axis-tick-
    label code left in the file.
  - **FIXED:** `ui/segmented-control.tsx` — verified the claim first (the
    base `gap-0.5` class *was* redundant: `cn`'s `twMerge` silently dropped
    it in favor of the subtle variant's `gap-3` on every render). Moved
    `gap-0.5` into the pill-only branch so no dead class is emitted for
    either variant; the merged output is identical to before.
- **First noted:** 2026-07-13 (M5 Wave 3). **Resolved:** 2026-08-09 (Task 19).
