"use client";

import { useEffect, useRef, useState } from "react";
import { dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import type { DragLocationHistory } from "@atlaskit/pragmatic-drag-and-drop/types";
import { X } from "lucide-react";
import type { ActivityTag, ActivityView } from "@tc/contracts";
import type { Overlap } from "@/components/lenses/overlapData";
import { Button } from "@/components/ui/button";
import { type AccentFamily } from "@/lib/dayAccent";
import { cn } from "@/lib/cn";
import { ActivityCard } from "./ActivityCard";

// Same static-map pattern as TimelineLens.tsx's TINT_BG / DayChips.tsx's
// CHIP_BG: Tailwind's JIT scanner can't see a template-interpolated
// `bg-${family}-tint`, so this is the only route from an AccentFamily to a
// real class.
const TINT_BG: Record<AccentFamily, string> = {
  brand: "bg-brand-tint",
  info: "bg-info-tint",
  success: "bg-success-tint",
  warning: "bg-warning-tint",
  danger: "bg-danger-tint",
  neutral: "bg-moss",
};

// Handoff README §"Day columns view": 268px columns — not on Tailwind's
// default scale, so a token class doesn't exist for it (design-system.md
// Enforcement rule 4 bans arbitrary bracket values like w-[268px]). Matches
// TimelineLens/MapLens/ActivityCard's established inline-style + disable
// escape hatch for genuine one-off geometry.
//
// Exported because Phase 6's trailing "One more day?" column (Board.tsx) has
// to be exactly as wide as a day column for the row to read as "the trip
// could grow by one more of these" — two independent 268 literals could
// drift apart and the affordance would stop lining up.
export const DAY_COLUMN_WIDTH_PX = 268;

// A Column is a dated day column and nothing else now (Task 3.3): the
// unscheduled pool moved out of the board entirely, into the Unscheduled
// drawer, so `dayId` is always a real day and the old full-width/backlog
// variant — plus its `fullWidth` and `children` props — is gone.
export function Column({
  title,
  dayId,
  activityIds,
  activities,
  conflictIds,
  overlaps,
  currency,
  accent,
  onEditActivity,
  onRemoveActivity,
  onRemoveDay,
  isFocused = false,
  onSelect,
  onAddActivity,
  onDismissOverlap,
  focusedTag = null,
  onToggleTag,
  readOnly = false,
}: {
  title: string;
  dayId: string;
  activityIds: string[];
  activities: Record<string, ActivityView>;
  conflictIds: ReadonlySet<string>;
  // This day's live time-overlaps, keyed by the stop the warning attaches to
  // (the later one) — same derivation the timeline uses, so a crossing pair
  // reads the same in both lenses.
  overlaps: ReadonlyMap<string, Overlap>;
  currency: string;
  // Per-day tint (Task 2's dayAccents, keyed off the same chipModel city
  // derivation Tasks 8/10 use).
  accent: AccentFamily;
  onEditActivity: (activityId: string) => void;
  onRemoveActivity: (activityId: string) => void;
  onRemoveDay?: () => void;
  /** True when this day is the one the day-chips row has ringed. */
  isFocused?: boolean;
  /** Selects this day, exactly as clicking its chip above does. */
  /** Receives `true` when the click should CLEAR the focus (see the header). */
  onSelect?: (clearing: boolean) => void;
  onAddActivity?: () => void;
  onDismissOverlap: (conflictId: string) => void;
  /** SPEC §11's focused tag, passed to every card so off-tag stops dim. */
  focusedTag?: ActivityTag | null;
  /** Passed to every card's chips; withheld leaves them plain text. */
  onToggleTag?: (tag: ActivityTag) => void;
  /** Passed to every card: hide what writes, keep what reads (ADR-031). */
  readOnly?: boolean;
}) {
  const ref = useRef<HTMLUListElement>(null);
  // Whether this column itself — not one of its cards — is the innermost
  // drop target: hovering blank space (or an empty column) rather than a
  // specific card. ActivityCard's own top/bottom edge line covers every case
  // where a card *is* the innermost target; this covers what's left, which
  // is exactly where resolveDrop.ts's "dropped on a column: append" branch
  // fires. No hover tint on the column itself any more (Task 3.3) — this is
  // the insertion-line replacement the Phase 3 design called for instead.
  const [isOver, setIsOver] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const updateIsOver = ({ location }: { location: DragLocationHistory }) =>
      setIsOver(location.current.dropTargets[0]?.element === el);
    return dropTargetForElements({
      element: el,
      getData: () => ({ dayId }),
      onDragEnter: updateIsOver,
      onDrag: updateIsOver,
      onDragLeave: () => setIsOver(false),
      onDrop: () => setIsOver(false),
    });
  }, [dayId]);

  return (
    <section
      data-testid="day-column"
      className={cn(
        "flex min-h-44 shrink-0 flex-col rounded-2xl p-2",
        TINT_BG[accent],
        // Same ring the focused chip wears (DayChips), so "this day" reads the
        // same whichever of the two you picked it from.
        isFocused && "ring-2 ring-brand",
      )}
      // eslint-disable-next-line no-restricted-syntax -- 268px day-column width has no token equivalent, matching TimelineLens/MapLens/ActivityCard's computed-geometry pattern
      style={{ width: DAY_COLUMN_WIDTH_PX }}
    >
      <header className="flex items-baseline justify-between">
        {/* Mitchell, preview feedback on PR #55: "You should also be able to
            select the day here, and it syncs to the day card above." The chips
            row was the only way to focus a day; the column you are already
            looking at is the more obvious place to click. Same call as the
            chip's, same `aria-pressed`, and — since M16 Wave 2 gave the chips
            a toggle-off — the same toggle-off, because matching the chips
            beats inventing a second selection idiom on the same state. It
            reports WHETHER it is clearing rather than what to focus, so the
            index stays where it already lived (Board.tsx). */}
        {onSelect ? (
          <Button
            variant="ghost"
            onClick={() => onSelect(isFocused)}
            aria-pressed={isFocused}
            className="h-auto p-0 text-sm font-semibold text-ink hover:bg-transparent hover:underline"
          >
            {title}
          </Button>
        ) : (
          <span className="text-sm font-semibold text-ink">{title}</span>
        )}
        {onRemoveDay && (
          <Button variant="ghost" size="icon" onClick={onRemoveDay} aria-label={`Remove ${title}`}>
            <X className="size-3.5" aria-hidden />
          </Button>
        )}
      </header>
      <ul ref={ref} className="m-0 min-h-24 flex-1 list-none rounded-sm p-1">
        {activityIds.map((id) => {
          const activity = activities[id];
          if (activity === undefined) return null;
          return (
            <ActivityCard
              key={id}
              activity={activity}
              dayId={dayId}
              hasConflict={conflictIds.has(id)}
              overlap={overlaps.get(id) ?? null}
              currency={currency}
              onEdit={() => onEditActivity(id)}
              onRemove={() => onRemoveActivity(id)}
              onDismissOverlap={onDismissOverlap}
              focusedTag={focusedTag}
              onToggleTag={onToggleTag}
              readOnly={readOnly}
            />
          );
        })}
        {/* The "append here" half of the insertion line: shown only while
            the column itself, not one of its cards, is the innermost drop
            target — blank space below the last card, or an empty column
            entirely. Matches resolveDrop.ts's "dropped on a column: append"
            branch, which always lands at the end of the list regardless of
            where within the column the drop actually happened. */}
        {isOver && <li aria-hidden className="h-0.5 rounded-full bg-brand" />}
      </ul>
      {/* Handoff README §"Day columns view": "a dashed '+ Add' button per
          column" — a consistent dashed affordance regardless of whether the
          day already has cards, rather than collapsing to a bare "+" once
          populated (#20's original empty-only treatment). */}
      {onAddActivity && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onAddActivity}
          aria-label={`Add activity to ${title}`}
          className="mt-1.5 w-full justify-center rounded-lg border border-dashed border-border-strong py-2 text-slate"
        >
          + Add
        </Button>
      )}
    </section>
  );
}
