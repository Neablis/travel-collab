"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Share } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

// **Lifted out of `KeepDayFlag` so the notebook's "Save as template" pennant is
// the same object, not a lookalike.** Mitchell, PR #269 preview: *"Lets do
// better then just a bunch of buttons, Maybe a flag like when saving a day for
// saving a notebook on the top right of the notebook"*. Two flags that save
// something, drawn and animated by two copies of the same markup, would drift
// the first time one of them was tuned — so the circle, the wave and the
// celebration live here and each caller keeps only what it saves and says.
//
// Everything below the button (the reasons for a fixed square, the wave's
// `animationend`, the celebration's timer and run number) is `KeepDayFlag`'s
// history, moved with the code it explains.
//
// **The glyph is a share arrow, not a flag.** Mitchell, on the notebook's
// pennant at 375px: *"here it makes me think its to report the notebook, find a
// different emoticon"*. Next to a document a flag reads as "report this";
// lucide's `Share` (an arrow lifting out of a box) says what both pennants do:
// send this day, or this notebook, out to the playbooks other people browse.
// One glyph for both, as before. The press motion was a flag waving on its
// staff and is now the arrow lifting out of the box (`.share-lift` in
// globals.css). The component keeps its name: "pennant" is the handoff's name
// for the 30px circle, not a claim about the icon.
//
// In `components/ui` rather than beside `KeepDayFlag` in `components/trip`:
// `pages` importing `trip` closes a folder cycle the dependency wall refuses,
// and a control two surfaces share is what this folder is for.

// The length of the celebration, and the `om-flag-keep` keyframe's own
// duration in globals.css. The two have to agree: the class drives the motion,
// this drives how long the ring and sparks stay in the DOM.
const CELEBRATION_MS = 2600;

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
 * The celebration's run counter for a `PennantButton`: `run` is 0 at rest and
 * a fresh number for each save, and `celebrate()` starts a new full-length run.
 */
export function usePennantCelebration(): { run: number; celebrate: () => void } {
  // Driven by a TIMER rather than `animationend`. The celebration class also
  // gates the ring and sparks, which are removed from the DOM when the run
  // ends — an event that never fires under `prefers-reduced-motion` would
  // leave them there for the life of the page.
  //
  // A RUN NUMBER rather than a boolean, because a second save inside the 2.6s
  // window has to start its own run (CodeRabbit, PR 142). With a boolean, the
  // first run's timer cut the second one short at the first deadline. Bumping
  // the number re-runs the effect below, so the old timer is cleared and the
  // new run gets its own full length.
  const [run, setRun] = useState(0);
  const runs = useRef(0);

  useEffect(() => {
    if (run === 0) return;
    const timer = window.setTimeout(() => setRun(0), CELEBRATION_MS);
    return () => window.clearTimeout(timer);
  }, [run]);

  const celebrate = useCallback(() => {
    runs.current += 1;
    setRun(runs.current);
  }, []);

  return { run, celebrate };
}

/**
 * The icon-only pennant (handoff README "Keep this day"): a 30px circle on
 * `--color-surface`, its share glyph tinted by `inkClassName`, whose arrow lifts
 * when pressed, and which plays the keep celebration while `run` is non-zero.
 */
export function PennantButton({
  label,
  title,
  disabled = false,
  inkClassName,
  run,
  celebrationTestId,
  onPress,
}: {
  /** The accessible name — the pennant has no visible text. */
  label: string;
  /** The hover tooltip; says why when the pennant is disabled. */
  title: string;
  disabled?: boolean;
  /** A token text colour class for the glyph (e.g. an `ACCENT_INK_TEXT` entry). */
  inkClassName: string;
  /** From `usePennantCelebration`; 0 means no celebration is running. */
  run: number;
  /**
   * `data-testid` for the ring-and-sparks wrapper. The celebration has no text
   * any more, so this is the only handle a test has on it.
   */
  celebrationTestId: string;
  onPress: () => void;
}) {
  // The press motion. It began as the design's `wave`
  // (`Trip Planner Redesign.dc.html:4839`), a flag tipping on its staff —
  // Mitchell, 2026-09-01, "The click flag 'Save a day' animation from timeline
  // view is missing". With the share glyph it is the arrow lifting out of its
  // box and settling back: the same "this went somewhere" beat at the same
  // length, in the glyph's own terms.
  //
  // A CSS class toggled off `animationend` rather than `Element.animate()` (the
  // design's own mechanism): the animation lives in globals.css where
  // `prefers-reduced-motion` can drop it in one place. Removing the class on
  // `animationend` is what makes it re-triggerable — a class left behind is an
  // animation that plays exactly once per mount.
  const [waving, setWaving] = useState(false);
  const celebrating = run > 0;

  // The lift must not wait for whatever the press opens: a dialog opens over
  // the pennant, and an animation queued behind a React commit still reads late.
  const press = () => {
    setWaving(true);
    onPress();
  };

  return (
    // Positioned so the ring and sparks can be drawn outside the button
    // without the button having to clip or contain them.
    <span className="relative inline-flex shrink-0">
      <Button
        variant="secondary"
        aria-label={label}
        disabled={disabled}
        title={title}
        onClick={press}
        className={cn(
          // `p-0`: the button is a fixed 30px square holding one 16px glyph,
          // so Button's own horizontal padding has nothing to do and would
          // only fight the width for it. Button's base carries the 44px phone
          // floor (`min-h-11 min-w-11`, released at `md`), so on a phone the
          // tap target is 44px while the circle is drawn at 30 on a desktop.
          "shrink-0 justify-center rounded-full border-transparent bg-surface p-0 hover:bg-surface",
          inkClassName,
          celebrating && "flag-celebrate",
        )}
        // The 30px pennant circle has no token equivalent — TimelineLens/MapLens/
        // ActivityCard's computed-geometry pattern. (`components/ui` is outside
        // the element wall, so no line disable is needed here.)
        style={{ height: PENNANT_PX, width: PENNANT_PX }}
      >
        {/* The glyph moves, not the button, so the 30px circle and its focus
            ring stay put. The class sits on this span and the keyframe runs
            on the arrow's two paths inside it (globals.css); their
            `animationend` bubbles up to here, and nothing else inside a bare
            `<svg>` animates while the class is on, so it can only be the lift
            ending. */}
        <span className={cn("inline-flex", waving && "share-lift")} onAnimationEnd={() => setWaving(false)}>
          <Share className="h-4 w-4" aria-hidden />
        </span>
      </Button>
      {/* Keyed on the run so a second save inside the window replays the
          decoration instead of sitting inert under a class that is already
          applied. Only these remount, never the Button: Radix restores focus
          to the element that opened the dialog, and remounting that element
          would drop the focus return on every save. */}
      {celebrating && (
        <div key={run} data-testid={celebrationTestId} className="contents">
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
  );
}
