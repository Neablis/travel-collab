import { sparklineColorFor } from "@/lib/sparklineColor";

// The "shape of the trip" sparkline (README §1 next-trip hero): one bar per
// stop, grouped into one visual column per real trip day — a day's column
// width reflects how many stops it has, and every real day gets its own
// column even with zero stops (previously a day with no stops contributed
// zero bars and silently vanished from the sparkline entirely, with nothing
// marking that the day even existed — the bug behind a 4-day trip only
// ever showing 3 groups). This component only knows each stop's real
// duration (minutes, or null when the activity has no timeWindow to derive
// one from), each day's real city, and each day's real day-of-month number
// (or null when the day has no date set, rendered as that day's 1-indexed
// position instead); mapping a real
// TripDetail into that shape is the caller's job (NextTripHero.tsx, reusing
// DayChips.tsx's `cityFor`/`parseLocalDate`), keeping this component free
// of the `packages/contracts` dependency.
export type SparklineStop = { durationMinutes: number | null };
export type SparklineDay = { city: string | null; dayNumber: number | null; stops: SparklineStop[] };

export type SparklineBar = {
  key: string;
  /** 0-100: the percentage of the group's fixed height this bar fills. */
  heightPct: number;
};

export type SparklineDayGroup = {
  key: string;
  dayNumber: number | null;
  color: string;
  bars: SparklineBar[];
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
export function shapeOf(days: SparklineDay[]): SparklineDayGroup[] {
  let maxDuration = 0;
  for (const day of days) {
    for (const stop of day.stops) {
      if (stop.durationMinutes !== null) maxDuration = Math.max(maxDuration, stop.durationMinutes);
    }
  }

  return days.map((day, dayIndex) => ({
    key: String(dayIndex),
    dayNumber: day.dayNumber,
    color: sparklineColorFor(day.city),
    bars: day.stops.map((stop, stopIndex) => ({
      key: `${dayIndex}-${stopIndex}`,
      heightPct:
        stop.durationMinutes === null || maxDuration === 0
          ? HEIGHT_FLOOR_PCT
          : Math.max(HEIGHT_FLOOR_PCT, (stop.durationMinutes / maxDuration) * 100),
    })),
  }));
}

export type CitySegment = { key: string; label: string };

// Every distinct city visited anywhere in the trip, in first-appearance
// order, each with a count of how many stops (not days) happened there —
// not grouped by contiguous same-city day runs, so a city revisited later
// in the trip (a return leg) still counts as one line, not two. A day with
// no known city (no located activity yet) contributes nothing, rather than
// a fabricated "Unknown" entry.
export function citySegmentsFor(days: SparklineDay[]): CitySegment[] {
  const counts = new Map<string, number>();
  for (const day of days) {
    if (day.city === null) continue;
    counts.set(day.city, (counts.get(day.city) ?? 0) + day.stops.length);
  }
  return Array.from(counts, ([city, count]) => ({ key: city, label: `${city} · ${count}` }));
}

export type SparklineProps = { days: SparklineDay[] };

// README §1: "Shape of the trip" — right panel of the next-trip hero.
// Structure: a 64px-tall row of day columns (each `flex: max(stops, 1)`, so
// an empty day still reserves its own blank slot rather than collapsing to
// nothing; a day's own stops render flush against each other with no gap —
// one column per day, a stepped skyline of that day's stops, not one column
// per stop), a day-number label under each column (real date-of-month, or
// the day's 1-indexed position when it has no date), and — when at least
// one day has a known city — a row listing every distinct city visited
// with its stop count underneath ("Tokyo · 6"), not a per-day-run legend.
export function Sparkline({ days }: SparklineProps) {
  const groups = shapeOf(days);
  const segments = citySegmentsFor(days);

  return (
    <div className="flex flex-col gap-3" role="group" aria-label="Shape of the trip">
      <div className="flex flex-col gap-1.5">
        <div
          className="flex h-16 items-end rounded-xl bg-moss p-2"
          // eslint-disable-next-line no-restricted-syntax -- 10px day-group gap is the handoff's exact spec value, matching Sparkline's prior computed-geometry escape hatch
          style={{ gap: "10px" }}
        >
          {groups.map((group) => (
            <div
              key={group.key}
              className="flex h-full items-end overflow-hidden rounded-sm"
              // eslint-disable-next-line no-restricted-syntax -- flex-grow shares row width by real stop count (min 1, so an empty day still reserves a blank slot instead of vanishing); no gap between a day's own bars — they're one column, a stepped skyline of that day's stops, not separate columns of their own
              style={{ flex: `${Math.max(group.bars.length, 1)} 1 0%` }}
            >
              {group.bars.map((bar) => (
                <span
                  key={bar.key}
                  aria-hidden
                  className="flex-1"
                  // eslint-disable-next-line no-restricted-syntax -- height/color are per-stop computed data (real duration, hashed city), not design constants
                  style={{ height: `${bar.heightPct}%`, backgroundColor: group.color }}
                />
              ))}
            </div>
          ))}
        </div>
        <div
          className="flex"
          // eslint-disable-next-line no-restricted-syntax -- matches the bar row's own 10px day-group gap so labels stay aligned under their column
          style={{ gap: "10px" }}
        >
          {groups.map((group, index) => (
            <div
              key={group.key}
              className="text-center font-mono text-xs text-slate"
              // eslint-disable-next-line no-restricted-syntax -- flex-grow shares label-row width by real stop count, matching the bar row's own per-day flex-basis so labels stay aligned under their column
              style={{ flex: `${Math.max(group.bars.length, 1)} 1 0%` }}
            >
              {/* Real date-of-month when the day has one; otherwise its
                  1-indexed position in the trip — a number either way, not
                  a bare dash, for a trip with no dates set at all. */}
              {group.dayNumber ?? index + 1}
            </div>
          ))}
        </div>
      </div>
      {segments.length > 0 && (
        <div className="flex flex-wrap gap-1.5" role="list" aria-label="Cities visited">
          {segments.map((segment) => (
            <span
              key={segment.key}
              role="listitem"
              className="rounded-full border border-hairline bg-surface px-2.5 py-1 text-xs text-ink"
            >
              {segment.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
