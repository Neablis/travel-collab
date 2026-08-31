"use client";

import { useEffect, useRef, useState } from "react";
import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import { draggable, dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { attachClosestEdge, extractClosestEdge, type Edge } from "@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge";
import { AlertTriangle, Pencil, X } from "lucide-react";
import type { ActivityTag, ActivityView } from "@tc/contracts";
import { toClockRange } from "@/lib/time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { DataText } from "@/components/ui/data-text";
import { Text } from "@/components/ui/text";
import { formatMoney } from "@/components/lenses/formatMoney";
import type { Overlap } from "@/components/lenses/overlapData";
import { kindBadge } from "./activityKind";
import { TAG_CHIP_CLASS, TAG_LABEL, tagFocusHint, tagFocusOpacity } from "./activityTags";
import { displayPlace } from "@/lib/place";

export function ActivityCard({
  activity,
  dayId,
  hasConflict,
  overlap,
  currency,
  onEdit,
  onRemove,
  onDismissOverlap,
  focusedTag = null,
  onToggleTag,
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
  /**
   * SPEC §11's focused tag, or null. Threaded as a prop rather than read from
   * `useFocus()` here for the same reason `Board` takes `focusedDay` as one:
   * a card stays renderable on its own in a test with no provider around it.
   */
  focusedTag?: ActivityTag | null;
  /**
   * Toggles tag focus. Withheld → the chips stay plain text, which is what
   * M18 shipped and what any caller that has no focus state to drive should
   * still get.
   *
   * Deliberately NOT gated on `readOnly`: focus dims a view, it does not
   * change a trip, so a viewer — and `/demo`'s signed-out reader, which is the
   * surface M18b's gate is walked on — gets the whole behaviour.
   */
  onToggleTag?: (tag: ActivityTag) => void;
  /**
   * Hides the controls that write, leaving everything that reads. Set for a
   * viewer's board and for the public demo (ADR-031).
   *
   * Hidden, not disabled: a greyed-out pencil still says "there is something
   * here for you", and for a reader there is not. The card keeps its title,
   * time, place, cost, notes and its overlap warning — a read-only board is
   * meant to show the whole plan, just not offer to change it.
   */
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
  // Null for `planned` — see activityKind.ts. Both this and the tag chips
  // below render for a reader too: they describe the plan, and `readOnly`
  // withholds the controls that change it, not the plan itself.
  const badge = kindBadge(activity.kind);
  // SPEC §11: a stop that does not carry the focused tag renders faint. It is
  // still rendered, still draggable and still editable — dimming is the whole
  // behaviour, and hiding it would rebuild the filter row this replaced.
  const dimOpacity = tagFocusOpacity(activity.tags, focusedTag);
  const offTag = dimOpacity !== 1;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // A read-only card is not draggable and not a drop target. Registering
    // either would let a reader pick a card up and move it, only for
    // `TripProvider` to refuse the resulting command and the card to snap
    // back — which is precisely the "visibly move and then jump back" the
    // provider's own read-only gate exists to prevent (ADR-031).
    if (readOnly) return;
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
      data-off-tag={offTag ? true : undefined}
      // eslint-disable-next-line no-restricted-syntax -- drag opacity is computed per-frame by pragmatic-drag-and-drop state, and the tag-focus dim is a shared constant, neither expressible as a token class
      style={{ opacity: dragging ? 0.5 : dimOpacity, transition: "opacity 150ms" }}
      className={cn("relative mb-1.5 p-3", !readOnly && "cursor-grab")}
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
      {/* `items-center`, not `items-start` (Mitchell, on the preview: "The icon
          is aligned to the top of the title text, not the middle of the title
          text"). The kind badge has left this row entirely — see the footer. */}
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5">
          <Text as="span" className="font-medium">{activity.title}</Text>
          {hasConflict && (
            <Badge variant="warning" role="img" aria-label="conflict" title="This activity has conflicts">
              <AlertTriangle className="size-3" aria-hidden />
            </Badge>
          )}
        </span>
        {!readOnly && (
          <span className="flex shrink-0 gap-0.5">
            <Button variant="ghost" size="icon" onClick={onEdit} aria-label={`Edit ${activity.title}`}>
              <Pencil className="size-3.5" aria-hidden />
            </Button>
            <Button variant="ghost" size="icon" onClick={onRemove} aria-label={`Remove ${activity.title}`}>
              <X className="size-3.5" aria-hidden />
            </Button>
          </span>
        )}
      </div>
      {activity.timeWindow && (
        <DataText size="xs">{toClockRange(activity.timeWindow.start, activity.timeWindow.end)}</DataText>
      )}
      {activity.location && <Text as="span" variant="muted"> · {displayPlace(activity.location)}</Text>}
      {/* One footer row carries every status the card shows — kind, tags, cost
          (Mitchell, on the preview: the kind badge was "kinda floating in
          middle of card… really messing with the card spacing", and the cost
          "really blends in, lets find a better way to style this so it better
          uses the space on the card").

          What changed and why. The kind badge used to sit inline after the
          title, so on a short title it stopped mid-width with nothing to align
          to — the floating Mitchell saw. Tags then took a row of their own and
          the cost a third, so a card was four stacked rows of which two held a
          single short item each. Grouping them into one `justify-between` row
          anchors the badge to the card's left edge, gives the cost the right
          edge, and returns a row's worth of height to every card.

          The cost is `text-ink` rather than the muted slate the meta line uses:
          it was the same colour and weight as the place it sat under, so it
          read as one more line of metadata rather than as the number.

          Tag chips were spans through M18, because SPEC §11's
          click-a-chip-to-focus behaviour was carved out as M18b and a chip that
          looked pressable and did nothing would have been a worse lie than one
          that plainly reads. M18b landed the behaviour, so they are buttons
          now — but only when a caller hands down `onToggleTag`; without it they
          fall back to the spans, and the old rule still holds for that caller.
          Rendered in the stop's own array order rather than the canonical one
          the editor writes — the card shows the data it was given, including
          arrays written before there was an editor. */}
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="flex min-w-0 flex-wrap items-center gap-1.5">
          {badge && (
            <Badge variant={badge.variant} data-testid={`kind-badge-${activity.activityId}`}>
              {badge.label}
            </Badge>
          )}
          {activity.tags.length > 0 && (
            <span data-testid={`tag-chips-${activity.activityId}`} className="flex flex-wrap gap-1.5">
              {activity.tags.map((tag) => {
                const chipClass = cn(
                  "inline-flex items-center rounded-sm px-2 py-0.5 text-xs font-semibold",
                  TAG_CHIP_CLASS[tag],
                );
                if (!onToggleTag) {
                  return (
                    <span key={tag} data-testid={`tag-chip-${tag}`} className={chipClass}>
                      {TAG_LABEL[tag]}
                    </span>
                  );
                }
                const isFocused = focusedTag === tag;
                return (
                  // eslint-disable-next-line no-restricted-syntax -- a tag chip is not a Button-variant action: every buttonVariants() variant hard-codes a hover background (`hover:bg-moss`, `hover:bg-brand-hover`) plus `disabled:opacity-50`, and a chip's whole job is to keep its own tag colour — the hover class would repaint it moss and twMerge cannot drop a `hover:` class the chip does not itself set. Same escape hatch, and same reasoning, as MapRail's day rows.
                  <button
                    key={tag}
                    type="button"
                    data-testid={`tag-chip-${tag}`}
                    // `aria-pressed` rather than a role of its own: this is a
                    // toggle whose off state is "no tag focused", which is
                    // exactly what a toggle button announces. The accessible
                    // name is the hint, not the bare label — "Meal" alone tells
                    // a screen-reader user the chip exists and nothing about
                    // what pressing it does, and the hint is the sentence the
                    // handoff already wrote for the same purpose on hover.
                    aria-pressed={isFocused}
                    aria-label={tagFocusHint(tag, isFocused)}
                    title={tagFocusHint(tag, isFocused)}
                    onClick={(event) => {
                      // The card is a drag source and, in the timeline's
                      // sibling surfaces, sits inside larger click targets;
                      // without this a chip click also starts whatever the
                      // surface below it does.
                      event.stopPropagation();
                      onToggleTag(tag);
                    }}
                    className={cn(
                      chipClass,
                      "cursor-pointer hover:opacity-80",
                      // The focused chip's ring, M18b scope. `ring-inset` for
                      // the same reason the calendar cell's is: a chip sits
                      // inside rows that clip, and an outset ring on the first
                      // one loses its left edge.
                      isFocused && "ring-2 ring-brand ring-inset",
                    )}
                  >
                    {TAG_LABEL[tag]}
                  </button>
                );
              })}
            </span>
          )}
        </span>
        {/* Task 4.1 (M10 Phase 4): the board's per-stop cost — mono, formatMoney
            (KI-2), honest "No cost yet" for the null/undefined case. */}
        {activity.cost ? (
          <DataText size="xs" className="shrink-0 font-semibold text-ink">
            {formatMoney(activity.cost.amountMinor, currency)}
          </DataText>
        ) : (
          <DataText size="xs" className="shrink-0">No cost yet</DataText>
        )}
      </div>
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
          {/* The warning stays for a reader — it is part of the plan they came
              to look at. Dismissing it is a command, so that half goes. */}
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
