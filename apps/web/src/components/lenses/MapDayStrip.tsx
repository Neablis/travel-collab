"use client";

import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { centralDayIndex, READING_LINE } from "@/components/trip/centralDay";
import {
  useDayScrollSpy,
  useFollowFocusedDay,
  type DaySync,
} from "@/components/trip/context/FocusProvider";
import { useDistanceUnit } from "@/components/account/PreferencesProvider";
import { cn } from "@/lib/cn";
import type { AccentFamily } from "@/lib/dayAccent";
import { kmLabel } from "@/lib/units";
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
// left. Measured in a real browser at 411px: 81px for a chip carrying a city
// line, which is the tall case — the city label is `truncate`, so it never
// wraps and no name makes the strip taller than this. Rounded up to 84 for the
// focus ring, and deliberately a ceiling: over-reserving costs a few pixels of
// map, under-reserving puts a pin under the strip.
export const MAP_DAY_STRIP_HEIGHT_PX = 84;

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
 * One deliberate difference from the rail, from "have less info": the per-day
 * detail the rail carries on every row (stop count, transition, distance) is
 * not on the chips. It appears once, under the strip, for the focused day only
 * — which is also where `MapFocusCard`'s content goes, since that card is a
 * desktop overlay with nowhere to sit on a phone.
 *
 * There used to be a second one: focus here was by **tap only**, on the
 * reasoning that scroll-driven focus on a horizontal strip would fight the
 * sideways scroll needed to reach day 14. Mitchell overruled that from the
 * preview, 2026-09-01: *"scrolling here on mobile should change the selected
 * day"* — and on a phone, where this strip is the only day control on the lens,
 * scrubbing to a day and choosing it really are one gesture. The strip now
 * obeys the day-sync contract in `FocusProvider`'s header like every other day
 * container; the jump lock is what keeps its own scroll-into-view from being
 * read back as a scrub, which is the fight the old comment was worried about.
 */
export function MapDayStrip({
  days,
  focusedDay,
  onFocus,
  sync,
}: {
  days: MapDay[];
  focusedDay: number | null;
  onFocus: (index: number | null) => void;
  /**
   * This strip's half of the day-sync contract (`FocusProvider`'s header).
   * Passed down from `MapLens` rather than read from context here, so this
   * component stays renderable on its own — the same shape `DayChips` and
   * `Board` use.
   */
  sync?: DaySync;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const unit = useDistanceUnit();

  // Contract clause 1: scrolling the strip selects the day on its reading line,
  // which on a horizontal row of equal chips is its true centre (`READING_LINE`).
  //
  // Chips are found by attribute rather than through a ref map: the `Button`
  // primitive does not forward refs, and reaching for a raw <button> to get one
  // would give up the shared focus ring and hit-target sizing. DOM order is
  // `days` order, so the nth span is `days[n]` — and `day.index` is read off it
  // rather than assumed to equal n, because `MapDay.index` is the trip-day
  // index and nothing here guarantees the two stay the same list.
  const onScroll = useDayScrollSpy(sync, () => {
    const track = trackRef.current;
    if (track === null) return null;
    const trackRect = track.getBoundingClientRect();
    const chips = track.querySelectorAll("[data-day-index]");
    if (chips.length !== days.length) return null;
    const spans = Array.from(chips, (chip) => {
      const rect = chip.getBoundingClientRect();
      return { start: rect.left, size: rect.width };
    });
    const nth = centralDayIndex(
      { start: trackRect.left, size: trackRect.width },
      spans,
      READING_LINE.horizontal,
    );
    return nth === null ? null : (days[nth]?.index ?? null);
  });

  // Contract clauses 2 and 3: keep the focused chip in view when the focus
  // changed from somewhere other than this strip's own scrolling — the camera
  // landing on a day, or arriving on this lens with a day already selected.
  // Without it, focusing day 12 leaves the strip showing days 1-4 and the strip
  // stops agreeing with the map.
  //
  // `inline: "nearest"` overrides the hook's `"center"`: scrolling a chip that
  // is already visible into the middle of the strip is motion the user did not
  // ask for, and this strip's chips are small enough that several are on screen
  // at once.
  useFollowFocusedDay(
    sync,
    focusedDay,
    days.length,
    (index) => trackRef.current?.querySelector(`[data-day-index="${index}"]`),
    { inline: "nearest" },
  );

  const focused = days.find((d) => d.index === focusedDay) ?? null;
  const detail =
    focused === null
      ? null
      : focused.isEmpty
        ? "No stops yet"
        : focused.flagText !== null
          ? focused.flagText
          : `${focused.stops.length} stop${focused.stops.length === 1 ? "" : "s"}${
              // M17: one helper owns every distance (SPEC §12).
              focused.totalKm !== null ? ` · ${kmLabel(focused.totalKm, unit)}` : ""
            }`;

  return (
    <div
      data-testid="map-day-strip"
      className="absolute inset-x-0 top-0 flex flex-col gap-1 bg-surface/95 px-2 pt-2 pb-1"
      // eslint-disable-next-line no-restricted-syntax -- z-index 4 matches MapRail's own, so the strip sits over the canvas and under the assistant rail; it has no token equivalent
      style={{ zIndex: 4 }}
    >
      {/* `pt-1`/`pb-1` with `px-1` and a matching `-mx-1`, all four of them
          load-bearing: `overflow-x-auto` sets overflow-x to a non-`visible`
          value, and the CSS overflow spec forces the paired overflow-y to
          compute as `auto` too — so this container clips on every side even
          though only the x-axis is meant to scroll, and the focused chip's
          `ring-2` gets cut against the edge. DayChips carries the same four
          classes and a comment recording that it was reported three times
          before all four were there; this strip copied the pattern and
          dropped `pt-1`, so it was reported a fourth ("top border is cut
          off", 411px, 2026-08-30). The negative margin gives the ring its
          gutter back without indenting the row. */}
      <div
        ref={trackRef}
        role="group"
        aria-label="Days"
        onScroll={onScroll}
        className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pt-1 pb-1"
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
