import { sparklineColorFor } from "@/lib/sparklineColor";

// The "shape of the trip" sparkline (README §1 next-trip hero): one bar per
// stop (not per day), in day order, so a day's width in the row reflects how
// many stops it has. This component only knows each stop's real duration (in
// minutes, or null when the activity has no timeWindow to derive one from)
// and each day's real city; mapping a real TripDetail into that shape is the
// caller's job (NextTripHero.tsx, reusing DayChips.tsx's `cityFor`), keeping
// this component free of the `packages/contracts` dependency.
export type SparklineStop = { durationMinutes: number | null };
export type SparklineDay = { city: string | null; stops: SparklineStop[] };

export type SparklineBar = {
  key: string;
  /** 0-100: the percentage of the container's fixed height this bar fills. */
  heightPct: number;
  /** True for the first bar of a day after the first — the day-boundary gap
   * (an extra 10px margin, on top of the row's own 4px bar gap) that visibly
   * separates one day's stops from the next. */
  breakBefore: boolean;
  color: string;
};

// A stop with no real duration data still needs a visible bar — flooring it
// (rather than, say, defaulting to some fabricated "average" height) keeps
// every rendered bar honestly grounded in either a real duration or the
// floor, never an invented in-between number.
const HEIGHT_FLOOR_PCT = 35;

// Pure: no DOM, fully testable standalone. Height is each stop's real
// duration normalized against the trip's single longest stop (clamped at the
// floor so a short stop, e.g. a 20-minute coffee next to a 4-hour museum
// visit, stays visible rather than collapsing to a sliver); a day with zero
// located-in-time stops (or a trip where nothing has a real duration at all)
// falls back to the floor for every bar rather than fabricating variation.
export function shapeOf(days: SparklineDay[]): SparklineBar[] {
  let maxDuration = 0;
  for (const day of days) {
    for (const stop of day.stops) {
      if (stop.durationMinutes !== null) maxDuration = Math.max(maxDuration, stop.durationMinutes);
    }
  }

  const bars: SparklineBar[] = [];
  days.forEach((day, dayIndex) => {
    const color = sparklineColorFor(day.city);
    day.stops.forEach((stop, stopIndex) => {
      const heightPct =
        stop.durationMinutes === null || maxDuration === 0
          ? HEIGHT_FLOOR_PCT
          : Math.max(HEIGHT_FLOOR_PCT, (stop.durationMinutes / maxDuration) * 100);
      bars.push({
        key: `${dayIndex}-${stopIndex}`,
        heightPct,
        breakBefore: dayIndex > 0 && stopIndex === 0,
        color,
      });
    });
  });
  return bars;
}

export type SparklineProps = { days: SparklineDay[] };

// README §1: "Shape of the trip" sparkline — right panel of the next-trip
// hero, on a `--color-moss` background, 64px tall (the home-card size; a
// detail-view usage would be 72px, matching PlaybookCard.tsx's own shape
// strip — no such usage exists yet, so this doesn't take a height prop
// until one does). A single flex row (not one container per day): every
// bar is `flex: 1`, so day widths fall out naturally from stop counts
// rather than being forced equal, and `breakBefore`'s extra margin is what
// actually marks day boundaries. Each bar is colored by its own day's real
// city (lib/sparklineColor.ts) so the sparkline previews the same per-day
// color language used elsewhere, without needing a per-day wrapper element.
export function Sparkline({ days }: SparklineProps) {
  const bars = shapeOf(days);

  return (
    <div
      className="flex h-16 items-end rounded-xl bg-moss p-2"
      // eslint-disable-next-line no-restricted-syntax -- 4px bar gap is the handoff's exact spec value, matching Sparkline's prior computed-geometry escape hatch
      style={{ gap: "4px" }}
      role="group"
      aria-label="Shape of the trip"
    >
      {bars.map((bar) => (
        <span
          key={bar.key}
          aria-hidden
          className="flex-1 rounded-sm"
          // eslint-disable-next-line no-restricted-syntax -- height/color are per-stop computed data (real duration, hashed city), not design constants; marginLeft is the handoff's exact 10px day-break spec value
          style={{
            height: `${bar.heightPct}%`,
            backgroundColor: bar.color,
            marginLeft: bar.breakBefore ? "10px" : undefined,
          }}
        />
      ))}
    </div>
  );
}
