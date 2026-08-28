"use client";

import { useEffect, useRef, useState } from "react";
import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import { draggable, dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { attachClosestEdge, extractClosestEdge, type Edge } from "@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge";
import { AlertTriangle, Eye, Pencil, X } from "lucide-react";
import type { ActivityView } from "@tc/contracts";
import { toClockRange } from "@/lib/time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataText } from "@/components/ui/data-text";
import { Text } from "@/components/ui/text";
import { formatMoney } from "@/components/lenses/formatMoney";
import type { Overlap } from "@/components/lenses/overlapData";
import { cn } from "@/lib/cn";

export function ActivityCard({
  activity,
  dayId,
  hasConflict,
  overlap,
  currency,
  onEdit,
  onRemove,
  onDismissOverlap,
  readOnly = false,
}: {
  activity: ActivityView;
  dayId: string | null;
  hasConflict: boolean;
  // The live time-overlap this stop is the later half of, if any — the day
  // columns' compact form of the timeline's OverlapWarning. Null both when
  // nothing overlaps and when this is the *earlier* stop of a pair (the
  // warning hangs off the later one, overlapData.ts).
  overlap: Overlap | null;
  // Currency is trip-level, never per-event (decision, 2026-08-14) — the same
  // pattern TimelineLens/BudgetChip already follow: the
  // caller threads its own trip.currency down, this never reads Money.currency
  // off the activity's own cost.
  currency: string;
  onEdit: () => void;
  onRemove: () => void;
  onDismissOverlap: (conflictId: string) => void;
  /** A viewer's card: not draggable, no Remove, no overlap dismissal, and the
      pencil becomes a plain "View" (the editor sheet presents read-only for a
      viewer too — ActivityEditorSheet). The server refuses every one of those
      writes independently; withholding the affordance is what stops a card
      moving and snapping back
      (docs/reviews/2026-08-28-m11-pr71-review.md §5). */
  readOnly?: boolean;
}) {
  const ref = useRef<HTMLLIElement>(null);
  const [dragging, setDragging] = useState(false);
  // The insertion line: which edge of *this* card a drop would land next to.
  // null both at rest and while this card is itself the one being dragged —
  // pragmatic-drag-and-drop still fires drag-over events on a target under
  // its own dragged source in some browsers, and "insert next to yourself"
  // is never a real position resolveDrop would produce.
  const [closestEdge, setClosestEdge] = useState<Edge | null>(null);

  useEffect(() => {
    const el = ref.current;
    // Neither draggable nor a drop target for a viewer: pdnd's `draggable`
    // sets the DOM `draggable="true"` attribute, so skipping registration is
    // what actually makes the card immovable rather than merely un-styled.
    if (!el || readOnly) return;
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
        canDrop: ({ source }) => source.data.activityId !== activity.activityId,
        onDragEnter: (args) => setClosestEdge(extractClosestEdge(args.self.data) as Edge | null),
        onDrag: (args) => setClosestEdge(extractClosestEdge(args.self.data) as Edge | null),
        onDragLeave: () => setClosestEdge(null),
        onDrop: () => setClosestEdge(null),
      }),
    );
  }, [activity.activityId, dayId, readOnly]);

  return (
    <Card
      as="li"
      ref={ref}
      data-testid={`activity-card-${activity.activityId}`}
      // eslint-disable-next-line no-restricted-syntax -- drag opacity is computed per-frame by pragmatic-drag-and-drop state, not expressible as a token class
      style={{ opacity: dragging ? 0.5 : 1 }}
      className={cn("relative mb-1.5 p-3", readOnly ? "cursor-default" : "cursor-grab")}
    >
      {/* The insertion line: Phase 3's own design intent (Column.tsx's
          comment on the removed hover-tint: "the design keeps only the
          insertion line and the floating time chip") shipped the
          highlight-removal half but not the replacement — `attachClosestEdge`
          was already wired for `resolveDrop.ts`'s position math, nothing
          ever rendered it. Positioned on the card's own border so it reads
          as "between this card and its neighbour," matching where the drop
          actually lands. */}
      {closestEdge !== null && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 h-0.5 rounded-full bg-brand"
          // eslint-disable-next-line no-restricted-syntax -- the line sits half-over the card's own border (-3px), a one-off offset with no token equivalent
          style={closestEdge === "top" ? { top: "-3px" } : { bottom: "-3px" }}
        />
      )}
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
          {/* Kept for a viewer, relabelled: the sheet it opens is the only
              place a stop's notes are legible at all, so removing it would
              hide real content rather than an affordance. "Edit" would be a
              promise the sheet does not keep for a viewer. */}
          <Button
            variant="ghost"
            size="icon"
            onClick={onEdit}
            aria-label={`${readOnly ? "View" : "Edit"} ${activity.title}`}
          >
            {readOnly ? <Eye className="size-3.5" aria-hidden /> : <Pencil className="size-3.5" aria-hidden />}
          </Button>
          {!readOnly && (
            <Button variant="ghost" size="icon" onClick={onRemove} aria-label={`Remove ${activity.title}`}>
              <X className="size-3.5" aria-hidden />
            </Button>
          )}
        </span>
      </div>
      {activity.timeWindow && (
        <DataText size="xs">{toClockRange(activity.timeWindow.start, activity.timeWindow.end)}</DataText>
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
      {/* The design's day-column overlap treatment (M10 Phase 5): the same
          warning the timeline shows in full, compressed to what fits a 268px
          column — the other stop's title, truncated, and a bare dismiss. The
          one-click fix is deliberately timeline-only; there is no room for a
          "Start 1 pm" button here. */}
      {overlap && (
        <div
          data-testid={`overlap-chip-${activity.activityId}`}
          className="flex items-center gap-1 bg-warning-tint py-1 pl-2 pr-1.5"
          // eslint-disable-next-line no-restricted-syntax -- 7px offset/radius and 11px copy all sit off Tailwind's scale (nearest are 6px and 8px), matching UnscheduledRack/TimelineLens's computed-geometry pattern
          style={{ marginTop: "7px", borderRadius: "7px", fontSize: "11px" }}
        >
          <span className="min-w-0 flex-1 truncate text-warning-ink">Overlaps {overlap.otherTitle}</span>
          {!readOnly && (
            <Button
              variant="ghost"
              size="icon"
              className="size-4 shrink-0 text-warning-ink"
              aria-label="Dismiss overlap warning"
              onClick={() => onDismissOverlap(overlap.conflictId)}
            >
              <X className="size-3" aria-hidden />
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}
