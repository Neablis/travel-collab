"use client";

import { useState } from "react";
import { Flag } from "lucide-react";
import { Button } from "@/components/ui/button";
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
// `--color-surface` background, glyph tinted in the day's ink color. The
// caller (TimelineLens) always renders this inside <Preview id="keep-day-flag">
// (Task 3's seam), which shields pointer events and stamps the
// "Preview · M11" chip — so the onClick wired below is still inert overall
// in production. Wiring it for real (rather than leaving it unwired) makes
// this a genuine, testable component with its eventual behavior, matching
// every other shell in the M10 plan; it just never fires through the outer
// Preview shield until M11 removes that wrap. Task 17 adds the dialog this
// opens (KeepDayDialog), which is itself inert — see that file's comment.
export function KeepDayFlag({ dayIndex, accent }: { dayIndex: number; accent: AccentFamily }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="secondary"
        aria-label={`Keep day ${dayIndex + 1}`}
        onClick={() => setOpen(true)}
        className={cn(
          "shrink-0 rounded-full border-transparent bg-surface p-0 hover:bg-surface",
          INK_TEXT[accent],
        )}
        // eslint-disable-next-line no-restricted-syntax -- 30px pennant circle has no token equivalent, matching TimelineLens/MapLens/ActivityCard's computed-geometry pattern
        style={{ height: "30px", width: "30px" }}
      >
        <Flag className="h-4 w-4" aria-hidden />
      </Button>
      <KeepDayDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
