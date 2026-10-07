"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { draggable, dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { ChevronDown, ChevronRight, Pencil, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toClockRange } from "@/lib/time";
import { useTimeFormat } from "@/components/account/PreferencesProvider";
import { usePeople } from "@/components/pages/people";
import { displayNameFor } from "@/lib/displayName";
import { Card } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/native-select";
import { cn } from "@/lib/cn";
import { RACK_LIFT_OVER_EVENT } from "@/lib/touchLift";

export type RackItem = {
  activityId: string;
  title: string;
  area: string | null;
  // A parked stop usually has no time (unscheduling strips it), but a stop
  // created unscheduled can still carry one — so the compact card shows the
  // real window when there is one and the design's "No time yet" when there
  // isn't, rather than asserting "No time yet" over a time the trip holds.
  timeWindow: { start: string; end: string } | null;
  // M13 link 5. Who parked this stop, or null. The rack's provenance line
  // shows it; the half that is still missing (which day it came from) is a
  // candidate, not a field.
  bookedBy: string | null;
  /**
   * The day this stop is ON, for an untimed stop that has one; `null` for a
   * parked stop with no day. Mitchell, PR #269's preview: *"Maybe anything
   * without a time is in unscheduled? … not sure how we should show the date
   * ownership still in the unscheduled rack"* — this is that ownership: `tag`
   * on the card itself ("Day 3"), so it still says whose it is while dragged,
   * and `heading` ("Day 3 · Kyoto") naming the day's group to assistive tech.
   * `heading` is not drawn: *"Drop the header, i can see the Day 3 in the card
   * already"* (Mitchell, PR #269 preview).
   */
  day: { dayId: string; tag: string; heading: string } | null;
  /** The stop's kind badge (`board/activityKind`'s `kindBadge`), or null for a planned stop. */
  badge: { label: string; variant: "warning" | "info" | "neutral" } | null;
};

/** The rack's cards in the order they are drawn: day-less first, then each day's, in trip order. */
type RackGroup = { day: RackItem["day"]; items: RackItem[] };

function groupByDay(items: RackItem[]): RackGroup[] {
  const groups: RackGroup[] = [];
  for (const item of items) {
    const key = item.day?.dayId ?? null;
    const group = groups.find((g) => (g.day?.dayId ?? null) === key);
    if (group) group.items.push(item);
    else groups.push({ day: item.day, items: [item] });
  }
  // Day-less first whatever order the caller used; the days keep theirs.
  return [...groups.filter((g) => g.day === null), ...groups.filter((g) => g.day !== null)];
}

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
//
// **It holds every stop with no time, not only every stop with no day** (PR
// #269). Mitchell, on the board's "Any time" shelf: *"Right now they stack up
// and push everything down in the ui making all the other days worse"*. An
// untimed stop keeps its day in the trip — the assistant, exports and widgets
// still read "any time on Day 3" — and only where it is DRAWN moved: here,
// under its day's heading, after the stops that have no day at all.
/**
 * The Unscheduled drawer pinned to the bottom of the board: the stops with no
 * day, then each day's untimed stops under that day's heading. A drop target
 * (a drop unschedules) and, for an editor, a source of draggable cards.
 */
export function UnscheduledRack({
  items,
  dayOptions,
  open,
  onToggle,
  onAssign,
  onEdit,
  onRemove,
  reveal = null,
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
  /** Opens a card's stop in the editor. Absent on a read-only board, like `onAssign`. */
  onEdit?: (activityId: string) => void;
  /** Removes a card's stop from the trip. Absent on a read-only board, like `onAssign`. */
  onRemove?: (activityId: string) => void;
  /**
   * A day column's "N Unscheduled" chip asking for its day's group: scrolled
   * into view and focused once the drawer is open. `seq` changes on every
   * click, so a second click on the same chip reveals it again.
   */
  reveal?: { dayId: string; seq: number } | null;
}) {
  const ref = useRef<HTMLElement>(null);
  const [isOver, setIsOver] = useState(false);
  const Caret = open ? ChevronDown : ChevronRight;
  // A "No day" section even with no day-less stops in it, whenever a day's
  // untimed stops are here: it is the one place a drop takes a stop off its
  // day (decision 3C), so it has to exist to be dropped on.
  const byDay = groupByDay(items);
  const groups: RackGroup[] =
    byDay.length > 0 && byDay[0]!.day !== null ? [{ day: null, items: [] }, ...byDay] : byDay;

  // The reveal lands after the drawer has rendered open — the chip's click
  // opens it and names the day in the same update, so the group is not in the
  // DOM until this effect runs. Focus rather than only scroll, so a keyboard
  // reader who pressed the chip is taken to the stops it counted.
  // `scrollIntoView` is guarded because jsdom does not implement it.
  useEffect(() => {
    if (!open || reveal === null) return;
    const group = ref.current?.querySelector<HTMLElement>(`[data-rack-day="${reveal.dayId}"]`);
    if (!group) return;
    group.scrollIntoView?.({ block: "nearest", inline: "start", behavior: "smooth" });
    group.focus({ preventScroll: true });
  }, [open, reveal]);

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

  // A block lifted by a finger on the river (M29 phone) is no native drag, so
  // pdnd above never sees it; the river tells the rack instead, when the
  // finger is over it (DayRiver, `RACK_LIFT_OVER_EVENT`).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onLiftOver = (event: Event) => setIsOver((event as CustomEvent<boolean>).detail);
    el.addEventListener(RACK_LIFT_OVER_EVENT, onLiftOver);
    return () => el.removeEventListener(RACK_LIFT_OVER_EVENT, onLiftOver);
  }, []);

  return (
    <section
      ref={ref}
      data-testid="unscheduled-rack"
      data-bldrop="1"
      // What a finger carrying a river block looks for under it (DayRiver's
      // touch lift): letting go here unschedules, as a mouse drop does.
      data-rack-drop
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
        {/* The count is every card the drawer holds — day-less and untimed
            alike — because it is the number of cards you will find when you
            open it. The hint says both halves for the same reason (it said "no
            day yet" until PR #269 moved untimed stops in here). */}
        <span className="text-xs font-normal normal-case text-slate">Stops with no day or no time yet</span>
      </Button>
      {/* Collapsed means *not rendered*, not merely hidden: nothing parked
          should be reachable by keyboard or by a text query while the drawer
          is shut. */}
      {open ? (
        <div
          // `items-end`: the No day group keeps its label and the day groups
          // have none, so the card rows line up along the bottom.
          className="flex items-end gap-2.5 overflow-x-auto"
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
            groups.map((group) =>
              group.day === null ? (
                <NoDayGroup key="no-day" editable={onAssign !== undefined}>
                  {group.items.map((item) => (
                    <RackCard key={item.activityId} item={item} dayOptions={dayOptions} onAssign={onAssign} onEdit={onEdit} onRemove={onRemove} />
                  ))}
                </NoDayGroup>
              ) : (
                // A day's untimed stops. No visible heading — each card wears
                // its day's tag — but a named group, so a screen reader hears
                // whose they are once, and the target a day column's
                // "N Unscheduled" chip reveals (`data-rack-day`).
                // `tabIndex={-1}`: focusable by that reveal, not a Tab stop.
                <div
                  key={group.day.dayId}
                  role="group"
                  aria-label={group.day.heading}
                  data-rack-day={group.day.dayId}
                  tabIndex={-1}
                  className="flex shrink-0 gap-2.5 rounded-lg focus-visible:outline-2 focus-visible:outline-brand"
                >
                  {group.items.map((item) => (
                    <RackCard key={item.activityId} item={item} dayOptions={dayOptions} onAssign={onAssign} onEdit={onEdit} onRemove={onRemove} />
                  ))}
                </div>
              ),
            )
          )}
        </div>
      ) : null}
    </section>
  );
}

/**
 * The rack's "No day" section: the stops with no day at all, and the drop
 * target that makes a stop one of them. Mitchell, PR #269 (decision 3C): a
 * stop kept "any time on Day 3" needs a way to lose its day, and a drop
 * anywhere else on the rack deliberately does nothing to such a stop (see
 * `resolveDrop`), so this section carries `noDay` and the resolver honours
 * it. Empty, it says what a drop does — only on an editable board, where a
 * drop can happen.
 */
function NoDayGroup({ editable, children }: { editable: boolean; children: ReactNode[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [isOver, setIsOver] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || !editable) return;
    return dropTargetForElements({
      element: el,
      getData: () => ({ rack: true, noDay: true }),
      onDragEnter: () => setIsOver(true),
      onDragLeave: () => setIsOver(false),
      onDrop: () => setIsOver(false),
    });
  }, [editable]);
  if (children.length === 0 && !editable) return null;
  return (
    <div
      ref={ref}
      role="group"
      aria-label="No day"
      className={cn("flex shrink-0 flex-col gap-1 rounded-lg transition-colors", isOver && "bg-brand-tint")}
    >
      <span className="text-xs font-semibold text-slate">No day</span>
      <div className="flex flex-1 gap-2.5">
        {children.length > 0 ? (
          children
        ) : (
          <p className="m-0 flex items-center rounded-lg border border-dashed border-border-strong px-3 text-xs text-slate">
            Drop a stop here to take it off its day
          </p>
        )}
      </div>
    </div>
  );
}

function RackCard({
  item,
  dayOptions,
  onAssign,
  onEdit,
  onRemove,
}: {
  item: RackItem;
  dayOptions: { value: string; label: string }[];
  /**
   * Absent on a read-only board (a viewer's, or the demo's — ADR-031): the
   * parked ideas are part of the plan and stay visible; the picker that moves
   * one onto a day is a command, and goes.
   */
  onAssign?: (activityId: string, dayId: string) => void;
  onEdit?: (activityId: string) => void;
  onRemove?: (activityId: string) => void;
}) {
  const clock = useTimeFormat();
  const people = usePeople();
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
          {(item.day !== null || item.badge !== null || onEdit !== undefined || onRemove !== undefined) && (
            <div className="mb-1 flex items-start gap-1">
              {/* `flex-wrap`, so two badges beside a phone's two 44px controls
                  stack inside the 208px card instead of running out of it. */}
              <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
                {/* The day an untimed stop is on, on the card itself as well as
                    over its group: a card lifted out of the group for a drag
                    has left its heading behind (PR #269). */}
                {item.day !== null && <Badge variant="neutral">{item.day.tag}</Badge>}
                {/* The kind badge the board's card wore ("To book", "Maybe",
                    "Train"). A pending stop is very often an untimed one, and
                    since PR #269 the rack is where an untimed stop is drawn, so
                    without it "To book" would have no surface on Plan at all. */}
                {item.badge !== null && (
                  <Badge variant={item.badge.variant} data-testid={`kind-badge-${item.activityId}`}>
                    {item.badge.label}
                  </Badge>
                )}
              </span>
              {/* Edit and Remove, as the board's card had them. An untimed
                  stop was edited from its card on the "Any time" shelf; drawn
                  here now, it keeps the controls rather than becoming a stop
                  you can only drag. Withheld on a read-only board. */}
              <span className="flex shrink-0 gap-0.5">
                {onEdit !== undefined && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-auto"
                    onClick={() => onEdit(item.activityId)}
                    aria-label={`Edit ${item.title}`}
                  >
                    <Pencil className="size-3.5" aria-hidden />
                  </Button>
                )}
                {onRemove !== undefined && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-auto"
                    onClick={() => onRemove(item.activityId)}
                    aria-label={`Remove ${item.title}`}
                  >
                    <X className="size-3.5" aria-hidden />
                  </Button>
                )}
              </span>
            </div>
          )}
          <div
            className="font-semibold text-ink"
            // eslint-disable-next-line no-restricted-syntax -- 13.5px/1.3 card title sits between Tailwind's text-sm (13px) and text-base (14px)
            style={{ fontSize: "13.5px", lineHeight: 1.3 }}
          >
            {item.title}
          </div>
          {item.area !== null ? (
            <div
              // `truncate`: a leg's area is both its ends ("Taipei → Tainan"),
              // and a long pair ellipsises rather than growing the card.
              className="truncate text-xs text-slate"
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
              : toClockRange(item.timeWindow.start, item.timeWindow.end, clock)}
          </div>
        </div>
        {/* M13 link 5 modelled HALF of what this line was drawn to say.
            `bookedBy` records who parked the stop, so that half is real now.
            **Which day it came from is still not modelled** — a backlog stop
            keeps no record of the day it was moved off — so the line shows the
            half that exists rather than fabricating the other, and the missing
            half is recorded in `docs/candidates.md` rather than left as a
            placeholder that reads as a promise. */}
        {item.bookedBy !== null && (
          <div
            className="text-slate"
            // eslint-disable-next-line no-restricted-syntax -- 11.5px provenance line is below Tailwind's text-xs (12px) floor
            style={{ fontSize: "11.5px" }}
          >
            {/* Named from the trip's members (M38 part 3; this printed the raw
                id). Before they land, or for someone who has left, the id's
                handle — never the id itself. */}
            Parked by {people?.[item.bookedBy] ?? displayNameFor({ userId: item.bookedBy })}
          </div>
        )}
        {/* Accessible name is the bare "Add to day"; the first
            option's "Add to day…" is the visible placeholder. The
            select stays pinned to `value=""` so it reads as an
            action, not a stored choice — assigning moves the stop
            out of the rack entirely. For a stop already on a day that
            holds for its own day too: assigning gives it a time, on
            whichever day was picked (TripBoardScreen's
            `assignFromRack`), which is what takes it off the rack. */}
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
