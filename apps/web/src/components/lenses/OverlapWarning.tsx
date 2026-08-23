"use client";

import { Button } from "@/components/ui/button";
import { formatDuration, toClockLabel } from "@/lib/time";
import type { Overlap } from "./overlapData";

// The design's inline overlap treatment: a row in the timeline's own
// `92px 1fr` grid (left cell empty, so the warning lines up under the card it
// belongs to rather than under the time column), never a modal and never
// blocking — conflicts are data, not errors (AGENTS.md invariant 3). Both
// controls are advisory: "Start HH:MM" moves the stop, "Dismiss" hides this
// pair's warning and changes no trip data.
//
// The fix is offered only when the duration-preserving move fits inside the
// day (overlapData.ts decides that, and hands the target end over as
// `suggestedEnd`). When it doesn't, the warning still states the overlap and
// still dismisses — it just has no button that would have to shorten the stop
// to land it, which the fix is explicitly not allowed to do.
export function OverlapWarning({
  overlap,
  onFix,
  onDismiss,
}: {
  overlap: Overlap;
  onFix: () => void;
  onDismiss: () => void;
}) {
  // Assembled as one string rather than interpolated into the JSX: the copy is
  // a single sentence, and a run of sibling text nodes is exactly what
  // getByText's default (direct-text-children) matcher can't see as one.
  const line = `Overlaps ${overlap.otherTitle}, ${toClockLabel(overlap.otherStart)} – ${toClockLabel(overlap.otherEnd)} — ${formatDuration(overlap.overlapMinutes, "on top of each other.")}`;

  return (
    <div
      className="grid gap-4"
      // eslint-disable-next-line no-restricted-syntax -- fixed time-column width has no token equivalent, matching TimelineLens/MapLens/ActivityCard's computed-geometry pattern; the 6px offset from the row above sits below Tailwind's spacing scale
      style={{ gridTemplateColumns: "92px 1fr", marginTop: "6px" }}
    >
      <div />
      <div
        data-testid={`overlap-warning-${overlap.laterActivityId}`}
        className="flex flex-wrap items-center gap-x-2.5 gap-y-2 bg-warning-tint py-2 pl-3 pr-2.5"
        // eslint-disable-next-line no-restricted-syntax -- 10px corner radius sits between --radius-sm (6px) and --radius-md (8px)/--radius-lg (12px), no token equivalent
        style={{ borderRadius: "10px" }}
      >
        <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-warning" />
        <span
          className="flex-1 text-warning-ink"
          // eslint-disable-next-line no-restricted-syntax -- 12.5px/1.45 warning copy and its 200px wrap floor are design-fixed values with no token equivalent, matching UnscheduledRack/MapFocusCard's pattern
          style={{ minWidth: "200px", fontSize: "12.5px", lineHeight: 1.45 }}
        >
          {line}
        </span>
        {overlap.suggestedEnd !== null && (
          <Button variant="secondary" size="sm" onClick={onFix}>
            Start {toClockLabel(overlap.suggestedStart)}
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
    </div>
  );
}
