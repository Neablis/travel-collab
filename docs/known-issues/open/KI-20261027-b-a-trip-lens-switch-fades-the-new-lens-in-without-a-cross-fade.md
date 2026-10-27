### KI-2026-10-27-b — A trip's lens switch fades the new lens in; it does not cross-fade from the old one

- **Severity:** cosmetic. The switch works and the new lens eases in. The gate asked for a
  cross-fade, and what shipped is an enter only: the outgoing lens is gone the frame the switch
  lands.
- **Area:** `apps/web/src/app/globals.css:2819-2825` (`[data-lens-enter]`, whose comment says
  "the outgoing one is already gone"), `apps/web/src/components/board/TripBoardScreen.tsx` (the
  `data-lens-enter` boxes at :1672, :1703, :1784, :1801, and the note at :707).
- **Symptom / What happens:** switching Board, Plan, Map, Overview or Calendar on a trip unmounts
  the old lens and mounts the new one inside a box that plays `tc-fade-in`. Nothing of the old
  lens is drawn during the fade, so it reads as fade-from-blank, not one lens dissolving into the
  next. M54's *Tabs* box asked that "Lenses cross-fade on the trip page".
- **Why not fixed here:** found at the close, after part 3 (PR 600) had merged. A true
  cross-fade needs the old lens kept mounted, inert, through its exit (`useExitPresence` does
  this for overlays) or a view transition scoped to the lens box, and each lens owns heavy state
  (the map, the river's drag). Mitchell, 2026-10-27, about 02:00Z: *"Just record as a ki"*.
- **Fix path / Tripwire:** try a `view-transition-name` on the lens box with
  `document.startViewTransition` around the lens state change (the route cross-fade, decision 18,
  already uses React's `<ViewTransition>`), which snapshots the old lens without keeping it
  mounted. Pin it with a test that the old lens's snapshot and the new lens are both present
  during the transition.
- **Cross-reference:** M54's *Every tab style slides its indicator* box (ticked on this); part 8's
  wizard steps, which fade in for the same reason and are recorded as a deviation; ADR-082.
- **First noted:** 2026-10-26 at the gate tick on PR 593; filed 2026-10-27 at the close.
