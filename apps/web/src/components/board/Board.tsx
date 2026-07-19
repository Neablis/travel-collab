"use client";

import { useEffect, useMemo } from "react";
import { monitorForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { extractClosestEdge } from "@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge";
import type { TripDetail } from "@tc/contracts";
import { dayLabel } from "@/lib/dates";
import { Button } from "@/components/ui/button";
import { useEditor } from "@/components/trip/context/EditorHost";
import { type ActivityFormValue } from "./ActivityEditor";
import { Column } from "./Column";
import { ConflictBanner } from "./ConflictBanner";

export type BoardCallbacks = {
  onMove: (activityId: string, toDayId: string | null, position: number) => void;
  onAddDay: () => void;
  onRemoveDay: (dayId: string) => void;
  onAddActivity: (value: ActivityFormValue) => void;
  onUpdateActivity: (activityId: string, value: ActivityFormValue) => void;
  onRemoveActivity: (activityId: string) => void;
  onDismissConflict: (conflictId: string) => void;
};

function listFor(trip: TripDetail, dayId: string | null): string[] {
  return dayId === null
    ? trip.backlog
    : (trip.days.find((d) => d.dayId === dayId)?.activityIds ?? []);
}

function containerOf(trip: TripDetail, activityId: string): string | null {
  const day = trip.days.find((d) => d.activityIds.includes(activityId));
  return day ? day.dayId : null;
}

export function Board({ trip, callbacks }: { trip: TripDetail; callbacks: BoardCallbacks }) {
  const { openCreate, openEdit } = useEditor();

  const conflictIds = useMemo(
    () => new Set(trip.conflicts.flatMap((c) => c.subjects)),
    [trip.conflicts],
  );

  useEffect(() => {
    return monitorForElements({
      onDrop: ({ source, location }) => {
        const activityId = source.data.activityId;
        if (typeof activityId !== "string") return;
        const target = location.current.dropTargets[0]; // innermost target first
        if (!target) return;

        let toDayId: string | null;
        let position: number;
        if (typeof target.data.cardActivityId === "string") {
          // Dropped on a card: insert before/after it depending on the edge.
          toDayId = typeof target.data.dayId === "string" ? target.data.dayId : null;
          const list = listFor(trip, toDayId);
          const index = list.indexOf(target.data.cardActivityId);
          position = extractClosestEdge(target.data) === "bottom" ? index + 1 : index;
          // Moving down within the same list: account for the dragged card's removal.
          const from = containerOf(trip, activityId);
          const sourceIndex = list.indexOf(activityId);
          if (from === toDayId && sourceIndex !== -1 && sourceIndex < position) {
            position -= 1;
          }
        } else {
          // Dropped on a column: append.
          toDayId = typeof target.data.dayId === "string" ? target.data.dayId : null;
          position = listFor(trip, toDayId).filter((id) => id !== activityId).length;
        }
        callbacks.onMove(activityId, toDayId, position);
      },
    });
  }, [trip, callbacks]);

  return (
    <div className="flex flex-col gap-3">
      <ConflictBanner
        conflicts={trip.conflicts}
        dismissedConflictIds={trip.dismissedConflictIds}
        onDismiss={callbacks.onDismissConflict}
      />
      {/* Backlog is the unscheduled pool — a full-width strip above the dated
          day grid, not a column in the wrap. */}
      <Column
        title="Backlog"
        dayId={null}
        activityIds={trip.backlog}
        activities={trip.activities}
        conflictIds={conflictIds}
        onEditActivity={openEdit}
        onRemoveActivity={callbacks.onRemoveActivity}
        fullWidth
      >
        <Button variant="primary" onClick={() => openCreate()}>+ Add activity</Button>
      </Column>
      {/* Day columns wrap into rows instead of scrolling horizontally
          (#31/#23/#4/#10). Adjacency for drag is dayId-based, not DOM order,
          so wrapping doesn't affect drop logic. */}
      <div className="flex flex-wrap gap-3">
        {trip.days.map((day, index) => (
          <Column
            key={day.dayId}
            title={dayLabel(trip.startDate, index)}
            dayId={day.dayId}
            activityIds={day.activityIds}
            activities={trip.activities}
            conflictIds={conflictIds}
            onEditActivity={openEdit}
            onRemoveActivity={callbacks.onRemoveActivity}
            onRemoveDay={() => callbacks.onRemoveDay(day.dayId)}
            onAddActivity={() => openCreate({ dayId: day.dayId })}
          />
        ))}
        <Button variant="secondary" onClick={callbacks.onAddDay} className="h-9 w-32 shrink-0">
          + Add day
        </Button>
      </div>
    </div>
  );
}
