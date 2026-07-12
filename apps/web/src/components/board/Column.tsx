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
      data-testid={dayId === null ? "backlog-column" : "day-column"}
      className="w-64 shrink-0 rounded-md bg-moss p-2"
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
      {children}
    </section>
  );
}
