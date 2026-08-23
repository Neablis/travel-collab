import { extractClosestEdge } from "@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge";
import type { TripDetail } from "@tc/contracts";

export type DropOutcome =
  | { kind: "unschedule"; activityId: string }
  | { kind: "move"; activityId: string; toDayId: string | null; position: number };

function listFor(trip: TripDetail, dayId: string | null): string[] {
  return dayId === null
    ? trip.backlog
    : (trip.days.find((d) => d.dayId === dayId)?.activityIds ?? []);
}

function containerOf(trip: TripDetail, activityId: string): string | null {
  const day = trip.days.find((d) => d.activityIds.includes(activityId));
  return day ? day.dayId : null;
}

/**
 * Pure resolution of a pragmatic-drag-and-drop drop into the mutation it means.
 * `targetData` is `location.current.dropTargets[0].data` — innermost target
 * first. Returns null when the drop is a no-op (no activity, no target).
 *
 * This is separated from the monitor deliberately: pdnd is driven by native
 * HTML5 drag events that jsdom cannot produce (no DataTransfer, no DragEvent),
 * so the routing decision is only checkable if it does not need a drag to run.
 *
 * The plan's draft signature typed both payloads `Record<string, unknown>`;
 * they are `Record<string | symbol, unknown>` here because that is what pdnd's
 * `source.data` / `dropTarget.data` actually are, and what `attachClosestEdge`
 * / `extractClosestEdge` require — the closest-edge value lives under a private
 * `Symbol` key, which a string-only index signature cannot carry.
 */
export function resolveDrop(
  trip: TripDetail,
  sourceData: Record<string | symbol, unknown>,
  targetData: Record<string | symbol, unknown> | undefined,
): DropOutcome | null {
  const activityId = sourceData.activityId;
  if (typeof activityId !== "string") return null;
  if (targetData === undefined) return null;

  // The rack check comes first on purpose: a drop on the unscheduled drawer
  // means "take this off the schedule" no matter what else the target carries.
  if (targetData.rack === true) return { kind: "unschedule", activityId };

  const toDayId = typeof targetData.dayId === "string" ? targetData.dayId : null;

  if (typeof targetData.cardActivityId === "string") {
    // Dropped on a card: insert before/after it depending on the edge.
    const list = listFor(trip, toDayId);
    const index = list.indexOf(targetData.cardActivityId);
    let position = extractClosestEdge(targetData) === "bottom" ? index + 1 : index;
    // Moving down within the same list: account for the dragged card's removal.
    const from = containerOf(trip, activityId);
    const sourceIndex = list.indexOf(activityId);
    if (from === toDayId && sourceIndex !== -1 && sourceIndex < position) {
      position -= 1;
    }
    return { kind: "move", activityId, toDayId, position };
  }

  // Dropped on a column: append.
  return {
    kind: "move",
    activityId,
    toDayId,
    position: listFor(trip, toDayId).filter((id) => id !== activityId).length,
  };
}
