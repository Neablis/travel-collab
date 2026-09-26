/**
 * The event a river block lifted by a finger (M29 phone, `DayRiver`) sends
 * the unscheduled rack while the finger is over it (`detail: true`) and when
 * it leaves or lets go (`false`), so the rack can light up as it does under a
 * mouse drag. A touch lift is no native drag, so pragmatic-drag-and-drop's own
 * `onDragEnter` never fires for it.
 *
 * In `lib` rather than in either component because both sides need the name
 * and neither should import the other for it.
 */
export const RACK_LIFT_OVER_EVENT = "tc-rack-lift-over";
