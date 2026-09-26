"use client";

import { type PointerEvent as ReactPointerEvent, type MouseEvent as ReactMouseEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { type ActivityTag, type ActivityView, TimeWindow } from "@tc/contracts";
import { useTimeFormat } from "@/components/account/PreferencesProvider";
import type { Overlap } from "@/components/lenses/overlapData";
import { DataText } from "@/components/ui/data-text";
import { cn } from "@/lib/cn";
import { RACK_LIFT_OVER_EVENT } from "@/lib/touchLift";
import type { AccentFamily } from "@/lib/dayAccent";
import { toClockRange, toMinutes } from "@/lib/time";
import { RiverBlock } from "./RiverBlock";
import {
  doubleClickWindow,
  edgeScrollDelta,
  fromTimeWindow,
  type MinuteWindow,
  placeWindow,
  resizeEnd,
  RIVER_DRAG_THRESHOLD_PX,
  RIVER_TOUCH_HOLD_MS,
  RIVER_TOUCH_SLOP_PX,
  sketchCreates,
  sketchWindow,
  toTimeWindow,
} from "./riverGestures";
import { layoutRiver, minuteToPx, riverTicks, tickLabel, type RiverAxis } from "./riverLayout";

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
   * A block lifted by touch (long-press, then drag — M29 phone) was let go
   * over a day's river: this stop, to that day, at that window. The window is
   * `placeWindow`'s, as for every drop on a river; a touch lift is not a
   * native drag, so it arrives here rather than through pdnd's monitor, and
   * Board routes it through the same `resolveDrop` → `place`.
   */
  onDropAt: (activityId: string, dayId: string, window: TimeWindow) => void;
  /** A block lifted by touch was let go over the unscheduled rack: park it, as a mouse drop there does. */
  onUnschedule: (activityId: string) => void;
};

/**
 * The event a touch lift sends to the river under the finger, carrying the
 * window its outline should show there, or `null` to clear it. An event, not
 * shared state, because on a tablet the finger can carry a block from one
 * day's river to another's, and the river that owns the gesture is not the
 * one that draws the outline.
 */
const LIFT_GHOST_EVENT = "tc-river-lift-ghost";

/**
 * The part of the screen a river can be seen in: below the sticky header
 * stack and above the rack and the phone's tab bar. Each of those publishes its
 * measured height as a px custom property (`TripHeader`'s
 * `--sticky-stack-height`, `TripBoardScreen`'s `--rack-height`, `PhoneTabBar`'s
 * `--phone-tab-bar-height`), inherited here; one that is absent reads as 0.
 */
function visibleBand(element: HTMLElement | null): { top: number; bottom: number } {
  const px = (name: string) => (element ? parseFloat(getComputedStyle(element).getPropertyValue(name)) || 0 : 0);
  return { top: px("--sticky-stack-height"), bottom: window.innerHeight - px("--rack-height") - px("--phone-tab-bar-height") };
}

/**
 * Where a finger carrying a block would let it go: the day river or the rack
 * under it, if the topmost thing there is one of them.
 */
type LiftTarget = { kind: "river"; element: HTMLElement; dayId: string; window: MinuteWindow } | { kind: "rack"; element: HTMLElement };

/**
 * What is under a point, for a touch lift. Topmost only, on purpose: over the
 * tab bar or the sticky header a finger is not over the river they cover, and
 * a release there drops nothing. The rack is a place to land, as it is for a
 * mouse. jsdom has no `elementFromPoint`.
 */
function landingAt(x: number, y: number): { river: HTMLElement; dayId: string } | { rack: HTMLElement } | null {
  if (typeof document.elementFromPoint !== "function") return null;
  const hit = document.elementFromPoint(x, y);
  const rack = hit?.closest<HTMLElement>("[data-rack-drop]");
  if (rack) return { rack };
  const river = hit?.closest<HTMLElement>("[data-river-day]");
  const dayId = river?.dataset.riverDay;
  return river && dayId ? { river, dayId } : null;
}

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
 *
 * **Under a finger the same four gestures start with a hold** (M29 phone,
 * Mitchell 2026-09-26: *"cards should get the river … keep functionality as
 * similar as possible"*). They apply to any touch pointer, whatever the screen
 * width, so a touch tablet's river gets them too:
 *
 * | Mouse | Touch |
 * |---|---|
 * | double-click empty time | hold empty time, let go: an hour from there |
 * | drag across empty time | hold empty time, then drag |
 * | drag the bottom-edge grip | drag the grip (a 44px target, no hold) |
 * | drag a block (native drag) | hold the block, then drag (to any river under the finger) |
 * | click a block | tap it |
 *
 * Until a hold fires the press is the browser's, so a swipe scrolls. After it
 * fires, a non-passive `touchmove` listener stops the page from scrolling under
 * the finger, and a held gesture near the top or bottom of the screen scrolls
 * the page itself instead (`edgeScrollDelta`).
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
  // The stop a finger has lifted off the river (a touch move in progress).
  const [lifted, setLifted] = useState<string | null>(null);
  // Whether a held touch gesture owns the finger. While it does, the page must
  // not scroll under it (the `touchmove` listener below).
  const touchHeld = useRef(false);
  // Set when a hold fires. The release of a held touch can still arrive as a
  // click on the block's edit button, and the reader asked to move the stop,
  // not open it.
  const swallowClick = useRef(false);
  // The kind of pointer that last pressed the river: a double-click that came
  // from two taps is not the mouse's double-click (a touch adds with a hold).
  const lastPointer = useRef<string>("mouse");

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
  const latest = useRef({ axis, activities, dayId });
  useEffect(() => {
    latest.current = { axis, activities, dayId };
  }, [axis, activities, dayId]);

  const placing = live !== undefined;
  useEffect(() => {
    const element = riverRef.current;
    if (!element || !placing) return;
    // Every drag source lands by the same rule — a block, a shelf card, a stop
    // off the rack (`placeWindow`).
    const windowFor = (clientY: number, source: Record<string | symbol, unknown>) =>
      placeWindow(latest.current.axis, clientY - element.getBoundingClientRect().top, source, latest.current.activities);
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
      canDrop: ({ source }) => typeof source.data.activityId === "string",
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

  // ---- touch: the outline a lift draws here, and the scroll it holds ----
  useEffect(() => {
    const element = riverRef.current;
    if (!element || !placing) return;
    const onLiftGhost = (event: Event) => {
      const drawn = (event as CustomEvent<MinuteWindow | null>).detail;
      setGhost(drawn === null ? null : { kind: "drop", window: drawn });
    };
    // Non-passive, and registered for as long as the river is editable rather
    // than when a hold fires: the browser decides whether a touch sequence can
    // be kept from scrolling when it starts, from the listeners there are then.
    // It cancels only while a hold owns the finger, so a swipe that never held
    // still scrolls exactly as it would without it.
    const onTouchMove = (event: TouchEvent) => {
      if (touchHeld.current && event.cancelable) event.preventDefault();
    };
    element.addEventListener(LIFT_GHOST_EVENT, onLiftGhost);
    element.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => {
      element.removeEventListener(LIFT_GHOST_EVENT, onLiftGhost);
      element.removeEventListener("touchmove", onTouchMove);
    };
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
  // A touch press waiting out its hold (`holdThen`), which unmounting drops.
  const pendingHold = useRef<(() => void) | null>(null);
  useEffect(
    () => () => {
      pendingHold.current?.();
      endGesture.current?.();
    },
    [],
  );

  /**
   * `scroll`: a touch gesture, which has taken the finger away from the page's
   * own scrolling, so the page scrolls while the finger is held near an edge.
   * The gesture is re-run on each of those frames with the finger where it
   * was, because the river moved under it.
   */
  function follow(onMove: (ev: PointerEvent) => void, onEnd: (commit: boolean) => void, { scroll = false } = {}) {
    endGesture.current?.();
    let last: PointerEvent | null = null;
    let frame = 0;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      const band = visibleBand(riverRef.current);
      const delta = last === null ? 0 : edgeScrollDelta(last.clientY, band.top, band.bottom);
      if (delta === 0 || last === null) return;
      window.scrollBy(0, delta);
      onMove(last);
    };
    if (scroll) frame = requestAnimationFrame(tick);
    const move = (ev: PointerEvent) => {
      // A move with no button down is a release we never heard.
      if (ev.buttons === 0) finish(false);
      else {
        last = ev;
        onMove(ev);
      }
    };
    const up = () => finish(true);
    const cancel = () => finish(false);
    const escape = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") finish(false);
    };
    function finish(commit: boolean) {
      cancelAnimationFrame(frame);
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

  // ---- touch: a press that has to be held first ------------------------
  /**
   * Runs `onHold` once a touch press has stayed within `RIVER_TOUCH_SLOP_PX`
   * of where it landed for `RIVER_TOUCH_HOLD_MS`. Lifting first is a tap and
   * moving first is a swipe; either drops the hold, and neither is prevented,
   * so a tap still reaches the block's edit button and a swipe still scrolls.
   */
  function holdThen(e: ReactPointerEvent, onHold: () => void) {
    pendingHold.current?.();
    const { clientX: x0, clientY: y0, pointerId } = e;
    const timer = window.setTimeout(() => {
      drop();
      touchHeld.current = true;
      swallowClick.current = true;
      onHold();
    }, RIVER_TOUCH_HOLD_MS);
    const move = (ev: PointerEvent) => {
      if (ev.pointerId === pointerId && Math.hypot(ev.clientX - x0, ev.clientY - y0) > RIVER_TOUCH_SLOP_PX) drop();
    };
    function drop() {
      window.clearTimeout(timer);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", drop);
      window.removeEventListener("pointercancel", drop);
      pendingHold.current = null;
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", drop);
    window.addEventListener("pointercancel", drop);
    pendingHold.current = drop;
  }

  // ---- sketch: drag across empty time ----------------------------------
  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    lastPointer.current = e.pointerType;
    // A new press, so any click still owed to the last hold is not coming.
    swallowClick.current = false;
    if (!live || e.button !== 0 || !isEmptyTime(e.target)) return;
    if (e.pointerType === "touch") {
      touchSketch(e);
      return;
    }
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

  /**
   * **Hold empty time, then let go or drag.** The touch river's one gesture
   * for both of the mouse's ways to add: once the hold fires, the outline of
   * the hour a double-click would add is drawn under the finger. Let go there
   * and that hour opens in the add sheet; drag, and the outline becomes a
   * sketch from the press to the finger, which opens with that start and
   * length (and, like the mouse's, nothing under half an hour).
   *
   * A hold rather than a double-tap: two taps are what a person does to a
   * list they are scrolling, a phone's browser already reads them as a zoom,
   * and the sketch needs the hold anyway, so one gesture covers both.
   */
  function touchSketch(e: ReactPointerEvent<HTMLDivElement>) {
    if (!live) return;
    const pressY = yOf(e.clientY);
    const pressClientY = e.clientY;
    holdThen(e, () => {
      const hour = doubleClickWindow(axis, pressY);
      let sketch: MinuteWindow | null = null;
      setGhost({ kind: "sketch", window: hour });
      follow(
        (ev) => {
          if (sketch === null && Math.abs(ev.clientY - pressClientY) < RIVER_DRAG_THRESHOLD_PX) return;
          sketch = sketchWindow(axis, pressY, yOf(ev.clientY));
          setGhost({ kind: "sketch", window: sketch });
        },
        (commit) => {
          touchHeld.current = false;
          setGhost(null);
          if (!commit) return;
          if (sketch === null) live.onCreateAt(toTimeWindow(hour));
          else if (sketchCreates(sketch)) live.onCreateAt(toTimeWindow(sketch));
        },
        { scroll: true },
      );
    });
  }

  // ---- double-click empty time -----------------------------------------
  function onDoubleClick(e: ReactMouseEvent<HTMLDivElement>) {
    if (!live || !isEmptyTime(e.target)) return;
    // Two taps are not the mouse's double-click: a touch adds with a hold
    // (`touchSketch`), and two quick taps are more often a scroll's stutter.
    if (lastPointer.current === "touch") return;
    // The OS double-click interval is ~500ms; a sketch released inside it is
    // not the second click of anything the reader meant.
    if (performance.now() - sketchEndedAt.current < 500) return;
    live.onCreateAt(toTimeWindow(doubleClickWindow(axis, yOf(e.clientY))));
  }

  // ---- resize: drag a block's bottom edge ------------------------------
  // `release` is the block's: it lets the block be dragged again, and it is
  // called on every way the resize ends, committed or not.
  //
  // Under a finger the grip needs no hold: it is its own 44px target with
  // `touch-action: none`, so it never starts a scroll. A tap on it, though, is
  // a tap on the block, and opens the editor as the rest of the block does.
  function startResize(activityId: string, stored: TimeWindow, release: () => void, press: { pointerType: string; clientY: number }) {
    lastPointer.current = press.pointerType;
    if (!live) {
      release();
      return;
    }
    const touch = press.pointerType === "touch";
    const start = toMinutes(stored.start);
    let end = toMinutes(stored.end);
    let moved = false;
    if (touch) touchHeld.current = true;
    follow(
      (ev) => {
        if (!moved && Math.abs(ev.clientY - press.clientY) < RIVER_DRAG_THRESHOLD_PX) return;
        moved = true;
        end = resizeEnd(axis, start, yOf(ev.clientY));
        setResizing({ activityId, end });
      },
      (commit) => {
        touchHeld.current = false;
        release();
        setResizing(null);
        if (commit && touch && !moved) {
          onEditActivity(activityId);
          return;
        }
        const next = toTimeWindow({ start, end });
        if (commit && next.end !== stored.end) live.onResize(activityId, next);
      },
      { scroll: touch },
    );
  }

  // ---- touch: hold a block, then carry it ------------------------------
  /**
   * The touch river's way to move a stop to a time: hold the block until it
   * lifts, then carry it. The outline is drawn on whichever river is under the
   * finger (one on a phone, any day's on a touch tablet), at the time its top
   * would land, and letting go there is the same `place` a mouse drop is.
   * Letting go over the unscheduled rack parks it, as a mouse drop there does
   * (the rack lights up while the finger is over it); letting go anywhere else
   * (the tab bar, the header) puts it back. On a phone, a different DAY is the
   * editor's Day field: one day is on screen at a time.
   */
  function startLift(activityId: string, e: ReactPointerEvent<HTMLElement>) {
    lastPointer.current = e.pointerType;
    swallowClick.current = false;
    if (!live || e.pointerType !== "touch") return;
    const grab = e.clientY - e.currentTarget.getBoundingClientRect().top;
    // What a native drag of this block would carry (RiverBlock), so the
    // window is `placeWindow`'s, the one rule for every drop on a river.
    const source = { activityId, grabOffsetPx: grab };
    const stops = activities;
    const { clientX: x0, clientY: y0 } = e;
    holdThen(e, () => {
      setLifted(activityId);
      let target: LiftTarget | null = null;
      // Tells a river what outline to draw, or the rack whether to light up.
      const show = (at: LiftTarget, on: boolean) =>
        at.kind === "river"
          ? at.element.dispatchEvent(new CustomEvent<MinuteWindow | null>(LIFT_GHOST_EVENT, { detail: on ? at.window : null }))
          : at.element.dispatchEvent(new CustomEvent<boolean>(RACK_LIFT_OVER_EVENT, { detail: on }));
      const over = (x: number, y: number) => {
        const at = landingAt(x, y);
        const next: LiftTarget | null =
          at === null
            ? null
            : "rack" in at
              ? { kind: "rack", element: at.rack }
              : { kind: "river", element: at.river, dayId: at.dayId, window: placeWindow(axis, y - at.river.getBoundingClientRect().top, source, stops) };
        if (target !== null && target.element !== next?.element) show(target, false);
        if (next !== null) show(next, true);
        target = next;
      };
      over(x0, y0);
      follow(
        (ev) => over(ev.clientX, ev.clientY),
        (commit) => {
          touchHeld.current = false;
          setLifted(null);
          const landed: LiftTarget | null = target;
          if (landed === null) return;
          show(landed, false);
          if (!commit) return;
          if (landed.kind === "rack") live.onUnschedule(activityId);
          else live.onDropAt(activityId, landed.dayId, toTimeWindow(landed.window));
        },
        { scroll: true },
      );
    });
  }

  return (
    <div
      ref={riverRef}
      data-testid="day-river"
      // What a touch lift looks for under the finger (`landingAt`): an editable
      // river, and which day it is. A read-only river is no place to land.
      data-river-day={live ? dayId : undefined}
      // `touch-manipulation`: pans both ways (a tablet's row scrolls sideways
      // from a river) and pinch-zooms, but no double-tap zoom to wait out.
      // `tc-no-callout`: a held finger gets no iOS callout (globals.css).
      className={cn("relative", live && "cursor-crosshair touch-manipulation select-none tc-no-callout")}
      onPointerDown={live ? onPointerDown : undefined}
      onDoubleClick={live ? onDoubleClick : undefined}
      // A held finger is a gesture here, never the browser's long-press menu.
      onContextMenu={live ? (e) => lastPointer.current === "touch" && e.preventDefault() : undefined}
      onClickCapture={
        live
          ? (e) => {
              if (!swallowClick.current) return;
              swallowClick.current = false;
              e.preventDefault();
              e.stopPropagation();
            }
          : undefined
      }
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
              onResizeStart={
                live && activity.timeWindow ? (release, press) => startResize(id, activity.timeWindow!, release, press) : undefined
              }
              onTouchPress={live ? (e) => startLift(id, e) : undefined}
              lifted={lifted === id}
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
