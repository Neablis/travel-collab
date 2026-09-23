import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { centralDayIndex, READING_LINE, stepDay } from "@/components/trip/centralDay";
import {
  useDayScrollSpy,
  useFollowFocusedDay,
  type DaySync,
} from "@/components/trip/context/FocusProvider";
import { DataText } from "@/components/ui/data-text";
import { ACCENT_INK_TEXT, dayAccents, type AccentFamily } from "@/lib/dayAccent";
import { cn } from "@/lib/cn";
import type { ChipDay } from "@/lib/dayChips";


// Same static-map pattern as Sparkline.tsx's BAR_BG / TripCard.tsx's
// ACCENT_BAR_BG: Tailwind's JIT scanner can't see a template-interpolated
// `bg-${x}-tint`, so this is the only route from an AccentFamily to a real
// class. `--color-*-tint` exists for all five named families (globals.css).
const CHIP_BG: Record<AccentFamily, string> = {
  brand: "bg-brand-tint",
  info: "bg-info-tint",
  success: "bg-success-tint",
  warning: "bg-warning-tint",
  danger: "bg-danger-tint",
  neutral: "bg-moss",
};

const DOT_BG: Record<AccentFamily, string> = {
  brand: "bg-brand",
  info: "bg-info",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  neutral: "bg-slate",
};


export type DayChipsProps = {
  days: ChipDay[];
  focusedDay: number | null;
  /**
   * `null` clears the focus. The chips are the only affordance in the app that
   * can do that, which is why the type is widened here and not just tolerated:
   * `focusedDay` is the assistant's scope, and half of M16's gate is asked
   * with "no day selected".
   */
  onSelect: (index: number | null) => void;
  /**
   * Drops the focused chip's `×`. Not the selecting itself — deselecting a day
   * is a read, and a viewer may do it; the chip stays a working toggle either
   * way, because the whole chip IS the toggle and the `×` is only its visible
   * half.
   *
   * Mitchell, on the PR #143 preview from a Pixel 10: *"Remove the 'Remove day'
   * button on the demo trip (or any read only trip)"*. There is no remove-day
   * button on that screen — `Board.tsx` already gates the real one — and that is
   * the point: an `×` sitting beside a day, on a trip you cannot edit, reads as
   * "delete this day" whatever it actually does. The affordance was lying about
   * its own consequence, which is a worse bug than a stray control.
   */
  readOnly?: boolean;
  /**
   * This row's half of the day-sync contract (`FocusProvider`'s header):
   * scrolling the row moves the selection, and a selection made anywhere else
   * scrolls the matching chip back into view here.
   *
   * A handle passed down rather than `useDaySync()` read from context, because
   * this component is props-only by design — its own tests render it bare, with
   * no provider — and `TripBoardScreen`, which does live under one, is where
   * every other surface's focus wiring already is. Optional for the same
   * reason: without it the row still renders and still selects, it just does
   * not scroll-sync.
   */
  sync?: DaySync;
};

// Handoff README §2 "Day chips row" + prototype `data-r` chips: a
// horizontally scrolling row of 92px, 12px-radius (rounded-lg), day-tinted
// chips — line 1 day-of-week, line 2 mono date number + city, line 3 the
// transition line, line 4 stop dots. The transition line is a fixed h-3.5
// (14px) slot rendered on every chip, empty or not, so the row doesn't jump
// height as a real timeline (Task 10) supplies real transitions.
//
// The handoff draws line 3 as "→ dest city", which this built as a bare
// `→ ${transitionTo}` under a line-2 city — and since transitionTo WAS
// line 2's city (chipModel set it to `city` itself), every travel chip read
// its destination twice: "Nikkō" over "→ Nikkō" (Mitchell, preview feedback
// on PR #55: "Shouldnt this be Tokyo for the city? Since it ends the day in
// Nikko?"). The arrow only means anything with both ends, so line 3 now
// spells out the whole move and line 2 yields the city to it on those days.
// TimelineLens had already worked around the same gap by reaching back to
// `days[index - 1].city` for its travel pill's "from" — it now reads
// transitionFrom instead, so the two surfaces derive the move once.
// Clicking a chip calls onSelect — TripBoardScreen wires this straight to
// Task 4's useFocus().setFocusedDay; this component dispatches no trip
// command and knows nothing about the active lens.
//
// Clicking the ALREADY-focused chip clears the focus (`onSelect(null)`).
// M16 Wave 2 made that load-bearing rather than a nicety: `focusedDay` is now
// the assistant's scope, so without a way back to "no day" the whole-trip half
// of every question was reachable only on a fresh page load — and
// TimelineLens's "add a day" focuses silently, so adding one locked you into
// day scope for the session. `aria-pressed` already tells assistive tech this
// is a toggle; the × on the focused chip is what tells everyone else, since a
/**
 * Renders selectable day chips for a trip.
 *
 * The row supports keyboard navigation, focused-day synchronization, and optional
 * read-only presentation.
 *
 * @param days - The trip days represented by the chips
 * @param focusedDay - The index of the selected day, or `null`
 * @param onSelect - Called with the selected day index or `null` to clear selection
 * @param readOnly - Whether to hide the visual removal control
 * @param sync - Optional synchronization configuration for related trip surfaces
 * @returns The rendered day-chip group
 */
export function DayChips({ days, focusedDay, onSelect, readOnly = false, sync }: DayChipsProps) {
  // One dayAccents() call over the whole trip's cities, so collisions
  // between two days of this trip get probed against each other rather than
  // each day resolving blind to every other one.
  const accents = dayAccents(days.map((d) => d.city));
  const chipRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const rowRef = useRef<HTMLDivElement>(null);

  // Contract clause 1 (`FocusProvider`), and the surface Mitchell was actually
  // touching when he asked for it: on a phone this row is the primary day
  // control. The horizontal twin of the timeline's spy — the row scrolls inside
  // its OWN box, so the viewport is that box and the reading line is its true
  // centre (see `READING_LINE` for why the two axes differ).
  const onScroll = useDayScrollSpy(sync, () => {
    const row = rowRef.current;
    if (row === null) return null;
    const rowRect = row.getBoundingClientRect();
    const spans: { start: number; size: number }[] = [];
    for (let index = 0; index < days.length; index++) {
      const rect = chipRefs.current[index]?.getBoundingClientRect();
      // A chip that has not mounted: bail rather than measure a shorter list,
      // which would map positions onto the wrong indexes.
      if (rect === undefined) return null;
      spans.push({ start: rect.left, size: rect.width });
    }
    // The third horizontal day scroller, carrying the same end-unreachable
    // defect as Board and MapDayStrip: a row wider than one chip cannot bring
    // the first or last chip's centre to the reading line, so neither could
    // ever be the day this row reports. Fixed in all three together rather
    // than one at a time — the first fix covered only Board and Mitchell found
    // the strip within the hour.
    const maxScroll = row.scrollWidth - row.clientWidth;
    return centralDayIndex({ start: rowRect.left, size: rowRect.width }, spans, READING_LINE.horizontal, {
      atStart: row.scrollLeft <= 1,
      atEnd: row.scrollLeft >= maxScroll - 1,
    });
  });

  // Contract clauses 2 and 3: a day picked in a column, a cell or the timeline
  // brings its chip back into view here, and switching lenses does the same on
  // arrival. `inline: "center"` with `block: "nearest"` is the hook's default —
  // this row sits in a sticky header, where a vertical scroll would move the
  // whole page for a chip that was never off-screen.
  useFollowFocusedDay(sync, focusedDay, days.length, (index) => chipRefs.current[index]);

  /**
   * Left/Right walk the row — the header-bar half of "Left/Right in the days
   * column should change the selected day" (Mitchell, 2026-09-01), and the
   * keyboard behaviour a `role="group"` of toggles is expected to have anyway.
   *
   * On the container rather than each chip, so it works wherever focus is
   * inside the row; and it moves DOM focus as well as the selection, because a
   * selection that walks away from the focused control leaves a screen-reader
   * user reading a chip that is no longer the one selected.
   */
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
    const next = stepDay(focusedDay, event.key === "ArrowRight" ? 1 : -1, days.length);
    if (next === null) return;
    // Claimed even when the index does not move (an arrow at either end): the
    // row scrolls horizontally, and letting the browser scroll it while the
    // selection stays put is the two behaviours fighting.
    event.preventDefault();
    if (next !== focusedDay) onSelect(next);
    // `preventScroll` because the follow effect above owns the scrolling now.
    // The browser's own "reveal the newly focused control" scroll is not ours,
    // so it is not covered by the jump lock — the spy would read it as the user
    // scrolling and could land the selection on a neighbouring chip.
    chipRefs.current[next]?.focus({ preventScroll: true });
  };
  return (
    // Reported three times ("top border cut off"/"still cut off"/"border on
    // the left side here is cut off"): `overflow-x-auto` sets overflow-x to a
    // non-`visible` value, and the CSS overflow spec forces the paired
    // overflow-y (left at its `visible` default) to compute as `auto` too — so
    // this container clips on every side even though only the x-axis was ever
    // meant to scroll. `pb-1` already gave the focused chip's `ring-2`
    // clearance below the clip edge and `pt-1` covered the symmetric case
    // above; the horizontal axis was still flush, so focusing the FIRST chip
    // clipped the left half of its ring against the scroll origin (and the
    // last chip's right half at the far end).
    //
    // `px-1` with a matching `-mx-1` rather than bare padding: padding inside
    // a scroll container would indent the row from the header's own `px-6`
    // gutter, so the negative margin gives the ring its gutter back without
    // moving where the chips sit. Same pairing as `ui/sheet.tsx`, which needed
    // it for the same reason on the vertical axis.
    <div
      ref={rowRef}
      role="group"
      aria-label="Days"
      onKeyDown={onKeyDown}
      onScroll={onScroll}
      className="-mx-1 flex gap-2 overflow-x-auto px-1 pt-1 pb-1"
    >
      {days.map((day, index) => {
        const accent = accents[index] ?? { tint: "neutral", ink: "neutral", solid: "neutral" };
        const isFocused = focusedDay === index;
        return (
          <Button
            key={index}
            ref={(node) => {
              chipRefs.current[index] = node;
            }}
            variant="ghost"
            aria-label={`${day.dow}${
              day.transitionTo ? `, ${day.transitionFrom} to ${day.transitionTo}` : day.city ? `, ${day.city}` : ""
            }, ${day.stops} stop${day.stops === 1 ? "" : "s"}`}
            aria-pressed={isFocused}
            // The chip's own index, so a test can ask WHICH day is selected
            // rather than parsing a weekday out of the label — the labels
            // depend on the trip's dates, which move (the demo fixture is dated
            // relative to today). Not a test-only hook in spirit: it is the
            // same identity the click handler and the ring already use.
            data-day-index={index}
            onClick={() => onSelect(isFocused ? null : index)}
            className={cn(
              "h-auto shrink-0 flex-col items-start justify-start gap-1 rounded-lg p-2 text-left hover:opacity-90",
              CHIP_BG[accent.solid],
              isFocused && "ring-2 ring-brand",
            )}
            // eslint-disable-next-line no-restricted-syntax -- 92px chip width has no token equivalent, matching TimelineLens/MapLens/ActivityCard's computed-geometry pattern
            style={{ width: "92px" }}
          >
            {/* Weekday and day-of-month share the first line — "Tue 8" (Mitchell,
                on the preview: "Lets move the day of the month up to be inline
                with the Day of the week to be more space efficient"). The number
                used to sit on the second line ahead of the city, where it was
                the reason a longer city name truncated: it took a fixed
                `shrink-0` bite out of a chip only ~72px wide. */}
            <div className="flex w-full items-baseline gap-1 overflow-hidden">
              <span className={cn("text-xs font-semibold", ACCENT_INK_TEXT[accent.ink])}>{day.dow}</span>
              <DataText size="xs" className="shrink-0">
                {day.dateNum}
              </DataText>
              {isFocused && !readOnly && (
                // Not a nested <button>: the whole chip already IS the toggle,
                // and a button inside a button is invalid HTML. This is the
                // visible half of `aria-pressed`.
                //
                // `!readOnly` because on a trip you cannot edit it reads as
                // "delete this day" — see `readOnly` in the props above. The
                // chip still deselects on a second tap; only the glyph goes.
                <span aria-hidden className={cn("ml-auto shrink-0 text-xs leading-none", ACCENT_INK_TEXT[accent.ink])}>
                  ×
                </span>
              )}
            </div>
            {/* On a travel day the city moves down to the transition line, which
                spells out both ends of the move — printing it here as well would
                be the same fact twice on one chip (RULES.md 4), and printing it
                here alone is what produced the reported "Nikkō" over "→ Nikkō". */}
            <div className="flex w-full items-baseline overflow-hidden">
              {day.city && !day.transitionTo ? (
                <span
                  className="truncate text-slate"
                  // eslint-disable-next-line no-restricted-syntax -- 10px city label has no token equivalent (below text-xs/12px), matching TimelineLens/MapLens/ActivityCard's computed-geometry pattern
                  style={{ fontSize: "10px" }}
                >
                  {day.city}
                </span>
              ) : null}
            </div>
            <div
              data-testid="day-chip-transition"
              className="h-3.5 w-full truncate text-slate"
              // eslint-disable-next-line no-restricted-syntax -- 10px transition label has no token equivalent (below text-xs/12px), matching TimelineLens/MapLens/ActivityCard's computed-geometry pattern
              style={{ fontSize: "10px" }}
            >
              {day.transitionTo ? `${day.transitionFrom} → ${day.transitionTo}` : null}
            </div>
            {/* `mt-auto` pins the dots to the bottom of the chip. The chips
                are flex siblings in a stretch row, so they already share a
                height; what differed was where this row landed inside it.
                The city line above collapses to zero height on a travel day
                (the city moves to the transition line), so a travel chip's
                dots sat a line higher than its neighbours' — reported on the
                preview, 2026-08-30. Pinning to the bottom fixes that without
                reserving height for a line that is deliberately empty, and
                holds for any future row that renders conditionally. */}
            <div className="mt-auto flex flex-wrap gap-0.5" aria-hidden>
              {Array.from({ length: day.stops }, (_, dotIndex) => (
                <span
                  key={dotIndex}
                  className={cn("w-2 rounded-full", DOT_BG[accent.solid])}
                  // eslint-disable-next-line no-restricted-syntax -- 3px stop-dot height has no token equivalent, matching TimelineLens/MapLens/ActivityCard's computed-geometry pattern
                  style={{ height: "3px" }}
                />
              ))}
            </div>
          </Button>
        );
      })}
    </div>
  );
}
