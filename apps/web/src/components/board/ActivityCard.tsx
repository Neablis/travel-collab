"use client";

import { useEffect, useRef, useState } from "react";
import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import { draggable, dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { attachClosestEdge } from "@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge";
import type { ActivityView } from "@tc/contracts";

export function ActivityCard({
  activity,
  dayId,
  hasConflict,
  onEdit,
  onRemove,
}: {
  activity: ActivityView;
  dayId: string | null;
  hasConflict: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const ref = useRef<HTMLLIElement>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return combine(
      draggable({
        element: el,
        getInitialData: () => ({ activityId: activity.activityId }),
        onDragStart: () => setDragging(true),
        onDrop: () => setDragging(false),
      }),
      dropTargetForElements({
        element: el,
        getData: ({ input, element }) =>
          attachClosestEdge(
            { cardActivityId: activity.activityId, dayId },
            { input, element, allowedEdges: ["top", "bottom"] },
          ),
      }),
    );
  }, [activity.activityId, dayId]);

  return (
    <li
      ref={ref}
      data-testid={`activity-card-${activity.activityId}`}
      style={{
        background: "white",
        border: "1px solid #ddd",
        borderRadius: 6,
        padding: 8,
        marginBottom: 6,
        opacity: dragging ? 0.5 : 1,
        cursor: "grab",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <span>
          <span>{activity.title}</span>
          {hasConflict && (
            <span role="img" aria-label="conflict" title="This activity has conflicts">
              {" "}
              ⚠️
            </span>
          )}
        </span>
        <span style={{ whiteSpace: "nowrap" }}>
          <button onClick={onEdit} aria-label={`Edit ${activity.title}`}>
            ✎
          </button>{" "}
          <button onClick={onRemove} aria-label={`Remove ${activity.title}`}>
            ✕
          </button>
        </span>
      </div>
      {activity.timeWindow && (
        <small>
          {activity.timeWindow.start}–{activity.timeWindow.end}
        </small>
      )}
      {activity.location && <small> · {activity.location.name}</small>}
    </li>
  );
}
