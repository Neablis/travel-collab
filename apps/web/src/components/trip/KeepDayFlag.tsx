"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Flag } from "lucide-react";
import type { SavedStop } from "@tc/contracts";
import { Button } from "@/components/ui/button";
import { Toast } from "@/components/ui/toast";
import { KeepDayDialog } from "@/components/trip/KeepDayDialog";
import type { AccentFamily } from "@/lib/dayAccent";
import { cn } from "@/lib/cn";

// "danger"/"warning"/"success"/"info" each carry a `-ink` token; "brand" does
// not (its darkest tone is `-pressed`) — same map shape NextTripHero.tsx's
// STAT_TILE_TONE_CLASSES uses for the same reason. Static Record, not a
// template string: Tailwind only emits utilities it can see as literal text.
const INK_TEXT: Record<AccentFamily, string> = {
  brand: "text-brand-pressed",
  info: "text-info-ink",
  success: "text-success-ink",
  warning: "text-warning-ink",
  danger: "text-danger-ink",
  neutral: "text-slate",
};

// The length of the celebration, and the `om-flag-keep` keyframe's own
// duration in globals.css. The two have to agree: the class drives the motion,
// this drives how long the ring and sparks stay in the DOM.
const CELEBRATION_MS = 2600;

// Handoff README "Keep this day": an icon-only pennant, 30px circle,
// `--color-surface` background, glyph tinted in the day's ink color.
//
// Real as of M11 link 6 — the caller used to wrap this in
// <Preview id="keep-day-flag">, which shielded the click and stamped a chip.
// The onClick was already wired against the day this would eventually save;
// what the shell was missing was somewhere to save it to.
//
// Disabled on an empty day rather than hidden: the pennant is part of the
// day's row furniture and a row that loses a control as its last stop is
// removed is worse than one whose control greys out. `title` says why.

// **The pennant is a 30px circle at every moment of its life, and that is what
// finally fixed the row it was breaking.**
//
// Mitchell, 2026-09-06 05:58, on a 412px phone: *"add stop goes briefly to the
// second line when the flag button is clicked"* — the button used to grow a
// "Kept" label mid-celebration, animating `max-width: 0 → 52px`, and the day
// head is `flex-wrap` with no slack at that width. The first answer was to
// reserve the label's width permanently (`88px`), which stopped the reflow at
// the cost of an un-kept pennant three times wider than the design's.
//
// Mitchell, 2026-09-06 10:07, seeing that: *"lets go back to this being
// smaller, drop the word kept and the expanded UI and just have it turn green
// and do the animation when it succeeds."* So the label is gone outright, and
// with nothing left that can change size there is nothing left to reserve. A
// fixed square, not a `minWidth`: the two are the same number now, and the
// square says the button cannot grow rather than that it will not.
const PENNANT_PX = "30px";

/**
 * Provides a flag control for saving a trip day and displays save confirmation feedback.
 *
 * @param dayIndex - The zero-based index of the day.
 * @param accent - The accent family used to style the control.
 * @param tripId - The identifier of the trip containing the day.
 * @param dayId - The identifier of the day to save.
 * @param tripName - The name of the trip.
 * @param stops - The stops included in the day.
 */
export function KeepDayFlag({
  dayIndex,
  accent,
  tripId,
  dayId,
  tripName,
  stops,
}: {
  dayIndex: number;
  accent: AccentFamily;
  tripId: string;
  dayId: string;
  tripName: string;
  stops: SavedStop[];
}) {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  // The design's `wave` (`Trip Planner Redesign.dc.html:4839`): the pennant
  // tips as you click it. Missing from the build until now — Mitchell,
  // 2026-09-01, "The click flag 'Save a day' animation from timeline view is
  // missing".
  //
  // A CSS class toggled off `animationend` rather than `Element.animate()` (the
  // design's own mechanism): the animation lives in globals.css where
  // `prefers-reduced-motion` can drop it in one place, and a WAAPI call would
  // run regardless of that preference unless every call site remembered to ask.
  // Removing the class on `animationend` is what makes it re-triggerable — a
  // class left behind is an animation that plays exactly once per mount.
  const [waving, setWaving] = useState(false);
  // The design's `celebrate()` (`dc.html:4871`), which the build shipped
  // without — KeepDayDialog.tsx used to say so in as many words: "the save is
  // real; the confetti is not".
  //
  // Driven by a TIMER rather than `animationend`, which is where this departs
  // from `waving` above. The wave's class drives nothing but an animation, so
  // an `animationend` that never fires under `prefers-reduced-motion` costs
  // nothing. This class also gates the ring and sparks, which are removed from
  // the DOM when the run ends — an event that never fires would leave them
  // there for the life of the page. 2600ms is the fill keyframe's duration in
  // globals.css.
  //
  // A RUN NUMBER rather than a boolean, because a second save inside the 2.6s
  // window has to start its own run (CodeRabbit, PR 142). With a boolean,
  // `setCelebrating(true)` was a no-op while one was already in flight, and the
  // first run's timer then cut the second one short at the first deadline.
  // Bumping the number re-runs the effect below, so the old timer is cleared
  // and the new run gets its own full length.
  const [run, setRun] = useState(0);
  const runs = useRef(0);
  const celebrating = run > 0;
  const empty = stops.length === 0;

  useEffect(() => {
    if (run === 0) return;
    const timer = window.setTimeout(() => setRun(0), CELEBRATION_MS);
    return () => window.clearTimeout(timer);
  }, [run]);

  // Both halves of the outcome: the toast names what was kept and is what a
  // screen reader hears; the pennant shows it, decoratively.
  const onSaved = useCallback((name: string) => {
    setSaved(name);
    runs.current += 1;
    setRun(runs.current);
  }, []);

  // Two things on one click, and the order matters only in that the wave must
  // not wait for the dialog: the dialog opens over the flag, and an animation
  // queued behind a React commit that unmounts nothing still reads as late.
  const keep = useCallback(() => {
    setWaving(true);
    setOpen(true);
  }, []);

  return (
    <>
      {/* Positioned so the ring and sparks can be drawn outside the button
          without the button having to clip or contain them. */}
      <span className="relative inline-flex shrink-0">
        <Button
          variant="secondary"
          aria-label={`Keep day ${dayIndex + 1}`}
          disabled={empty}
          title={empty ? "Add a stop to this day first" : "Keep this day"}
          onClick={keep}
          className={cn(
            // `p-0`: the button is a fixed 30px square holding one 16px glyph,
            // so Button's own horizontal padding has nothing to do and would
            // only fight the width for it.
            "shrink-0 justify-center rounded-full border-transparent bg-surface p-0 hover:bg-surface",
            INK_TEXT[accent],
            celebrating && "flag-celebrate",
          )}
          // eslint-disable-next-line no-restricted-syntax -- the 30px pennant circle has no token equivalent, matching TimelineLens/MapLens/ActivityCard's computed-geometry pattern
          style={{ height: PENNANT_PX, width: PENNANT_PX }}
        >
          {/* The glyph waves, not the button: the design animates the `svg`
              inside the control, so the 30px circle and its focus ring stay put
              while the pennant tips. `onAnimationEnd` is on the same element the
              class is, so it cannot be fired by some other animation bubbling up
              from a child — a bare `<svg>` has none. */}
          <span
            className={cn("inline-flex", waving && "flag-wave")}
            onAnimationEnd={() => setWaving(false)}
          >
            <Flag className="h-4 w-4" aria-hidden />
          </span>
        </Button>
        {/* Keyed on the run so a second save inside the window replays the
            decoration instead of sitting inert under a class that is already
            applied. Only these three remount, never the Button: Radix restores
            focus to the element that opened the dialog, and remounting that
            element would drop the focus return on every save. The button's own
            pop does not replay, which reads correctly anyway — it is already
            green, and stays so until the new run's later deadline. */}
        {celebrating && (
          /* `data-testid` because the celebration has no text any more: the
             "Kept" label was the only thing a test could see, and the run
             logic below it (a second save inside the window gets its own full
             run) is still worth holding. */
          <div key={run} data-testid="keep-day-celebration" className="contents">
            <span className="flag-celebrate-ring" aria-hidden />
            {/* Four sparks on the design's four paths. Their offsets, sizes and
                delays are `nth-child` rules in globals.css, so this stays a list
                of four identical spans and the geometry stays with the motion —
                which is also why they need their own box: as siblings of the
                button and the ring, `nth-child(1)` would name the button. */}
            <span className="flag-celebrate-sparks" aria-hidden>
              <span className="flag-celebrate-spark" />
              <span className="flag-celebrate-spark" />
              <span className="flag-celebrate-spark" />
              <span className="flag-celebrate-spark" />
            </span>
          </div>
        )}
      </span>
      <KeepDayDialog
        open={open}
        onOpenChange={setOpen}
        tripId={tripId}
        dayId={dayId}
        dayIndex={dayIndex}
        tripName={tripName}
        stops={stops}
        onSaved={onSaved}
      />
      {saved !== null && (
        <Toast message={`Kept "${saved}"`} onDismiss={() => setSaved(null)} />
      )}
    </>
  );
}
