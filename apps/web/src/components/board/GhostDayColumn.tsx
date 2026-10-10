"use client";

import { useId } from "react";
import type { ActivityView } from "@tc/contracts";
import type { Overlap } from "@/components/lenses/overlapData";
import { cn } from "@/lib/cn";
import type { Ghost } from "@/lib/suggestionOverlay";
import { DAY_COLUMN_WIDTH_PX } from "./Column";
import { type BoardSuggestions, DayRiver } from "./DayRiver";
import type { RiverAxis } from "./riverLayout";

const NO_IDS: readonly string[] = [];
const NO_STOPS: Record<string, ActivityView> = {};
const NO_CONFLICTS: ReadonlySet<string> = new Set();
const NO_OVERLAPS: ReadonlyMap<string, Overlap> = new Map();
const NO_PARTNERS: ReadonlyMap<string, readonly string[]> = new Map();
const nothing = () => {};

// Not a `Column`: a Column is a drop target, and this day does not exist yet,
// so nothing may be dragged into it, out of it or added to it. Its river is a
// read-only one with no stops of its own, so it draws only the ghost lane —
// the stops a pending change adds to this day or moves onto it.
/**
 * A day a pending change would add, drawn after the trip's days as a
 * placeholder: dashed, read-only, titled like a day with "· suggested", and
 * carrying that change's Accept and Dismiss (or Withdraw) in its header.
 */
export function GhostDayColumn({
  title,
  day,
  suggestions,
  axis,
  currency,
  fullWidth = false,
}: {
  /** "Day 15 · suggested", with the trip's date when it has one. */
  title: string;
  /** The AddDay change's ghost; `dayId` is the day it adds. */
  day: Ghost;
  suggestions: BoardSuggestions;
  axis: RiverAxis;
  currency: string;
  /** One day at a time, at the phone's width, as `Column`'s `fullWidth`. */
  fullWidth?: boolean;
}) {
  const titleId = useId();
  return (
    <section
      aria-labelledby={titleId}
      data-provisional="suggested"
      className={cn(
        // The grid and subgrid of a day column (`Column`), so its river starts
        // at the same height as theirs.
        "row-span-2 grid min-h-44 grid-rows-subgrid gap-y-2 rounded-2xl border-2 border-dashed border-brand bg-surface p-2",
        fullWidth ? "w-full" : "shrink-0",
      )}
      // eslint-disable-next-line no-restricted-syntax -- 268px matches the day columns' width, which has no token equivalent (Column.tsx owns the constant)
      style={fullWidth ? undefined : { width: DAY_COLUMN_WIDTH_PX }}
    >
      <header className="flex min-w-0 flex-col gap-1">
        <span id={titleId} className="text-sm font-semibold text-brand-pressed">
          {title}
        </span>
        {suggestions.actions(day)}
      </header>
      <DayRiver
        title={title}
        dayId={day.dayId!}
        axis={axis}
        activityIds={NO_IDS}
        activities={NO_STOPS}
        accent="neutral"
        conflictIds={NO_CONFLICTS}
        overlaps={NO_OVERLAPS}
        overlapPartners={NO_PARTNERS}
        currency={currency}
        onEditActivity={nothing}
        onRemoveActivity={nothing}
        onDismissOverlap={nothing}
        focusedTag={null}
        readOnly
        suggestions={suggestions}
      />
    </section>
  );
}
