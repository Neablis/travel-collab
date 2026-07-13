"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { monitorForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { extractClosestEdge } from "@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge";
import type { TripDetail } from "@tc/contracts";
import { dayLabel } from "@/lib/dates";
import { Button } from "@/components/ui/button";
import { ActivityEditor, type ActivityFormValue } from "./ActivityEditor";
import { Column } from "./Column";
import { ConflictBanner } from "./ConflictBanner";

// Tolerance (px) for the scrollWidth/scrollLeft/clientWidth comparison, to
// absorb sub-pixel rounding from browser zoom/fractional layout.
const SCROLL_EDGE_TOLERANCE = 2;

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

  const scrollRef = useRef<HTMLDivElement>(null);
  const dayRefs = useRef(new Map<string, HTMLElement>());
  const [hasOverflowRight, setHasOverflowRight] = useState(false);

  const updateOverflow = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setHasOverflowRight(el.scrollLeft + el.clientWidth < el.scrollWidth - SCROLL_EDGE_TOLERANCE);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    updateOverflow();
    el.addEventListener("scroll", updateOverflow);
    window.addEventListener("resize", updateOverflow);
    return () => {
      el.removeEventListener("scroll", updateOverflow);
      window.removeEventListener("resize", updateOverflow);
    };
    // Re-check whenever the trip's day count changes the row's scrollWidth,
    // in addition to scroll/resize events.
  }, [updateOverflow, trip.days.length]);

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

  const scrollToDay = useCallback((dayId: string) => {
    dayRefs.current.get(dayId)?.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" });
  }, []);

  return (
    <div>
      <ConflictBanner
        conflicts={trip.conflicts}
        dismissedConflictIds={trip.dismissedConflictIds}
        onDismiss={callbacks.onDismissConflict}
      />
      {trip.days.length > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5" aria-label="Jump to day">
          {trip.days.map((day, index) => (
            <Button
              key={day.dayId}
              variant="secondary"
              size="sm"
              onClick={() => scrollToDay(day.dayId)}
            >
              {dayLabel(trip.startDate, index)}
            </Button>
          ))}
        </div>
      )}
      <div className="relative">
        <div
          ref={scrollRef}
          className="flex flex-col items-stretch gap-3 pb-2 lg:flex-row lg:items-start lg:overflow-x-auto"
        >
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
              <Button variant="primary" onClick={() => setAdding(true)}>+ Add activity</Button>
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
              sectionRef={(el) => {
                if (el) dayRefs.current.set(day.dayId, el);
                else dayRefs.current.delete(day.dayId);
              }}
            />
          ))}
          <Button variant="secondary" onClick={callbacks.onAddDay} className="w-32 shrink-0">
            + Add day
          </Button>
        </div>
        {hasOverflowRight && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 right-0 hidden w-4 shadow-overlay lg:block"
          />
        )}
      </div>
      {editing !== null && editingActivity !== null && (
        <div className="mt-3 max-w-md">
          <ActivityEditor
            key={editing}
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
