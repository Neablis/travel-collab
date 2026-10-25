"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

/**
 * The position a drag of `dy` pixels leaves a photo at, from `start`, when the
 * photo can travel `travel` pixels from its top edge showing to its bottom edge
 * showing. The photo follows the pointer: dragging down shows more of its top,
 * which is a lower `object-position`.
 */
export function dragToPosition(start: number, dy: number, travel: number): number {
  return clamp(Math.round(start - (dy / travel) * 100));
}

const clamp = (position: number) => Math.min(100, Math.max(0, position));

/**
 * How far, in pixels, the photo in `band` can move: its overflow below the
 * band, as `object-fit: cover` scales it to the band's width. A photo not yet
 * loaded, or one no taller than the band, has none, and then a drag the
 * band's height moves it end to end.
 */
function travelIn(band: HTMLElement): number {
  const { width, height } = band.getBoundingClientRect();
  const img = band.querySelector("img");
  const overflow = img && img.naturalWidth > 0 ? (width * img.naturalHeight) / img.naturalWidth - height : 0;
  return overflow >= 1 ? overflow : Math.max(height, 1);
}

/**
 * **Reposition mode on the trip's cover band** (M49 decision 10, Notion's
 * pattern): laid over the band's exposed part, a vertical slider that a mouse
 * or touch drag moves, live, and `↑`/`↓` move 1% (10% with `Shift`). `Enter`
 * or *Save position* hands the position to `onSave`; `Esc` or *Cancel* calls
 * `onCancel`, which puts the band back as it was. `onChange` reports every
 * move, so the band can draw the photo there before anything is saved.
 *
 * `onSave` answers whether the position was stored; until it is, the mode
 * stays open, so a failed save loses nothing.
 */
export function RepositionCover({
  initial,
  onChange,
  onSave,
  onCancel,
  className,
}: {
  initial: number;
  onChange: (position: number) => void;
  onSave: (position: number) => Promise<boolean>;
  onCancel: () => void;
  className?: string;
}) {
  const [position, setPosition] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const drag = useRef<{ pointerId: number; y: number; from: number; travel: number } | null>(null);
  const slider = useRef<HTMLDivElement>(null);
  const hint = useId();

  useEffect(() => slider.current?.focus(), []);

  const move = (next: number) => {
    setPosition(next);
    setFailed(false);
    onChange(next);
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    const saved = await onSave(position);
    setSaving(false);
    setFailed(!saved);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const band = e.currentTarget.parentElement ?? e.currentTarget;
    drag.current = { pointerId: e.pointerId, y: e.clientY, from: position, travel: travelIn(band) };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (d === null || d.pointerId !== e.pointerId) return;
    move(dragToPosition(d.from, e.clientY - d.y, d.travel));
  };
  const endDrag = () => {
    drag.current = null;
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 10 : 1;
    if (e.key === "ArrowUp") move(clamp(position + step));
    else if (e.key === "ArrowDown") move(clamp(position - step));
    else if (e.key === "Enter") void save();
    else if (e.key === "Escape") onCancel();
    else return;
    e.preventDefault();
  };

  return (
    <div className={cn("absolute inset-x-0 top-0", className)}>
      <div
        ref={slider}
        role="slider"
        tabIndex={0}
        aria-label="Cover position"
        aria-orientation="vertical"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={position}
        aria-describedby={hint}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
        className="absolute inset-0 cursor-grab touch-none outline-none select-none active:cursor-grabbing"
      />
      <p
        id={hint}
        className="pointer-events-none absolute top-1/2 left-1/2 -translate-1/2 rounded-full bg-ink/60 px-3.5 py-1.5 text-sm font-medium text-surface"
      >
        Drag image to reposition
      </p>
      <div className="absolute right-3 bottom-3 flex items-center gap-2">
        {failed && (
          <p role="alert" className="rounded-full bg-surface/90 px-3.5 py-1.5 text-sm text-ink">
            Couldn’t save the position. Try again.
          </p>
        )}
        <Button variant="ghost" size="sm" disabled={saving} onClick={() => void save()} className={PILL}>
          Save position
        </Button>
        <Button variant="ghost" size="sm" disabled={saving} onClick={onCancel} className={PILL}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** A control over the photo: `SharedDayScreen`'s pill. */
export const PILL = "rounded-full border-0 bg-surface/90 px-3.5 text-sm font-medium text-ink hover:bg-surface";
