"use client";

import { useEffect, useRef, useState } from "react";
import { draggable, dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toClockRange } from "@/lib/time";
import { Card } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/native-select";
import { Preview } from "@/components/ui/preview";
import { cn } from "@/lib/cn";

export type RackItem = {
  activityId: string;
  title: string;
  area: string | null;
  // A parked stop usually has no time (unscheduling strips it), but a stop
  // created unscheduled can still carry one — so the compact card shows the
  // real window when there is one and the design's "No time yet" when there
  // isn't, rather than asserting "No time yet" over a time the trip holds.
  timeWindow: { start: string; end: string } | null;
};

// Phase 3 design values (`current/…dc.html:671-707`, transcribed in
// docs/plans/M10-delta/phase-3-rack.md): the "Unscheduled" drawer that
// replaces the board's full-width Backlog column. Collapsed by default;
// present in every lens (TripBoardScreen mounts it outside the lens switch).
//
// The drawer's own pinning lives in globals.css as `.unscheduled-rack` — see
// that rule's comment for why the design's `position: sticky; margin-top:
// auto` becomes `fixed` from the DOM position TripBoardScreen mounts it at.
// `z-20` is the design's own z-index and deliberately sits below the
// Assistant rail (z-50) and `.overlay-layer` (z-60).
//
// Task 3.3 makes the drawer a real drag participant: the whole <section> is a
// drop target (so a drop anywhere on it unschedules — the design's full-rect
// hit test, and it works while the drawer is still collapsed), and each card
// is a draggable that can be pulled back onto a day.
export function UnscheduledRack({
  items,
  dayOptions,
  open,
  onToggle,
  onAssign,
}: {
  items: RackItem[];
  dayOptions: { value: string; label: string }[];
  open: boolean;
  onToggle: () => void;
  /**
   * Absent on a read-only board (a viewer's, or the demo's — ADR-031): the
   * parked ideas are part of the plan and stay visible; the picker that moves
   * one onto a day is a command, and goes.
   */
  onAssign?: (activityId: string, dayId: string) => void;
}) {
  const ref = useRef<HTMLElement>(null);
  const [isOver, setIsOver] = useState(false);
  const Caret = open ? ChevronDown : ChevronRight;

  // Registered on the outer <section>, which is always rendered — the card row
  // below only exists while the drawer is open, and the drawer has to be
  // droppable from the moment a drag starts, before the auto-open lands.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return dropTargetForElements({
      element: el,
      getData: () => ({ rack: true }),
      onDragEnter: () => setIsOver(true),
      onDragLeave: () => setIsOver(false),
      onDrop: () => setIsOver(false),
    });
  }, []);

  return (
    <section
      ref={ref}
      data-testid="unscheduled-rack"
      data-bldrop="1"
      aria-label="Unscheduled"
      // The drop affordance is a tint that fades in and out under the drawer
      // (transition-colors) rather than a hard highlight — see this task's
      // report for why this is the honest simple version of the design's
      // "cross-fade the drag proxy" note.
      className={cn(
        "unscheduled-rack z-20 border-t border-hairline transition-colors duration-200",
        isOver ? "bg-brand-tint" : "bg-surface",
      )}
    >
      {/* The whole bar is the toggle (the design's "toggle row": flex,
          align-items center, gap 12px, padding 9px 26px). Rendered through
          the Button primitive with its own height/padding/radius neutralised
          so it reads as a bar, not a pill. */}
      <Button
        variant="ghost"
        aria-expanded={open}
        onClick={onToggle}
        className="h-auto w-full justify-start gap-3 rounded-none px-0 py-0 hover:bg-moss"
        // eslint-disable-next-line no-restricted-syntax -- 9px/26px toggle-row padding is design-fixed geometry with no token equivalent, matching DayChips/TimelineLens' computed-geometry pattern
        style={{ padding: "9px 26px" }}
      >
        {/* The "Show"/"Hide" word that used to sit between the caret and
            the label is gone (Mitchell, 2026-08-30 design pass) — it said
            what the caret already says, in 11.5px grey, and the bar still
            did not read as clickable. What replaces it is contrast, not
            copy: the caret and label are `text-ink` rather than `text-slate`
            and the caret is a size up, so the row reads as a control at
            rest instead of only on hover. `aria-expanded` on the Button
            carries the open/closed state that the word used to carry, so
            nothing is lost for a screen reader. */}
        <Caret
          aria-hidden
          className="shrink-0 text-ink"
          // eslint-disable-next-line no-restricted-syntax -- 13px caret in a 15px line box: one step up from the design's 11/13, neither of which is on the spacing scale
          style={{ width: "13px", height: "15px" }}
        />
        <span
          className="text-xs font-semibold uppercase text-ink"
          // eslint-disable-next-line no-restricted-syntax -- 0.04em tracking sits between Tailwind's tracking-wide (0.025em) and tracking-wider (0.05em)
          style={{ letterSpacing: "0.04em" }}
        >
          Unscheduled
        </span>
        <Badge variant="neutral">{items.length}</Badge>
        {/* The design's "hint" (12px --color-slate, beside the toggle). The
            handoff table specifies the element but never its copy, and the
            prototype is not in the repo; this wording was written for it
            rather than recovered, and describes what the drawer holds so it
            stays true whether the rack is empty or full. Swap it if the
            handoff's own string turns up. */}
        <span className="text-xs font-normal normal-case text-slate">Stops with no day yet</span>
      </Button>
      {/* Collapsed means *not rendered*, not merely hidden: nothing parked
          should be reachable by keyboard or by a text query while the drawer
          is shut. */}
      {open ? (
        <div
          className="flex gap-2.5 overflow-x-auto"
          // eslint-disable-next-line no-restricted-syntax -- 26px side / 14px bottom card-row padding is design-fixed geometry with no token equivalent
          style={{ padding: "0 26px 14px" }}
        >
          {items.length === 0 ? (
            <p
              className="flex-1 rounded-lg border border-dashed border-border-strong p-4 text-slate"
              // eslint-disable-next-line no-restricted-syntax -- 240px min width and 12.5px copy are design-fixed values with no token equivalent
              style={{ minWidth: "240px", fontSize: "12.5px" }}
            >
              {onAssign === undefined
                ? "Nothing parked."
                : "Nothing parked. Drag a stop down here to take it off the schedule without losing it."}
            </p>
          ) : (
            items.map((item) => (
              <RackCard key={item.activityId} item={item} dayOptions={dayOptions} onAssign={onAssign} />
            ))
          )}
        </div>
      ) : null}
    </section>
  );
}

function RackCard({
  item,
  dayOptions,
  onAssign,
}: {
  item: RackItem;
  dayOptions: { value: string; label: string }[];
  /**
   * Absent on a read-only board (a viewer's, or the demo's — ADR-031): the
   * parked ideas are part of the plan and stay visible; the picker that moves
   * one onto a day is a command, and goes.
   */
  onAssign?: (activityId: string, dayId: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  // Same payload shape ActivityCard's draggable carries ({ activityId }), so
  // Board's monitor routes a card dragged out of the rack exactly like one
  // dragged between days — resolveDrop needs no rack-source special case.
  // `onAssign` absent IS the viewer signal here — TripBoardScreen withholds it
  // rather than passing a flag (ADR-031) — so it gates the drag registration
  // too, not just the "Add to day" select below. Registering `draggable` for a
  // viewer is the precise failure the read-only work exists to stop: the card
  // lifts, follows the cursor, and snaps back when the server refuses the
  // MoveActivity it produced (docs/reviews/2026-08-28-m11-pr71-review.md §5).
  // In the dep array for the same reason: a rack rendered before the access
  // read resolves would otherwise keep the editor's registration.
  const canDrag = onAssign !== undefined;
  useEffect(() => {
    const el = ref.current;
    if (!el || !canDrag) return;
    return draggable({
      element: el,
      getInitialData: () => ({ activityId: item.activityId }),
      onDragStart: () => setDragging(true),
      onDrop: () => setDragging(false),
    });
  }, [item.activityId, canDrag]);

  return (
    <div
      ref={ref}
      data-testid="rack-card"
      data-blstop=""
      // Cursor follows the registration, matching ActivityCard's own
      // `!readOnly && "cursor-grab"`: a grab cursor over a card that cannot be
      // picked up is the same false promise the hidden controls exist to avoid.
      className={cn(canDrag && "cursor-grab", "rounded-lg transition-opacity duration-200")}
      // eslint-disable-next-line no-restricted-syntax -- 208px card width (same computed-geometry pattern as Column.tsx's DAY_COLUMN_WIDTH_PX), touch-action, and the per-frame drag opacity pragmatic-drag-and-drop drives (same as ActivityCard's)
      style={{ flex: "0 0 208px", touchAction: "none", opacity: dragging ? 0.5 : 1 }}
    >
      <Card className="flex h-full flex-col gap-2 rounded-lg p-3">
        <div>
          <div
            className="font-semibold text-ink"
            // eslint-disable-next-line no-restricted-syntax -- 13.5px/1.3 card title sits between Tailwind's text-sm (13px) and text-base (14px)
            style={{ fontSize: "13.5px", lineHeight: 1.3 }}
          >
            {item.title}
          </div>
          {item.area !== null ? (
            <div
              className="text-xs text-slate"
              // eslint-disable-next-line no-restricted-syntax -- 2px offset is below Tailwind's spacing floor (mt-0.5 = 2px exists, but pairs with the 12px line box above only by coincidence)
              style={{ marginTop: "2px" }}
            >
              {item.area}
            </div>
          ) : null}
          {/* The design's compact card treatment is "title, area, 'No time
              yet'" — the third line is what makes a parked stop legible as
              unscheduled at a glance. */}
          <div
            className="text-xs text-slate"
            // eslint-disable-next-line no-restricted-syntax -- 2px offset is below Tailwind's spacing floor, matching the area line above
            style={{ marginTop: "2px" }}
          >
            {item.timeWindow === null
              ? "No time yet"
              : toClockRange(item.timeWindow.start, item.timeWindow.end)}
          </div>
        </div>
        {/* Provenance is not modelled: no field records who parked a
            stop or which day it came from, so the line describes
            what it will say rather than fabricating either. */}
        <Preview id="rack-provenance" size="compact">
          <div
            className="text-slate"
            // eslint-disable-next-line no-restricted-syntax -- 11.5px provenance line is below Tailwind's text-xs (12px) floor
            style={{ fontSize: "11.5px" }}
          >
            Who parked it · which day it came from
          </div>
        </Preview>
        {/* Accessible name is the bare "Add to day"; the first
            option's "Add to day…" is the visible placeholder. The
            select stays pinned to `value=""` so it reads as an
            action, not a stored choice — assigning moves the stop
            out of the rack entirely. */}
        {onAssign !== undefined && (
        <NativeSelect
          aria-label="Add to day"
          className="mt-auto w-full"
          value=""
          onChange={(event) => {
            const dayId = event.target.value;
            if (dayId !== "") onAssign(item.activityId, dayId);
          }}
        >
          <option value="">Add to day…</option>
          {dayOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </NativeSelect>
        )}
      </Card>
    </div>
  );
}
