import type { AddDay, MoveActivity, TripDetail } from "@tc/contracts";

/**
 * The commands that move stops to a day, or to the rack when `toDayId` is
 * `null`. Every move builds its `MoveActivity` here (ADR-068 §3), so a drag,
 * a rack drop and the editor's Day field cannot disagree about what a move
 * is. The callers add what is particular to them (a fitted time, a cleared
 * one) beside these.
 *
 * - **Appended by default.** Each stop goes to the end of the target's order,
 *   in the order given. `position` overrides that for the first stop, for a
 *   drop that lands between two others; the rest follow it.
 * - **`newDayIds` grow the trip first.** One `AddDay` per id comes before the
 *   moves, so a move onto a day that does not exist yet is one batch.
 * - **A stop already there is left out**, unless a `position` is given:
 *   appending a stop to the day it is on would change nothing and still cost
 *   an undo step, but a drop at a position on its own day is a reorder.
 */
export function moveCommands(
  trip: Pick<TripDetail, "tripId" | "days" | "backlog">,
  activityIds: readonly string[],
  toDayId: string | null,
  options: { position?: number; newDayIds?: readonly string[] } = {},
): Array<AddDay | MoveActivity> {
  const { tripId } = trip;
  const newDayIds = options.newDayIds ?? [];
  const addDays: AddDay[] = newDayIds.map((dayId) => ({ type: "AddDay", tripId, dayId }));

  const target =
    toDayId === null
      ? trip.backlog
      : (trip.days.find((day) => day.dayId === toDayId)?.activityIds ?? (newDayIds.includes(toDayId) ? [] : undefined));
  if (target === undefined) return addDays;

  const moving = options.position === undefined ? activityIds.filter((id) => !target.includes(id)) : [...activityIds];
  const staying = target.filter((id) => !moving.includes(id));
  const first = options.position ?? staying.length;

  const moves: MoveActivity[] = moving.map((activityId, index) => ({
    type: "MoveActivity",
    tripId,
    activityId,
    toDayId,
    position: first + index,
  }));
  return [...addDays, ...moves];
}
