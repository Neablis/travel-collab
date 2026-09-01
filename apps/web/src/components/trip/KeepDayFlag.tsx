"use client";

import { useCallback, useState } from "react";
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
  const empty = stops.length === 0;

  // Two things on one click, and the order matters only in that the wave must
  // not wait for the dialog: the dialog opens over the flag, and an animation
  // queued behind a React commit that unmounts nothing still reads as late.
  const keep = useCallback(() => {
    setWaving(true);
    setOpen(true);
  }, []);

  return (
    <>
      <Button
        variant="secondary"
        aria-label={`Keep day ${dayIndex + 1}`}
        disabled={empty}
        title={empty ? "Add a stop to this day first" : "Keep this day"}
        onClick={keep}
        className={cn(
          "shrink-0 rounded-full border-transparent bg-surface p-0 hover:bg-surface",
          INK_TEXT[accent],
        )}
        // eslint-disable-next-line no-restricted-syntax -- 30px pennant circle has no token equivalent, matching TimelineLens/MapLens/ActivityCard's computed-geometry pattern
        style={{ height: "30px", width: "30px" }}
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
      <KeepDayDialog
        open={open}
        onOpenChange={setOpen}
        tripId={tripId}
        dayId={dayId}
        dayIndex={dayIndex}
        tripName={tripName}
        stops={stops}
        onSaved={setSaved}
      />
      {saved !== null && (
        <Toast message={`Kept "${saved}"`} onDismiss={() => setSaved(null)} />
      )}
    </>
  );
}
