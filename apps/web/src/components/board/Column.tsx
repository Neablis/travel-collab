"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { X } from "lucide-react";
import type { ActivityView } from "@tc/contracts";
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
};

// Handoff README §"Day columns view": 268px columns — not on Tailwind's
// default scale, so a token class doesn't exist for it (design-system.md
// Enforcement rule 4 bans arbitrary bracket values like w-[268px]). Matches
// TimelineLens/MapLens/ActivityCard's established inline-style + disable
// escape hatch for genuine one-off geometry.
const DAY_COLUMN_WIDTH_PX = 268;

export function Column({
  title,
  dayId,
  activityIds,
  activities,
  conflictIds,
  currency,
  accent,
  onEditActivity,
  onRemoveActivity,
  onRemoveDay,
  onAddActivity,
  fullWidth = false,
  children,
}: {
  title: string;
  dayId: string | null; // null = backlog
  activityIds: string[];
  activities: Record<string, ActivityView>;
  conflictIds: ReadonlySet<string>;
  currency: string;
  // Per-day tint (Task 2's dayAccentFor, keyed off the same chipModel city
  // derivation Tasks 8/10 use) — undefined for the backlog, which stays a
  // neutral bg-moss strip rather than claiming a day's color.
  accent?: AccentFamily;
  onEditActivity: (activityId: string) => void;
  onRemoveActivity: (activityId: string) => void;
  onRemoveDay?: () => void;
  onAddActivity?: () => void;
  // Backlog renders as a full-width strip above the day grid rather than a
  // fixed-width column in the horizontally scrolling row (#31).
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
      data-testid={dayId === null ? "backlog-column" : "day-column"}
      className={cn(
        "flex flex-col rounded-2xl p-2",
        accent ? TINT_BG[accent] : "bg-moss",
        fullWidth ? "w-full" : "shrink-0",
        dayId !== null && "min-h-44", // dated day cards get a comfortable min height
      )}
      // eslint-disable-next-line no-restricted-syntax -- 268px day-column width has no token equivalent, matching TimelineLens/MapLens/ActivityCard's computed-geometry pattern
      style={fullWidth ? undefined : { width: DAY_COLUMN_WIDTH_PX }}
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
        className={cn(
          "m-0 flex-1 list-none rounded-sm p-1",
          dayId !== null ? "min-h-24" : "min-h-12",
          isOver && "bg-brand-tint",
        )}
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
              currency={currency}
              onEdit={() => onEditActivity(id)}
              onRemove={() => onRemoveActivity(id)}
            />
          );
        })}
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
      {children}
    </section>
  );
}
