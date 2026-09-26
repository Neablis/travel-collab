"use client";

import { type PointerEvent as ReactPointerEvent, type MouseEvent as ReactMouseEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { type ActivityTag, type ActivityView, TimeWindow } from "@tc/contracts";
import { useTimeFormat } from "@/components/account/PreferencesProvider";
import type { Overlap } from "@/components/lenses/overlapData";
import { DataText } from "@/components/ui/data-text";
import { cn } from "@/lib/cn";
import type { AccentFamily } from "@/lib/dayAccent";
import { toClockRange, toMinutes } from "@/lib/time";
import { RiverBlock } from "./RiverBlock";
import {
  doubleClickWindow,
  dropWindow,
  fromTimeWindow,
  type MinuteWindow,
  resizeEnd,
  RIVER_DRAG_THRESHOLD_PX,
  sketchCreates,
  sketchWindow,
  stopMinutes,
  toTimeWindow,
} from "./riverGestures";
import { layoutRiver, minuteToPx, riverTicks, tickLabel, type RiverAxis } from "./riverLayout";

/**
 * What a stop's drag carries (RiverBlock, ActivityCard, the rack): its id, and
 * — from a river block only — how far down the block it was picked up, so the
 * drop lands the block's top where the outline shows it rather than jumping
 * it down by the height it was held at (`dropWindow`).
 */
function grabOffsetOf(data: Record<string | symbol, unknown>): number {
  return typeof data.grabOffsetPx === "number" ? data.grabOffsetPx : 0;
}

/**
 * The gestures a river offers an editor (SPEC §36.9b, M29 part 3). Withheld —
 * all of it — on a read-only river, which then offers none: no crosshair, no
 * sketch, no grip, and no drop target that would preview a move the provider
 * is about to refuse (ADR-031).
 */
export type RiverGestures = {
  /** Double-click or a sketch: open the add sheet for this day at this window. */
  onCreateAt: (window: TimeWindow) => void;
  /** A block's bottom edge was dragged: the stop now ends here. */
  onResize: (activityId: string, window: TimeWindow) => void;
  /**
   * Whether a stop being dragged may land at a time on this river. A stop off
   * the rack may not — it keeps the rack's own semantics (`rackDropWindow`) —
   * so for one the river is not a drop target and the drop falls to the column.
   */
  canPlace: (activityId: string) => boolean;
};

/** The outline a gesture draws: a sketch, or where a dragged stop would land. */
type Ghost = { kind: "sketch" | "drop"; window: MinuteWindow };

/**
 * One day's river: the hour ticks down a 32px gutter and the day's timed stops
 * drawn to scale beside them (SPEC §36.9b, M29 part 2), and — for an editor —
 * the four gestures on it (part 3): double-click empty time, drag across empty
 * time, drag a block's bottom edge, and drop a dragged stop at a time.
 *
 * The ticks repeat in every column, as the design draws them, rather than
 * living in one sticky gutter: the row scrolls sideways past fourteen days,
 * and a column that has scrolled away from a shared gutter would be a column
 * with no hours on it.
 *
 * **Three gestures, three kinds of pointer, no two of them fighting.** A block
 * is a pragmatic-drag-and-drop `draggable`, which is NATIVE HTML5 drag: press
 * on its body and move, and the browser starts a drag. Its grip and the empty
 * river use POINTER events instead, and neither is inside a draggable where it
 * would matter: empty river is no block at all, and the grip tells its block
 * to refuse the drag (`canDrag`) for as long as it is held.
 */
export function DayRiver({
  title,
  dayId,
  axis,
  activityIds,
  activities,
  accent,
  conflictIds,
  overlaps,
  overlapPartners,
  currency,
  onEditActivity,
  onRemoveActivity,
  onDismissOverlap,
  focusedTag,
  onToggleTag,
  readOnly,
  gestures,
}: {
  title: string;
  dayId: string;
  axis: RiverAxis;
  activityIds: readonly string[];
  activities: Record<string, ActivityView>;
  accent: AccentFamily;
  conflictIds: ReadonlySet<string>;
  overlaps: ReadonlyMap<string, Overlap>;
  overlapPartners: ReadonlyMap<string, readonly string[]>;
  currency: string;
  onEditActivity: (activityId: string) => void;
  onRemoveActivity: (activityId: string) => void;
  onDismissOverlap: (conflictId: string) => void;
  focusedTag: ActivityTag | null;
  onToggleTag?: (tag: ActivityTag) => void;
  readOnly: boolean;
  /** Absent on a read-only river, and then there are none. */
  gestures?: RiverGestures;
}) {
  const clock = useTimeFormat();
  const live = readOnly ? undefined : gestures;
  const riverRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [ghost, setGhost] = useState<Ghost | null>(null);
  // The block whose bottom edge is being dragged, and where its end is now.
  const [resizing, setResizing] = useState<{ activityId: string; end: number } | null>(null);
  // When the last sketch ended. The release of a sketch is also a click, and a
  // click soon after another is a double-click — which must not ALSO open the
  // add sheet at the release point.
  const sketchEndedAt = useRef(-Infinity);

  const timed = useMemo(
    () =>
      activityIds.flatMap((id) => {
        const activity = activities[id];
        if (!activity?.timeWindow) return [];
        // A block being resized is drawn at its new length while the grip is
        // held, laid out with everything else — so it takes the lane it will
        // have when it lands, and its own time line reads the new end.
        const window =
          resizing?.activityId === id ? toTimeWindow({ start: toMinutes(activity.timeWindow.start), end: resizing.end }) : activity.timeWindow;
        return [{ activity, window }];
      }),
    [activityIds, activities, resizing],
  );
  const placements = useMemo(
    () => new Map(layoutRiver(axis, timed.map(({ activity, window }) => ({ id: activity.activityId, window }))).map((p) => [p.id, p])),
    [axis, timed],
  );
  // **Drawn by time, so read by time.** `activityIds` is the day's list order,
  // which a drop at a new time does not have to follow; rendered in it, Tab
  // and a screen reader would walk the day out of the order it is drawn in.
  // Start first, then lane, so two stops that start together read left to
  // right.
  const ordered = useMemo(
    () =>
      [...timed].sort(
        (a, b) =>
          toMinutes(a.window.start) - toMinutes(b.window.start) ||
          (placements.get(a.activity.activityId)?.lane ?? 0) - (placements.get(b.activity.activityId)?.lane ?? 0),
      ),
    [timed, placements],
  );

  /** A pointer's y, from the river's top edge. */
  const yOf = useCallback((clientY: number) => clientY - (riverRef.current?.getBoundingClientRect().top ?? 0), []);
  /** Empty time: the river itself or the list under the blocks, never a block. */
  const isEmptyTime = (target: EventTarget) => target === riverRef.current || target === listRef.current;

  // ---- drop at a time --------------------------------------------------
  // The river is a drop target of its own, inside its column's. Blocks are not
  // targets (RiverBlock), so anything dragged over the river — over a block or
  // not — finds this one first, and its data carries the window the outline
  // shows. `getData` is re-run on every drag update, so the data at the moment
  // of release is the window drawn at that moment.
  const latest = useRef({ axis, activities, live, dayId });
  useEffect(() => {
    latest.current = { axis, activities, live, dayId };
  }, [axis, activities, live, dayId]);

  const placing = live !== undefined;
  useEffect(() => {
    const element = riverRef.current;
    if (!element || !placing) return;
    const windowFor = (clientY: number, source: Record<string | symbol, unknown>) => {
      const { axis: currentAxis, activities: all } = latest.current;
      const id = source.activityId;
      const minutes = stopMinutes(typeof id === "string" ? (all[id]?.timeWindow ?? null) : null);
      return dropWindow(currentAxis, clientY - element.getBoundingClientRect().top, grabOffsetOf(source), minutes);
    };
    const show = ({ self }: { self: { data: Record<string | symbol, unknown> } }) => {
      const drawn = TimeWindow.safeParse(self.data.riverWindow);
      if (!drawn.success) return;
      const next = fromTimeWindow(drawn.data);
      setGhost((prev) =>
        prev?.kind === "drop" && prev.window.start === next.start && prev.window.end === next.end ? prev : { kind: "drop", window: next },
      );
    };
    return dropTargetForElements({
      element,
      canDrop: ({ source }) => {
        const id = source.data.activityId;
        return typeof id === "string" && latest.current.live?.canPlace(id) === true;
      },
      getData: ({ input, source }) => ({
        dayId: latest.current.dayId,
        riverWindow: toTimeWindow(windowFor(input.clientY, source.data)),
      }),
      onDragEnter: show,
      onDrag: show,
      onDragLeave: () => setGhost(null),
      onDrop: () => setGhost(null),
    });
  }, [placing]);

  // ---- one press, followed to its end ---------------------------------
  // The sketch and the resize both follow a press on `window` until it ends.
  // **It can end without a pointerup reaching us**: the button released over
  // another window or an OS dialog, the tab switched away mid-drag, or the
  // river unmounted (a day deleted, the view switched) while the button was
  // down. Each of those ends the gesture WITHOUT committing it — a stop is
  // never created or stretched by a release nobody saw. The pointerup is the
  // only commit.
  const endGesture = useRef<(() => void) | null>(null);
  useEffect(() => () => endGesture.current?.(), []);

  function follow(onMove: (ev: PointerEvent) => void, onEnd: (commit: boolean) => void) {
    endGesture.current?.();
    const move = (ev: PointerEvent) => {
      // A move with no button down is a release we never heard.
      if (ev.buttons === 0) finish(false);
      else onMove(ev);
    };
    const up = () => finish(true);
    const cancel = () => finish(false);
    const escape = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") finish(false);
    };
    function finish(commit: boolean) {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("keydown", escape);
      endGesture.current = null;
      onEnd(commit);
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("blur", cancel);
    window.addEventListener("keydown", escape);
    endGesture.current = cancel;
  }

  // ---- sketch: drag across empty time ----------------------------------
  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (!live || e.button !== 0 || !isEmptyTime(e.target)) return;
    // No text selection, and no focus theft from whatever the reader was in.
    e.preventDefault();
    const pressY = yOf(e.clientY);
    const pressClientY = e.clientY;
    let sketch: MinuteWindow | null = null;

    follow(
      (ev) => {
        if (sketch === null && Math.abs(ev.clientY - pressClientY) < RIVER_DRAG_THRESHOLD_PX) return;
        sketch = sketchWindow(axis, pressY, yOf(ev.clientY));
        setGhost({ kind: "sketch", window: sketch });
      },
      (commit) => {
        setGhost(null);
        if (sketch === null) return;
        sketchEndedAt.current = performance.now();
        if (commit && sketchCreates(sketch)) live.onCreateAt(toTimeWindow(sketch));
      },
    );
  }

  // ---- double-click empty time -----------------------------------------
  function onDoubleClick(e: ReactMouseEvent<HTMLDivElement>) {
    if (!live || !isEmptyTime(e.target)) return;
    // The OS double-click interval is ~500ms; a sketch released inside it is
    // not the second click of anything the reader meant.
    if (performance.now() - sketchEndedAt.current < 500) return;
    live.onCreateAt(toTimeWindow(doubleClickWindow(axis, yOf(e.clientY))));
  }

  // ---- resize: drag a block's bottom edge ------------------------------
  function startResize(activityId: string, stored: TimeWindow) {
    if (!live) return;
    const start = toMinutes(stored.start);
    let end = toMinutes(stored.end);
    follow(
      (ev) => {
        end = resizeEnd(axis, start, yOf(ev.clientY));
        setResizing({ activityId, end });
      },
      (commit) => {
        setResizing(null);
        const next = toTimeWindow({ start, end });
        if (commit && next.end !== stored.end) live.onResize(activityId, next);
      },
    );
  }

  return (
    <div
      ref={riverRef}
      data-testid="day-river"
      className={cn("relative", live && "cursor-crosshair select-none")}
      onPointerDown={live ? onPointerDown : undefined}
      onDoubleClick={live ? onDoubleClick : undefined}
      // eslint-disable-next-line no-restricted-syntax -- the river's height is the shared axis's length at 44px an hour (riverLayout.ts), a computed number with no token equivalent
      style={{ height: axis.heightPx }}
    >
      {riverTicks(axis).map((tick) => (
        <div
          key={tick.minute}
          aria-hidden
          className="pointer-events-none absolute inset-x-0"
          // eslint-disable-next-line no-restricted-syntax -- a tick's offset is its hour on the shared axis, computed geometry
          style={{ top: tick.topPx }}
        >
          <DataText size="xs" className="absolute left-0 w-8 -translate-y-1/2 text-right leading-none">
            {tickLabel(tick.minute, clock)}
          </DataText>
          <div className="ml-9.5 border-t border-hairline" />
        </div>
      ))}
      {/* 38px in: the 32px gutter and the 6px between it and the rule, the
          design's own numbers. A list, because a day's stops are one. */}
      <ul ref={listRef} aria-label={`${title} timeline`} className="absolute inset-y-0 right-0 left-9.5 m-0 list-none p-0">
        {ordered.map(({ activity, window }) => {
          const placement = placements.get(activity.activityId);
          if (placement === undefined) return null;
          const id = activity.activityId;
          return (
            <RiverBlock
              key={id}
              activity={activity}
              window={window}
              placement={placement}
              accent={accent}
              hasConflict={conflictIds.has(id)}
              overlap={overlaps.get(id) ?? null}
              overlapPartners={overlapPartners.get(id) ?? []}
              currency={currency}
              onEdit={() => onEditActivity(id)}
              onRemove={() => onRemoveActivity(id)}
              onDismissOverlap={onDismissOverlap}
              focusedTag={focusedTag}
              onToggleTag={onToggleTag}
              readOnly={readOnly}
              // The stop's STORED window, not the one being previewed: a
              // resize always runs from where the stop really starts and ends.
              onResizeStart={live && activity.timeWindow ? () => startResize(id, activity.timeWindow!) : undefined}
            />
          );
        })}
      </ul>
      {ghost && <RiverGhost ghost={ghost} axis={axis} clock={clock} />}
    </div>
  );
}

/**
 * The outline a gesture draws, over the blocks and across the full width a
 * block could take: a sketch in the brand tint (the design's ghost), a drop as
 * the brand edge alone so the blocks it lands among still show through it. It
 * says the window it stands for in the reader's clock.
 */
function RiverGhost({ ghost, axis, clock }: { ghost: Ghost; axis: RiverAxis; clock: ReturnType<typeof useTimeFormat> }) {
  const { start, end } = toTimeWindow(ghost.window);
  return (
    <div
      aria-hidden
      data-testid="river-ghost"
      data-ghost={ghost.kind}
      className={cn(
        "pointer-events-none absolute right-0 left-9.5 z-10 overflow-hidden rounded-md border-2 border-brand px-2 py-1",
        ghost.kind === "sketch" ? "bg-brand-tint" : "bg-transparent",
      )}
      // eslint-disable-next-line no-restricted-syntax -- the outline's top and height are its window on the shared axis, computed geometry
      style={{
        top: minuteToPx(axis, ghost.window.start),
        height: Math.max(10, minuteToPx({ t0: 0 }, ghost.window.end - ghost.window.start)),
      }}
    >
      <DataText
        size="xs"
        className={cn("inline-block max-w-full truncate rounded-sm font-semibold text-brand-pressed", ghost.kind === "drop" && "bg-surface px-1")}
      >
        {toClockRange(start, end, clock)}
      </DataText>
    </div>
  );
}
