"use client";

import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import type { AccentFamily } from "@/lib/dayAccent";
import type { MapDay } from "./mapRailData";

// Same static-Record pattern as MapRail/DayChips: Tailwind's JIT cannot see a
// template-interpolated `bg-${accent}`.
const TINT_BG: Record<AccentFamily, string> = {
  brand: "bg-brand-tint",
  info: "bg-info-tint",
  success: "bg-success-tint",
  warning: "bg-warning-tint",
  danger: "bg-danger-tint",
  neutral: "bg-moss",
};
const SOLID_BG: Record<AccentFamily, string> = {
  brand: "bg-brand",
  info: "bg-info",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  neutral: "bg-slate",
};

// Height the strip occupies at the top of the canvas, so MapLens can keep the
// camera's top padding clear of it the way it already clears the rail on the
// left. Measured against the rendered chip: 8px top inset + chip + detail line.
export const MAP_DAY_STRIP_HEIGHT_PX = 92;

/**
 * The phone replacement for `MapRail` (Mitchell, 2026-08-30 design pass: "map
 * view pretty broken on mobile … figure out a different static location for
 * the days, have less info and make that where you scroll so map jumping
 * still works").
 *
 * The rail is a 268px-wide floating panel with a geared, scroll-driven focus.
 * On a 411px phone that is most of the screen, and the thing it overlays —
 * the map — is the actual content. So on a phone the days become a horizontal
 * chip strip pinned to the top of the canvas: the same idiom `DayChips` uses
 * everywhere else, which means one thing to learn rather than two.
 *
 * Two deliberate differences from the rail, both from "have less info":
 *
 * - Focus is by **tap**, not by scroll position. The rail's gearing exists to
 *   make a deliberate landing possible in a vertical list you are scrubbing;
 *   a chip is a tap target, and scroll-driven focus on a horizontal strip
 *   would fight the sideways scroll needed to reach day 14.
 * - The per-day detail the rail carries on every row (stop count, transition,
 *   distance) is not on the chips. It appears once, under the strip, for the
 *   focused day only — which is also where `MapFocusCard`'s content goes,
 *   since that card is a desktop overlay with nowhere to sit on a phone.
 */
export function MapDayStrip({
  days,
  focusedDay,
  onFocus,
}: {
  days: MapDay[];
  focusedDay: number | null;
  onFocus: (index: number | null) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);

  // Keep the focused chip in view when focus changes from somewhere other than
  // a tap on this strip — the day chips above the board, or the camera landing
  // on a day. Without this, focusing day 12 leaves the strip showing days 1-4
  // and the strip stops agreeing with the map.
  //
  // Found by attribute rather than by a ref map: the `Button` primitive does
  // not forward refs, and reaching for a raw <button> to get one would give up
  // the shared focus ring and hit-target sizing for a single scroll call.
  useEffect(() => {
    if (focusedDay === null) return;
    const el = trackRef.current?.querySelector(`[data-day-index="${focusedDay}"]`);
    // Feature-detected: jsdom implements no `scrollIntoView` at all, and this
    // is a convenience — the strip is already correct without it, the focused
    // chip is just off-screen. Throwing here would take the whole lens down in
    // tests for the sake of a scroll position.
    if (!el || typeof el.scrollIntoView !== "function") return;
    // `nearest` rather than `center`: scrolling a chip that is already visible
    // into the middle of the strip is motion the user did not ask for.
    el.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [focusedDay]);

  const focused = days.find((d) => d.index === focusedDay) ?? null;
  const detail =
    focused === null
      ? null
      : focused.isEmpty
        ? "No stops yet"
        : focused.flagText !== null
          ? focused.flagText
          : `${focused.stops.length} stop${focused.stops.length === 1 ? "" : "s"}${
              focused.totalKm !== null ? ` · ${focused.totalKm.toFixed(1)} km` : ""
            }`;

  return (
    <div
      data-testid="map-day-strip"
      className="absolute inset-x-0 top-0 flex flex-col gap-1 bg-surface/95 px-2 pt-2 pb-1"
      // eslint-disable-next-line no-restricted-syntax -- z-index 4 matches MapRail's own, so the strip sits over the canvas and under the assistant rail; it has no token equivalent
      style={{ zIndex: 4 }}
    >
      <div
        ref={trackRef}
        role="group"
        aria-label="Days"
        className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1"
      >
        {days.map((day) => {
          const isFocused = day.index === focusedDay;
          return (
            <Button
              key={day.dayId}
              data-day-index={day.index}
              variant="ghost"
              // Tapping the focused chip clears focus, matching DayChips —
              // which is how you get the camera back to the whole trip.
              onClick={() => onFocus(isFocused ? null : day.index)}
              aria-pressed={isFocused}
              aria-label={`${day.label}${day.city !== null ? `, ${day.city}` : ""}`}
              className={cn(
                "h-auto shrink-0 flex-col items-start gap-0.5 rounded-lg px-2.5 py-1.5 text-left",
                isFocused ? TINT_BG[day.accent] : "bg-surface",
                isFocused && "ring-2 ring-brand",
              )}
            >
              <span className="flex items-center gap-1.5">
                <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", SOLID_BG[day.accent])} />
                <span className="text-xs font-semibold text-ink">{day.label}</span>
              </span>
              {day.city !== null && (
                <span
                  className="max-w-24 truncate font-normal text-slate"
                  // eslint-disable-next-line no-restricted-syntax -- 10px city label matches DayChips' own, below text-xs (12px)
                  style={{ fontSize: "10px" }}
                >
                  {day.city}
                </span>
              )}
            </Button>
          );
        })}
      </div>
      {/* One line, for the focused day only — the strip's whole reason for
          existing is that the phone has no room for the rail's per-row detail
          or for the floating focus card. Reserved height rather than
          conditional rendering, so focusing a day does not shove the map down
          by a line. */}
      <p
        data-testid="map-day-strip-detail"
        className="h-4 truncate px-1 font-mono text-xs text-slate"
      >
        {detail}
      </p>
    </div>
  );
}
