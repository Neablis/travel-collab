"use client";

import { useEffect, useMemo } from "react";
import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import { monitorForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { autoScrollWindowForElements } from "@atlaskit/pragmatic-drag-and-drop-auto-scroll/element";
import { extractClosestEdge } from "@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge";
import type { TripDetail } from "@tc/contracts";
import { dayLabel } from "@/lib/dates";
import { Button } from "@/components/ui/button";
import { useEditor } from "@/components/trip/context/EditorHost";
import { chipModel } from "@/components/trip/DayChips";
import { dayAccentFor } from "@/lib/dayAccent";
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

  // Same per-day city derivation Task 8's DayChips / Task 10's TimelineLens
  // use (chipModel → dayAccentFor), so a day's column tint here always agrees
  // with its chip and its Timeline-view header color.
  const days = useMemo(() => chipModel(trip), [trip]);

  useEffect(() => {
    return combine(
      monitorForElements({
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
      }),
      // Root cause of the Task-11-era drag-and-drop regression: nothing here
      // is actually about Board/Column/ActivityCard's own restyle — it's that
      // the cumulative height of everything above the day-columns row (Task
      // 9's taller sticky header, Task 8's day-chips row, etc.) now commonly
      // pushes later day columns below the fold on an ordinary viewport,
      // confirmed by comparing this page's layout against pre-M10 `main`
      // (there, the same 3-day/2-backlog-item trip fit inside a 720px-tall
      // viewport with zero page overflow; here it overflows by ~145px). A
      // day column that starts beneath the visible viewport was never a
      // valid pragmatic-drag-and-drop drop target — `location.current
      // .dropTargets` comes up empty because the browser's own hit-testing
      // has nothing to find at an off-screen point — so no restyle-local
      // tweak to Board/Column/ActivityCard fixes this; the page needs to be
      // able to scroll during a drag, same as it already can with the mouse
      // when not dragging. `autoScrollWindowForElements` is the
      // pragmatic-drag-and-drop project's own answer to exactly this shape
      // of gap (a drop target outside the current scroll position): it
      // scrolls the window as the pointer nears the viewport edge while
      // dragging, letting a real drag reach a day column that content growth
      // pushed out of view instead of requiring the page to already fit.
      autoScrollWindowForElements(),
    );
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
      {/* Handoff README §"Day columns view": horizontally scrolling 268px
          columns rather than wrapping into rows. Adjacency for drag is
          dayId-based, not DOM order, so the switch from wrap to scroll
          doesn't affect drop logic. */}
      <div className="flex gap-3 overflow-x-auto pb-1">
        {trip.days.map((day, index) => (
          <Column
            key={day.dayId}
            title={dayLabel(trip.startDate, index)}
            dayId={day.dayId}
            activityIds={day.activityIds}
            activities={trip.activities}
            conflictIds={conflictIds}
            accent={dayAccentFor(days[index]?.city ?? null).tint}
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
