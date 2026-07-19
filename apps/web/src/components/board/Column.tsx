"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { X } from "lucide-react";
import type { ActivityView } from "@tc/contracts";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { ActivityCard } from "./ActivityCard";

export function Column({
  title,
  dayId,
  activityIds,
  activities,
  conflictIds,
  onEditActivity,
  onRemoveActivity,
  onRemoveDay,
  onAddActivity,
  sectionRef,
  fullWidth = false,
  children,
}: {
  title: string;
  dayId: string | null; // null = backlog
  activityIds: string[];
  activities: Record<string, ActivityView>;
  conflictIds: ReadonlySet<string>;
  onEditActivity: (activityId: string) => void;
  onRemoveActivity: (activityId: string) => void;
  onRemoveDay?: () => void;
  onAddActivity?: () => void;
  // Ref to the column's outer <section>, for callers that need to reach the
  // section element directly. Not used for drag-drop, which keeps its own
  // internal <ul> ref below.
  sectionRef?: (el: HTMLElement | null) => void;
  // Backlog renders as a full-width strip above the day grid rather than a
  // fixed-width column in the wrap (#31).
  fullWidth?: boolean;
  children?: ReactNode;
}) {
  const ref = useRef<HTMLUListElement>(null);
  const [isOver, setIsOver] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return dropTargetForElements({
      element: el,
      getData: () => ({ dayId }),
      onDragEnter: () => setIsOver(true),
      onDragLeave: () => setIsOver(false),
      onDrop: () => setIsOver(false),
    });
  }, [dayId]);

  return (
    <section
      ref={sectionRef}
      data-testid={dayId === null ? "backlog-column" : "day-column"}
      className={cn("rounded-md bg-moss p-2", fullWidth ? "w-full" : "w-64 shrink-0")}
    >
      <header className="flex items-baseline justify-between">
        <span className="text-sm font-semibold text-ink">{title}</span>
        {onRemoveDay && (
          <Button variant="ghost" size="icon" onClick={onRemoveDay} aria-label={`Remove ${title}`}>
            <X className="size-3.5" aria-hidden />
          </Button>
        )}
      </header>
      <ul
        ref={ref}
        className={cn("m-0 min-h-12 list-none rounded-sm p-1", isOver && "bg-brand-tint")}
      >
        {activityIds.map((id) => {
          const activity = activities[id];
          if (activity === undefined) return null;
          return (
            <ActivityCard
              key={id}
              activity={activity}
              dayId={dayId}
              hasConflict={conflictIds.has(id)}
              onEdit={() => onEditActivity(id)}
              onRemove={() => onRemoveActivity(id)}
            />
          );
        })}
      </ul>
      {/* On an empty day the add affordance is more pronounced — a full dashed
          "add here" slot with a label — since there's nothing else to act on
          (#20); once the day has cards it collapses to a compact "+". */}
      {onAddActivity && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onAddActivity}
          aria-label={`Add activity to ${title}`}
          className={cn(
            "mt-1 w-full justify-center",
            activityIds.length === 0 && "border border-dashed border-border-strong py-2 text-slate",
          )}
        >
          {activityIds.length === 0 ? "+ Add activity" : "+"}
        </Button>
      )}
      {children}
    </section>
  );
}
