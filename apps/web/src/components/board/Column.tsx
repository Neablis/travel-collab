"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import type { ActivityView } from "@tc/contracts";
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
      style={{ minWidth: 220, background: "#f6f6f6", borderRadius: 8, padding: 8 }}
    >
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <strong>{title}</strong>
        {onRemoveDay && (
          <button onClick={onRemoveDay} aria-label={`Remove ${title}`}>
            ✕
          </button>
        )}
      </header>
      <ul
        ref={ref}
        style={{
          listStyle: "none",
          margin: 0,
          minHeight: 48,
          padding: 4,
          background: isOver ? "#e8efff" : "transparent",
          borderRadius: 6,
        }}
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
