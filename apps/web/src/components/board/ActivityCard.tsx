"use client";

import { useEffect, useRef, useState } from "react";
import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import { draggable, dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { attachClosestEdge } from "@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge";
import { AlertTriangle, Pencil, X } from "lucide-react";
import type { ActivityView } from "@tc/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataText } from "@/components/ui/data-text";
import { Text } from "@/components/ui/text";
import { formatMoney } from "@/components/lenses/formatMoney";

export function ActivityCard({
  activity,
  dayId,
  hasConflict,
  currency,
  onEdit,
  onRemove,
}: {
  activity: ActivityView;
  dayId: string | null;
  hasConflict: boolean;
  // Currency is trip-level, never per-event (decision, 2026-08-14) — the same
  // pattern TimelineLens/BudgetChip/DailyOverviewLens already follow: the
  // caller threads its own trip.currency down, this never reads Money.currency
  // off the activity's own cost.
  currency: string;
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
    <Card
      as="li"
      ref={ref}
      data-testid={`activity-card-${activity.activityId}`}
      // eslint-disable-next-line no-restricted-syntax -- drag opacity is computed per-frame by pragmatic-drag-and-drop state, not expressible as a token class
      style={{ opacity: dragging ? 0.5 : 1 }}
      className="mb-1.5 cursor-grab p-3"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="flex items-center gap-1.5">
          <Text as="span" className="font-medium">{activity.title}</Text>
          {hasConflict && (
            <Badge variant="warning" role="img" aria-label="conflict" title="This activity has conflicts">
              <AlertTriangle className="size-3" aria-hidden />
            </Badge>
          )}
        </span>
        <span className="flex shrink-0 gap-0.5">
          <Button variant="ghost" size="icon" onClick={onEdit} aria-label={`Edit ${activity.title}`}>
            <Pencil className="size-3.5" aria-hidden />
          </Button>
          <Button variant="ghost" size="icon" onClick={onRemove} aria-label={`Remove ${activity.title}`}>
            <X className="size-3.5" aria-hidden />
          </Button>
        </span>
      </div>
      {activity.timeWindow && (
        <DataText size="xs">{activity.timeWindow.start}–{activity.timeWindow.end}</DataText>
      )}
      {activity.location && <Text as="span" variant="muted"> · {activity.location.name}</Text>}
      {/* Task 4.1 (M10 Phase 4): the board's per-stop cost, same treatment as
          TimelineLens's card — mono, formatMoney (KI-2), honest "No cost
          yet" for the null/undefined case. `activity.cost` truthiness
          already covers both. */}
      {activity.cost ? (
        <DataText size="xs" className="block">{formatMoney(activity.cost.amountMinor, currency)}</DataText>
      ) : (
        <DataText size="xs" className="block">No cost yet</DataText>
      )}
    </Card>
  );
}
