"use client";

import { useEffect, useRef, useState } from "react";
import { draggable } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { AlertTriangle, X } from "lucide-react";
import type { ActivityTag, ActivityView, TimeWindow } from "@tc/contracts";
import { KIND_LABEL } from "@tc/pages";
import { useTimeFormat } from "@/components/account/PreferencesProvider";
import type { Overlap } from "@/components/lenses/overlapData";
import { Button } from "@/components/ui/button";
import { DataText } from "@/components/ui/data-text";
import { TAG_LABEL, tagFocusOpacity } from "@/lib/activityTags";
import { cn } from "@/lib/cn";
import type { AccentFamily } from "@/lib/dayAccent";
import { formatMoney } from "@/lib/formatMoney";
import { displayPlace } from "@/lib/place";
import { formatDuration, toClockRange, toMinutes } from "@/lib/time";
import { PENDING_REASON_DISPLAY } from "./PendingReasonPicker";
import type { RiverPlacement } from "./riverLayout";
import { StopTagChips } from "./StopTagChips";
import { MODE_DISPLAY } from "./TravelModePicker";

/**
 * How a block is drawn — SPEC §36.9b's table, where *how dark a block is says
 * how locked in it is*. `booked` is absent on purpose: there is no booking
 * fact to draw it from (M29, out of scope).
 */
type RiverTone = "planned" | "book" | "maybe" | "pending" | "transit";

// The day's city colour as a block edge. A static map for the same reason
// Column's TINT_BG is one: Tailwind only emits a class it can read literally.
// `neutral` has no solid, so a day with no city takes slate.
const PLANNED_EDGE: Record<AccentFamily, string> = {
  brand: "border-brand",
  info: "border-info",
  success: "border-success",
  warning: "border-warning",
  danger: "border-danger",
  neutral: "border-slate",
};

// `tc-river-edge` is the 1.5px the design draws, which Tailwind's integer
// border widths cannot spell (globals.css). Nothing here lowers opacity: a
// Maybe is hatched, never faded (SPEC §36.9: "never faded").
const TONE_CLASS: Record<Exclude<RiverTone, "planned">, string> = {
  book: "tc-river-edge border-dashed border-warning-ink bg-surface",
  pending: "tc-river-edge border-dashed border-warning-ink bg-surface",
  maybe: "tc-river-hatch border border-dashed border-border-strong bg-surface",
  transit: "border-2 border-dotted border-info-ink bg-info-tint",
};

// Remove and Dismiss: a 16px mark with a 24px reach. The `after:` box is the
// hit area, four pixels out on every side, so the title row keeps its density
// and the target still meets WCAG 2.5.8's 24px minimum.
const CONTROL_CLASS = "relative size-4 min-h-0 min-w-0 hover:bg-transparent after:absolute after:-inset-1";

const TAG_INK: Record<RiverTone, string> = {
  planned: "text-slate",
  book: "text-warning-ink",
  pending: "text-warning-ink",
  maybe: "text-slate",
  transit: "text-info-ink",
};

type RiverLook = {
  tone: RiverTone;
  /** The block's title line — a transit leg leads with how it travels. */
  title: string;
  /** The mono word in the corner, or null for a planned stop, which needs none. */
  tag: string | null;
  /** The kind as a screen reader hears it. */
  kindWord: string;
};

function durationLabel(window: TimeWindow): string {
  return formatDuration(toMinutes(window.end) - toMinutes(window.start), "").trim();
}

/** What a stop looks like on the river — the table at the top of this file. */
function riverLook(stop: Pick<ActivityView, "kind" | "mode" | "pendingReason" | "title">, window: TimeWindow): RiverLook {
  if (stop.kind === "transit") {
    const mode = stop.mode === null ? KIND_LABEL.transit : MODE_DISPLAY[stop.mode].label;
    const duration = durationLabel(window);
    return { tone: "transit", title: `${mode} · ${stop.title}`, tag: duration, kindWord: `${mode}, ${duration}` };
  }
  if (stop.kind === "pending") {
    // A pending stop written before ADR-055 has no reason; it reads the way the
    // card's badge does — the kind's own word — on the To book styling, since
    // "not settled" is what pending meant before there was a why.
    if (stop.pendingReason === null) return { tone: "pending", title: stop.title, tag: "Pending", kindWord: "Pending" };
    const label = PENDING_REASON_DISPLAY[stop.pendingReason].label;
    return { tone: stop.pendingReason, title: stop.title, tag: label, kindWord: label };
  }
  return { tone: "planned", title: stop.title, tag: null, kindWord: KIND_LABEL.planned };
}

/**
 * One timed stop, drawn to scale on its day's river (SPEC §36.9b).
 *
 * The whole block is the edit target: a button laid under the block's content
 * carries the click, the focus ring and the accessible name — title, time,
 * kind, and any overlap — while the few controls that do something else (the
 * tag chips, remove, dismiss) sit above it and take their own clicks. That is
 * what lets a 24px block be one click to open without nesting buttons.
 *
 * It is a drag source exactly as the card is, and deliberately NOT a drop
 * target: "insert above/below this card" means nothing on a to-scale axis,
 * where position is the stop's time. A drop over a block falls through to the
 * day column, which moves the stop to that day and keeps its time (Part 3
 * makes the drop land at the pointer's time instead).
 */
export function RiverBlock({
  activity,
  window,
  placement,
  accent,
  hasConflict,
  overlap,
  overlapPartners,
  currency,
  onEdit,
  onRemove,
  onDismissOverlap,
  focusedTag = null,
  onToggleTag,
  readOnly = false,
}: {
  activity: ActivityView;
  /** The stop's own window, already known non-null by the caller. */
  window: TimeWindow;
  placement: RiverPlacement;
  /** The day's city colour — a planned block's edge. */
  accent: AccentFamily;
  hasConflict: boolean;
  /** The overlap this stop is the later half of, which it can dismiss. */
  overlap: Overlap | null;
  /** Every stop this one overlaps (undismissed), by title — empty when none. */
  overlapPartners: readonly string[];
  currency: string;
  onEdit: () => void;
  onRemove: () => void;
  onDismissOverlap: (conflictId: string) => void;
  focusedTag?: ActivityTag | null;
  onToggleTag?: (tag: ActivityTag) => void;
  readOnly?: boolean;
}) {
  const clock = useTimeFormat();
  const ref = useRef<HTMLLIElement>(null);
  const [dragging, setDragging] = useState(false);
  const dimOpacity = tagFocusOpacity(activity.tags, focusedTag);

  useEffect(() => {
    const el = ref.current;
    // Same reason as ActivityCard: a reader must not pick a stop up only for
    // the provider to refuse the move and snap it back (ADR-031).
    if (!el || readOnly) return;
    return draggable({
      element: el,
      getInitialData: () => ({ activityId: activity.activityId }),
      onDragStart: () => setDragging(true),
      onDrop: () => setDragging(false),
    });
  }, [activity.activityId, readOnly]);

  const look = riverLook(activity, window);
  const overlapping = overlapPartners.length > 0;
  const range = toClockRange(window.start, window.end, clock);
  const where = activity.location ? displayPlace(activity.location) : null;
  const cost = activity.cost ? formatMoney(activity.cost.amountMinor, currency) : null;
  // Everything the drawn block says is aria-hidden (the block is one button's
  // worth of picture), so the name carries what the card it replaced let a
  // screen reader read: the place and the cost, which a narrow or short block
  // does not draw at all, and the tags, which only a tall one does.
  const description = [
    activity.title,
    range,
    look.kindWord,
    where,
    cost,
    activity.tags.length > 0 ? `tagged ${activity.tags.map((t) => TAG_LABEL[t]).join(" and ")}` : null,
    overlapping ? `overlaps ${overlapPartners.join(" and ")}` : null,
    hasConflict ? "has conflicts" : null,
  ]
    .filter((part): part is string => part !== null)
    .join(", ");
  const tag = overlapping ? "Overlap" : look.tag;
  const tagInk = overlapping ? "text-warning-ink" : TAG_INK[look.tone];
  // **A lane is narrow.** Half of a 268px column leaves ~100px, and a title
  // row carrying OVERLAP and two controls as well had room for one letter of
  // title. So a block sharing its row moves its tag down to the time line,
  // where it replaces the place; a compact one (no second line) keeps only a
  // warning mark, and the word stays in its accessible name.
  const narrow = placement.lanes > 1;
  const roomy = placement.tier !== "compact";
  // SPEC §36.9b: tags from 70px. The cost rides on the same row — the design
  // draws no cost on a block, but the card it replaces always showed one, and
  // a tall block that has the width has the room.
  const showCost = !narrow && Boolean(activity.cost);
  const showFooter = placement.tier === "tall" && (activity.tags.length > 0 || showCost);
  // **A shorter block still lets its tags be focused.** SPEC §36.9b draws a
  // block under 70px without them, and at rest it stays that way — but every
  // lodging stop in the demo is a 30-minute check-in, so without this nothing
  // on a desktop Plan could focus `lodging`. The chips come up just below the
  // block while it is hovered or holds focus (the edit button is the first
  // Tab stop, the chips the next), the same reveal the narrow-lane controls
  // use.
  const revealTags = placement.tier !== "tall" && activity.tags.length > 0 && onToggleTag !== undefined;
  const tagMark = tag && (
    <DataText
      aria-hidden
      size="xs"
      // A word tag is a mono capital label, as drawn; a transit leg's
      // duration is a number and keeps its case ("2 h 15 m").
      className={cn("shrink-0 font-semibold", !(look.tone === "transit" && !overlapping) && "uppercase tracking-wide", tagInk)}
    >
      {tag}
    </DataText>
  );

  // Lanes share the width left of nothing: `(100% + gap) / lanes` per lane,
  // less the gap, puts the last lane flush with the right edge and every gap
  // the same 4px however many lanes there are.
  const laneLeft = placement.lanes === 1 ? "0px" : `calc(${placement.lane} * (100% + 4px) / ${placement.lanes})`;
  const laneWidth = placement.lanes === 1 ? "100%" : `calc((100% + 4px) / ${placement.lanes} - 4px)`;

  return (
    <li
      ref={ref}
      data-testid={`activity-card-${activity.activityId}`}
      data-off-tag={dimOpacity !== 1 ? true : undefined}
      // `z-10` while hovered or focused: the tag reveal below hangs out of
      // the block, over whichever block comes next in the DOM.
      className={cn("group absolute hover:z-10 focus-within:z-10", !readOnly && "cursor-grab")}
      // eslint-disable-next-line no-restricted-syntax -- the block's top, height and lane are computed from its time on the shared axis (riverLayout.ts), and the drag/tag-focus opacity is per-frame state; none is expressible as a token class
      style={{
        top: placement.topPx,
        height: placement.heightPx,
        left: laneLeft,
        width: laneWidth,
        opacity: dragging ? 0.5 : dimOpacity,
        transition: "opacity 150ms",
      }}
    >
      <div
        className={cn(
          "relative flex h-full flex-col gap-px overflow-hidden rounded-md px-2 py-0.5 group-hover:shadow-raised",
          overlapping
            ? cn("border-2 border-solid border-warning-ink", look.tone === "transit" ? "bg-info-tint" : "bg-surface", look.tone === "maybe" && "tc-river-hatch")
            : look.tone === "planned"
              ? cn("tc-river-edge border-solid bg-surface", PLANNED_EDGE[accent])
              : TONE_CLASS[look.tone],
        )}
      >
        {readOnly ? (
          <span className="sr-only">{description}</span>
        ) : (
          <Button
            variant="ghost"
            onClick={onEdit}
            aria-label={`Edit ${description}`}
            className="absolute inset-0 h-auto min-h-0 min-w-0 rounded-md p-0 hover:bg-transparent focus-visible:outline-offset-0"
          />
        )}
        {/* Content paints above the button (later in the DOM, positioned) and
            lets clicks through to it; the controls opt back in. */}
        <div className="pointer-events-none relative flex min-w-0 items-center gap-1.5">
          <span aria-hidden className="min-w-0 flex-1 truncate text-xs font-semibold text-ink">
            {look.title}
          </span>
          {(hasConflict || (narrow && !roomy && overlapping)) && (
            <AlertTriangle aria-hidden className="size-3 shrink-0 text-warning-ink" />
          )}
          {!narrow && tagMark}
          {/* In a narrow lane the two controls would leave the title no room at
              all, so under a mouse they float over its end only while the
              block is hovered or holds focus — the edit button is the first
              thing a Tab reaches, and focusing it brings them up for the next
              Tab. Hidden means untappable too: an invisible Remove is still a
              Remove. **`pointer-fine`, not `md`, decides "under a mouse"** —
              Tailwind's `hover:` only exists under `(hover: hover)`, so a
              touch tablet past 768px could never bring them up; it shows them
              always, as a phone does. */}
          <span
            className={cn(
              "pointer-events-auto flex shrink-0 items-center gap-1",
              narrow &&
                "absolute top-0 right-0 rounded-sm bg-surface pointer-fine:pointer-events-none pointer-fine:opacity-0 group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100",
            )}
          >
            {!readOnly && overlap && (
              <Button
                variant="ghost"
                size="icon"
                aria-label="Dismiss overlap warning"
                title={`Overlaps ${overlap.otherTitle}`}
                onClick={() => onDismissOverlap(overlap.conflictId)}
                className={cn(CONTROL_CLASS, "text-warning-ink")}
              >
                <X className="size-3" aria-hidden />
              </Button>
            )}
            {!readOnly && (
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Remove ${activity.title}`}
                onClick={onRemove}
                className={CONTROL_CLASS}
              >
                <X className="size-3" aria-hidden />
              </Button>
            )}
          </span>
        </div>
        {roomy && (
          <span
            aria-hidden
            className={cn(
              "pointer-events-none relative flex min-w-0 items-baseline gap-1.5 text-xs",
              look.tone === "transit" ? "text-info-ink" : "text-slate",
            )}
          >
            {narrow && tagMark}
            <span className="truncate">{where && !narrow ? `${range} · ${where}` : range}</span>
          </span>
        )}
        {showFooter && (
          <div className="relative mt-auto flex items-end justify-between gap-1.5 pb-0.5">
            <span className="pointer-events-auto min-w-0">
              <StopTagChips activityId={activity.activityId} tags={activity.tags} focusedTag={focusedTag} onToggleTag={onToggleTag} />
            </span>
            {showCost && activity.cost && (
              <DataText aria-hidden size="xs" className="pointer-events-none shrink-0 font-semibold text-ink">
                {formatMoney(activity.cost.amountMinor, currency)}
              </DataText>
            )}
          </div>
        )}
      </div>
      {revealTags && (
        // Below the block, not inside it: a 24px block has no room, and its
        // box clips. `pt-0.5` rather than a margin, so there is no gap for the
        // pointer to fall through on its way down and lose the hover.
        <div className="pointer-events-none absolute top-full left-0 pt-0.5 opacity-0 group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100">
          <span className="flex rounded-md bg-surface p-1 shadow-overlay">
            <StopTagChips activityId={activity.activityId} tags={activity.tags} focusedTag={focusedTag} onToggleTag={onToggleTag} />
          </span>
        </div>
      )}
    </li>
  );
}
