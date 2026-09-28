"use client";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Button } from "./button";
import { cn } from "../../lib/cn";

// **One grid of a trip's days, for every picker that picks them.** Mitchell,
// on the PR #269 preview, about the "Keep this day" dialog's day picker:
// *"This date selector should also support click to drag. I also think it
// should look more like the other date selector in a widget ... try to re-use
// components and see similiar functionality using the same style and code"*.
// The other selector is the notebook widget's `DaysFilter`, which had just
// grown click-and-drag. So its cell and its gesture moved here, and both
// pickers are now this grid with a different selection POLICY on top:
//
// - `DaysFilter` stores ONE contiguous range (`DateRangeRef`), so a drag is the
//   two-click range in one stroke.
// - `KeepDayDialog` keeps ANY SET of days ("any, not just ones in a row"), so a
//   drag PAINTS: started on an unselected day it selects the span it crosses,
//   started on a selected one it deselects it.
//
// The grid knows neither rule. It owns what the two share — the cell's look,
// `data-day-index`, and the pointer gesture (hit-test, live preview, one commit
// on release, the abandon rules, the post-drag click) — and asks the caller
// what a cell shows as pressed while a drag is under way and what a finished
// drag means.

/** A drag under way: the day it was pressed on and the day now under the pointer. */
export interface DayGridDrag {
  start: number;
  current: number;
}

/** The days between a drag's two ends, inclusive and in either direction. */
export function dragSpan(drag: DayGridDrag): { first: number; last: number } {
  return { first: Math.min(drag.start, drag.current), last: Math.max(drag.start, drag.current) };
}

/**
 * **A grid of a trip's days, each a toggle, that a pointer can drag across.**
 *
 * `pressed(index, drag)` is the caller's selection policy: with `drag` null it
 * is the stored selection; with a drag under way it is what the cell would be
 * if the pointer were released now. `onPick` is a click (or Enter/Space — the
 * cells are real buttons, so the keyboard needs nothing of its own);
 * `onDragCommit` is a release after the pointer reached another day. A press
 * that never leaves its day is a click and reaches `onPick` only.
 *
 * A day for which `selectable` is false is disabled and is never a drag end:
 * the pointer passing over it leaves the drag where it was.
 */
export function DayGrid({
  label,
  count,
  columns,
  selectable = () => true,
  pressed,
  onPick,
  onDragCommit,
  cell,
}: {
  /** The group's accessible name. */
  label: string;
  /** How many days; the cells are indexed `0 .. count - 1`, in trip order. */
  count: number;
  /**
   * A fixed count, not an `auto-fill` track: the arbitrary Tailwind value that
   * would spell one is refused by the colour wall (tokens only), and every
   * caller knows its own width.
   */
  columns: 2 | 3;
  selectable?: (index: number) => boolean;
  pressed: (index: number, drag: DayGridDrag | null) => boolean;
  onPick: (index: number) => void;
  onDragCommit: (drag: DayGridDrag) => void;
  /**
   * What a cell says: `title` on the first line (`Day 3`, `Day 3 · Kyoto`) and
   * `detail` under it, smaller and quieter (a date, a stop count). Each caller
   * keeps whatever context its question needs; the grid only lays it out.
   */
  cell: (index: number) => { key: string; title: ReactNode; detail: ReactNode };
}) {
  // Pointer Events, so mouse, finger and pen are one code path. The day under
  // the pointer is hit-tested with `elementFromPoint` rather than read from the
  // event's target, because a finger's pointer is implicitly captured by the
  // cell it landed on and every move reports THAT cell (the reason `DayRiver`'s
  // touch lift hit-tests too). Window listeners rather than `setPointerCapture`:
  // capturing retargets a mouse's click onto the capturing element, and a plain
  // click on a day has to keep landing on that day.
  const [drag, setDrag] = useState<DayGridDrag | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  // The click a finished drag's release produces. It is not a pick — the drag
  // already committed — so it is swallowed once, and the next press clears it
  // in case that click never came (released outside the grid).
  const swallowClick = useRef(false);
  const endGesture = useRef<(() => void) | null>(null);
  // Unmounting mid-drag (a popover closing, a dialog closing) abandons the
  // drag rather than committing it on a release the reader can no longer see
  // the days for, and leaves no listener behind.
  useEffect(() => () => endGesture.current?.(), []);

  const dayAt = (x: number, y: number): number | null => {
    if (typeof document.elementFromPoint !== "function") return null;
    const hit = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-day-index]");
    if (!hit || !gridRef.current?.contains(hit)) return null;
    const index = Number(hit.dataset.dayIndex);
    return index >= 0 && index < count && selectable(index) ? index : null;
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    swallowClick.current = false;
    if (e.button !== 0) return;
    const hit = (e.target as Element).closest<HTMLElement>("[data-day-index]");
    if (!hit) return;
    const start = Number(hit.dataset.dayIndex);
    if (!selectable(start)) return;
    endGesture.current?.();
    const { pointerId } = e;
    let current = start;
    let moved = false;

    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      // A mouse whose button came up somewhere this window never heard about.
      if (ev.pointerType === "mouse" && ev.buttons === 0) {
        finish(false);
        return;
      }
      const over = dayAt(ev.clientX, ev.clientY);
      if (over === null || over === current) return;
      current = over;
      moved = true;
      setDrag({ start, current });
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId === pointerId) finish(true);
    };
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
      setDrag(null);
      // A press that never left its day is a click, and `onPick` does with it
      // what it always did.
      if (!commit || !moved) return;
      swallowClick.current = true;
      onDragCommit({ start, current });
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("blur", cancel);
    window.addEventListener("keydown", escape);
    endGesture.current = cancel;
  };

  return (
    // `touch-none` so a finger drawn across the days selects them rather than
    // scrolling (the browser cancels a pointer it takes for a scroll);
    // `select-none` so a mouse drag does not also highlight the cells' text.
    <div
      ref={gridRef}
      role="group"
      aria-label={label}
      className={cn("grid touch-none select-none gap-1", columns === 2 ? "grid-cols-2" : "grid-cols-3")}
      onPointerDown={onPointerDown}
      onClickCapture={(e) => {
        if (!swallowClick.current) return;
        swallowClick.current = false;
        e.stopPropagation();
        e.preventDefault();
      }}
    >
      {Array.from({ length: count }, (_, index) => {
        const on = pressed(index, drag);
        const { key, title, detail } = cell(index);
        return (
          <Button
            key={key}
            variant={on ? "primary" : "secondary"}
            disabled={!selectable(index)}
            aria-pressed={on}
            data-day-index={index}
            // `h-auto` over the size's fixed `h-9`: a caller's title may wrap
            // (a city name has no length bound), and a grid item stretches, so
            // a two-line cell makes its row taller rather than spilling.
            //
            // **The same 1px border on and off, so picking never reflows.**
            // Mitchell, PR #269 preview: *"The border in the date picker causes
            // the squares to grow and the full modal to grow and shrink as you
            // select dates"*. `secondary` draws `border`, `primary` draws none,
            // and with `h-auto` a cell is exactly its content plus its border —
            // so a selected cell was 2px shorter, a row of them shrank, and the
            // dialog around the grid moved with every click or drag. A selected
            // cell keeps the border as `border-transparent`: the brand fill
            // shows through it (a background paints under its own border), so
            // it looks the same and measures the same.
            className={cn(
              "h-auto min-h-11 flex-col gap-0 border px-1 py-1 text-xs font-normal md:min-h-9",
              on && "border-transparent",
            )}
            onClick={() => onPick(index)}
          >
            {/* **The quiet line is `slate` only when the cell is OFF.**
                Mitchell, PR #269 preview: *"For the widget inputs date picker
                the text is blending into the background of a picked date"*.
                A selected cell is `primary` — `bg-brand` with `text-surface`,
                the pairing every filled control here uses — and the detail
                line hard-coded `text-slate` over it: grey on dark green, in
                both themes. On, it takes `text-surface` like the title does
                (which inherits it from the button); off, it stays the quieter
                `slate` on `surface`. Everything a caller puts in `title` or
                `detail` inherits from these two spans, so no caller has to
                repeat the rule. */}
            <span className="font-medium">{title}</span>
            <span className={cn("text-2xs", on ? "text-surface" : "text-slate")}>{detail}</span>
          </Button>
        );
      })}
    </div>
  );
}
