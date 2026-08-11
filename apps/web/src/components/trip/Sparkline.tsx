import { Button } from "@/components/ui/button";
import { dayAccentFor, type AccentFamily } from "@/lib/dayAccent";
import { cn } from "@/lib/cn";

// Tailwind (v4, `@theme`-driven) only emits utilities for class names it can
// find as literal text in source — a template-interpolated `bg-${family}`
// never appears as a whole string anywhere and would silently fail to
// generate the rule. This mirrors the same static-map pattern `badge.tsx`
// uses for its variant → class lookup.
const BAR_BG: Record<AccentFamily, string> = {
  brand: "bg-brand",
  info: "bg-info",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
};

// The "shape of the trip" sparkline (README §1 next-trip hero): one
// clickable column per day, each column a stack of small bars — one bar
// per stop that day. This component only knows `{ stops: number, city:
// string | null }` per day; mapping a real TripDetail's days into that
// shape is the caller's job (Task 6's hero, reusing DayChips.tsx's
// `chipModel`/`cityFor` derivation), keeping this component free of the
// `packages/contracts` dependency.
export type SparklineDay = { stops: number; city: string | null };

export type SparklineBar = { key: string };

export type SparklineBarsOptions = {
  /** Cap the number of bars drawn per day, so a day with many stops doesn't
   * blow out the 96px-tall container. Undefined means "no cap". */
  maxBarsPerDay?: number;
};

// Pure: given the per-day stop counts, return one array of bars per day —
// no DOM, no random keys tied to render order, fully testable standalone.
export function sparklineBars(
  days: SparklineDay[],
  opts: SparklineBarsOptions = {},
): SparklineBar[][] {
  const { maxBarsPerDay } = opts;
  return days.map((day, dayIndex) => {
    const count = Math.max(0, maxBarsPerDay === undefined ? day.stops : Math.min(day.stops, maxBarsPerDay));
    return Array.from({ length: count }, (_, barIndex) => ({ key: `${dayIndex}-${barIndex}` }));
  });
}

export type SparklineProps = {
  days: SparklineDay[];
  onSelectDay?: (index: number) => void;
};

// README §1: "Shape of the trip" sparkline — right panel of the next-trip
// hero, on a `--color-moss` background, 96px tall. Each day is a clickable
// column of ~13px stacked bars (one per stop) with 5px gaps between both
// bars and columns; bars are tinted with that day's accent (Task 2's
// `dayAccentFor`, keyed by the day's real city, not its index — the same
// city must render the same color everywhere, matching TripCard/DayChips/
// Board/CalendarLens) so the sparkline previews the same per-day color
// language used elsewhere in the redesign.
export function Sparkline({ days, onSelectDay }: SparklineProps) {
  const columns = sparklineBars(days);

  return (
    <div
      className="flex h-24 items-end rounded-xl bg-moss p-2"
      // eslint-disable-next-line no-restricted-syntax -- 5px bar gap has no token equivalent (between gap-1/4px and gap-1.5/6px), matching TimelineLens/MapLens/ActivityCard's computed-geometry pattern
      style={{ gap: "5px" }}
      role="group"
      aria-label="Shape of the trip"
    >
      {columns.map((bars, dayIndex) => {
        const accent = dayAccentFor(days[dayIndex]?.city);
        return (
          // The Button primitive's default (secondary/md) chrome — border,
          // surface fill, fixed height, horizontal padding — is overridden
          // here via className (tailwind-merge dedupes the conflicting
          // utilities): a column has no card look of its own, just the
          // stacked bars against the shared moss background.
          <Button
            key={dayIndex}
            variant="ghost"
            aria-label={`Day ${dayIndex + 1}, ${bars.length} stop${bars.length === 1 ? "" : "s"}`}
            onClick={() => onSelectDay?.(dayIndex)}
            className="h-full flex-1 flex-col-reverse items-stretch justify-start px-0 py-0 hover:bg-transparent"
            // eslint-disable-next-line no-restricted-syntax -- 5px bar gap has no token equivalent (between gap-1/4px and gap-1.5/6px), matching TimelineLens/MapLens/ActivityCard's computed-geometry pattern
            style={{ gap: "5px" }}
          >
            {bars.map((bar) => (
              <span
                key={bar.key}
                aria-hidden
                className={cn("rounded-sm", BAR_BG[accent.solid])}
                // eslint-disable-next-line no-restricted-syntax -- 13px bar height has no token equivalent, matching TimelineLens/MapLens/ActivityCard's computed-geometry pattern
                style={{ height: "13px" }}
              />
            ))}
          </Button>
        );
      })}
    </div>
  );
}
