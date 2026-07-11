"use client";

import { useEffect, useMemo, useState } from "react";
import { monitorForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { extractClosestEdge } from "@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge";
import type { TripDetail } from "@tc/contracts";
import { dayLabel } from "@/lib/dates";
import { ActivityEditor, type ActivityFormValue } from "./ActivityEditor";
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
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

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

  const editingActivity = editing !== null ? (trip.activities[editing] ?? null) : null;

  return (
    <div>
      <ConflictBanner
        conflicts={trip.conflicts}
        dismissedConflictIds={trip.dismissedConflictIds}
        onDismiss={callbacks.onDismissConflict}
      />
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start", overflowX: "auto" }}>
        <Column
          title="Backlog"
          dayId={null}
          activityIds={trip.backlog}
          activities={trip.activities}
          conflictIds={conflictIds}
          onEditActivity={setEditing}
          onRemoveActivity={callbacks.onRemoveActivity}
        >
          {adding ? (
            <ActivityEditor
              initial={null}
              tripCurrency={trip.currency}
              onSave={(value) => {
                callbacks.onAddActivity(value);
                setAdding(false);
              }}
              onCancel={() => setAdding(false)}
            />
          ) : (
            <button onClick={() => setAdding(true)}>+ Add activity</button>
          )}
        </Column>
        {trip.days.map((day, index) => (
          <Column
            key={day.dayId}
            title={dayLabel(trip.startDate, index)}
            dayId={day.dayId}
            activityIds={day.activityIds}
            activities={trip.activities}
            conflictIds={conflictIds}
            onEditActivity={setEditing}
            onRemoveActivity={callbacks.onRemoveActivity}
            onRemoveDay={() => callbacks.onRemoveDay(day.dayId)}
          />
        ))}
        <button onClick={callbacks.onAddDay} style={{ minWidth: 120 }}>
          + Add day
        </button>
      </div>
      {editing !== null && editingActivity !== null && (
        <div style={{ marginTop: 12, maxWidth: 420 }}>
          <ActivityEditor
            initial={editingActivity}
            tripCurrency={trip.currency}
            onSave={(value) => {
              callbacks.onUpdateActivity(editing, value);
              setEditing(null);
            }}
            onCancel={() => setEditing(null)}
          />
        </div>
      )}
    </div>
  );
}
