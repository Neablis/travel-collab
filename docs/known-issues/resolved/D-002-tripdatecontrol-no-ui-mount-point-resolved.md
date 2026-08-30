### D-2 — `TripDateControl` had no UI mount point — RESOLVED
- **Decided (2026-08-22, Task 4.2, M10 Phase 4):** at the time, read as a
  deliberate "dormant, not deleted" hold, same standing principle as D-1
  (below, still open) gives anchors.
- **Correction (2026-08-22, M10 Phase 4, restore-date-editing task):** this
  was wrong — the product owner confirmed the read-only Dates row was an
  *unintentional* capability loss, not a deferral, and asked for it back.
  Unlike D-1, there was never a design decision to make dates read-only; the
  redesign spec simply didn't give `TripDateControl` a new home when it
  re-laid-out the settings sheet.
- **Fix:** the settings sheet's Dates row (`SettingsSheet.tsx`) is a real
  trigger again — clicking it opens a `Popover` that mounts
  `TripDateControl` unmodified, the same click-a-row/open-a-small-control
  idiom `TripHeader`'s own History popover uses. `TripDateControl.tsx` itself
  was never touched (its `SetTripDates`/`SetTripStartDate` dispatch logic,
  shrink-confirm dialog, and `TripDateControl.test.tsx`'s 7 tests are
  byte-identical) — only its mount point changed. This also fixed
  `e2e/m3-place-and-time.spec.ts` and `e2e/m8-make-it-real.spec.ts` (M8's own
  milestone gate spec), both of which had been failing waiting for a
  `Start date` field with nowhere to appear.
- **First noted:** 2026-08-22 (Task 4.2). **Resolved:** 2026-08-22 (same day,
  restore-date-editing task).
