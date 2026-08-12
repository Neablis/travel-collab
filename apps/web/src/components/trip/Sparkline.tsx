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
// (or null when the day has no date set, rendered as "—"); mapping a real
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

// Contiguous same-city day runs, in trip order — "Tokyo · 5 nights" for a
// multi-day stay, "Nikkō day trip" for a single-day one. A run with no known
// city (no located activity yet) is skipped rather than rendering a
// fabricated "Unknown" pill.
export function citySegmentsFor(days: SparklineDay[]): CitySegment[] {
  const segments: CitySegment[] = [];
  let i = 0;
  while (i < days.length) {
    const city = days[i]!.city;
    let span = 1;
    while (i + span < days.length && days[i + span]!.city === city) span++;
    if (city !== null) {
      segments.push({ key: String(i), label: span === 1 ? `${city} day trip` : `${city} · ${span} nights` });
    }
    i += span;
  }
  return segments;
}

export type SparklineProps = { days: SparklineDay[] };

// README §1: "Shape of the trip" — right panel of the next-trip hero.
// Structure: a 64px-tall row of day columns (each `flex: max(stops, 1)`, so
// an empty day still reserves its own blank slot rather than collapsing to
// nothing), a day-number label under each column (real date-of-month, or
// "—" when the day has no date), and — when at least one day has a known
// city — a row of city-segment pills underneath, matching the handoff's
// "Tokyo · 5 nights" / "Nikkō day trip" summary row.
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
              className="flex h-full items-end"
              // eslint-disable-next-line no-restricted-syntax -- 4px within-day bar gap is the handoff's exact spec value; flex-grow shares row width by real stop count (min 1, so an empty day still reserves a blank slot instead of vanishing)
              style={{ gap: "4px", flex: `${Math.max(group.bars.length, 1)} 1 0%` }}
            >
              {group.bars.map((bar) => (
                <span
                  key={bar.key}
                  aria-hidden
                  className="flex-1 rounded-sm"
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
          {groups.map((group) => (
            <div
              key={group.key}
              className="text-center font-mono text-xs text-slate"
              // eslint-disable-next-line no-restricted-syntax -- flex-grow shares label-row width by real stop count, matching the bar row's own per-day flex-basis so labels stay aligned under their column
              style={{ flex: `${Math.max(group.bars.length, 1)} 1 0%` }}
            >
              {group.dayNumber ?? "—"}
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
