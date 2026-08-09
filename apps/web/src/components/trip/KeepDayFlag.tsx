import { Flag } from "lucide-react";
import { Button } from "@/components/ui/button";
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
};

// Handoff README "Keep this day": an icon-only pennant, 30px circle,
// `--color-surface` background, glyph tinted in the day's ink color. This
// shell is deliberately inert — the caller (TimelineLens) always renders it
// inside <Preview id="keep-day-flag"> (Task 3's seam), which shields pointer
// events and stamps the "Preview · M11" chip, so no onClick is wired here.
// Task 17 adds the real "Keep this day" dialog and click behavior; until
// then this only establishes the day header's visual affordance.
export function KeepDayFlag({ dayIndex, accent }: { dayIndex: number; accent: AccentFamily }) {
  return (
    <Button
      variant="secondary"
      aria-label={`Keep day ${dayIndex + 1}`}
      className={cn(
        "h-[30px] w-[30px] shrink-0 rounded-full border-transparent bg-surface p-0 hover:bg-surface",
        INK_TEXT[accent],
      )}
    >
      <Flag className="h-4 w-4" aria-hidden />
    </Button>
  );
}
