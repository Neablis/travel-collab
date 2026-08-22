export type RackDisclosure = { open: boolean; openedByDrag: boolean };
export type RackEvent =
  | { type: "toggle" }
  | { type: "dragStart" }
  | { type: "dragEnd" }
  | { type: "parked" };

/**
 * Who owns the unscheduled drawer being open.
 *
 * A drag auto-opens the drawer so a stop can be parked without first hunting
 * for the toggle — and the drawer has to go back to how the user left it once
 * the drag ends. That "only re-close what the drag opened" rule is the part
 * most likely to be got wrong in a component, so it lives here as a reducer
 * with no DOM and no drag events of its own.
 *
 * Escape needs no event: pragmatic-drag-and-drop runs its normal drop/cancel
 * path on Escape, so a cancelled drag reaches this reducer as `dragEnd` like
 * any other, and the third case below is what proves that re-closes correctly.
 *
 * `parked` is the one case a drag does not hand the drawer back: a stop was
 * just dropped *into* it, and slamming it shut on the drop would hide the very
 * thing the user just parked. It leaves the drawer open and owned by the user
 * (so the next drag's `dragEnd` does not close it either), from both a
 * drag-opened and an already-open drawer.
 */
export function rackDisclosure(state: RackDisclosure, event: RackEvent): RackDisclosure {
  switch (event.type) {
    case "toggle":
      // A toggle is always the user taking ownership. While the drag owns an
      // auto-opened drawer, the user never asked for it to be open, so their
      // click claims the open drawer rather than flipping it shut; otherwise
      // it is an ordinary flip.
      return { open: state.openedByDrag ? true : !state.open, openedByDrag: false };
    case "dragStart":
      // A drawer that is already open stays the user's — the drag must not
      // take ownership of it, or it would be closed out from under them.
      return state.open ? state : { open: true, openedByDrag: true };
    case "dragEnd":
      return state.openedByDrag ? { open: false, openedByDrag: false } : state;
    case "parked":
      return { open: true, openedByDrag: false };
  }
}
