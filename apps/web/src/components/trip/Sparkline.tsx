import { UNKNOWN_CITY_COLOR, sparklineColorsFor } from "@/lib/sparklineColor";

// The "shape of the trip" graph (README §1 next-trip hero): one equal-width
// column per real trip day, built from one equal-height block per stop that
// day, stacked bottom-up and colored by that day's real city. Height means
// COUNT — the busiest day is the tallest column, a day with one stop is the
// shortest — not duration. (It did mean duration once: bars sat side by side
// within a day at a height normalized against the trip's longest stop. That
// read as a stepped skyline where a single long museum visit out-ranked a
// packed day of short ones, which is the opposite of the "how full is each
// day" question this panel exists to answer.)
//
// Every real day gets its own column even with zero stops — an empty slot
// under its own day number, rather than silently vanishing from the graph
// with nothing marking that the day existed at all.
//
// This component only knows each day's real city and its real stop count;
// mapping a real TripDetail into that shape is the caller's job
// (NextTripHero.tsx, reusing DayChips.tsx's `cityFor`), keeping this
// component free of the `packages/contracts` dependency.
export type SparklineDay = { city: string | null; stopCount: number };

export type SparklineDayGroup = {
  key: string;
  /** 1-indexed position in the trip — "day 3 of the trip", not a calendar date. */
  dayLabel: number;
  color: string;
  blockCount: number;
};

// Pure: no DOM, fully testable standalone. One group per day, in trip order.
// Colors come from one whole-trip assignment (sparklineColorsFor) rather than
// per-city lookups, so every distinct city in this trip gets its own palette
// slot — a per-day lookup can't see the other days and so can't guarantee
// that.
export function shapeOf(days: SparklineDay[]): SparklineDayGroup[] {
  const colors = sparklineColorsFor(days.map((day) => day.city));

  return days.map((day, index) => ({
    key: String(index),
    dayLabel: index + 1,
    color: day.city === null ? UNKNOWN_CITY_COLOR : colors.get(day.city)!,
    blockCount: day.stopCount,
  }));
}

// The graph's fixed drawing height. The card must not change size with the
// trip (the hero sits in a grid row shared with the left column) and the
// tallest column must never grow up through the panel heading or down
// through the city pills, so the blocks scale to the area rather than the
// area growing to the blocks.
export const CHART_HEIGHT_PX = 96;

// Ceiling on a single block. Without it a 2-stop trip would divide the whole
// 96px between two blocks and render two 46px slabs; capping keeps a block
// reading as a block, and the short column simply leaves headroom above it.
//
// The cap is what governs how a SPARSE trip looks, so it's set generously:
// at 10px a 2-stop-max trip drew 24px of graph inside a 96px panel and read
// as crumbs at the bottom of an empty box. At 20px the same trip fills
// roughly half its area and reads as a deliberately small graph. Some
// headroom on a sparse trip is the deliberate cost of a card whose height
// doesn't change from trip to trip.
const MAX_BLOCK_PX = 20;

// Floor on a single block, so a genuinely packed day (20+ stops) still
// renders something visible per stop instead of collapsing to nothing. Past
// that density the column overshoots CHART_HEIGHT_PX rather than rendering
// invisible stops — an honest overflow of a very full day beats pretending
// the stops aren't there.
const MIN_BLOCK_PX = 2;

// Ceiling on the gap between two blocks in a column. Below the cap the gap
// scales with the block so a dense column stays legible as separate blocks
// rather than a solid bar; the cap tracks MAX_BLOCK_PX so a capped block
// keeps the same block-to-gap rhythm a scaled one has.
const MAX_GAP_PX = 6;

export type BlockMetrics = { blockHeight: number; gap: number };

// Pure geometry: how tall each block is, and how much air sits between two
// of them, given the busiest day in the trip. Every column shares one set of
// metrics — that's what makes the columns comparable at a glance, since a
// day with twice the stops is then exactly twice as tall.
export function blockMetricsFor(maxBlocks: number): BlockMetrics {
  if (maxBlocks <= 0) return { blockHeight: 0, gap: 0 };

  // Each block owns an equal slice of the drawing height, and gives back a
  // share of its own slice as the gap below it.
  const unit = CHART_HEIGHT_PX / maxBlocks;
  const gap = Math.min(MAX_GAP_PX, unit * 0.35);
  const blockHeight = Math.min(MAX_BLOCK_PX, Math.max(MIN_BLOCK_PX, unit - gap));

  // A capped block doesn't need the full scaled gap — pair the 10px ceiling
  // with the 4px gap ceiling so short trips render at the design's own
  // block/gap rhythm instead of a stretched-out one.
  return { blockHeight, gap: blockHeight === MAX_BLOCK_PX ? MAX_GAP_PX : gap };
}

// Widest a single block may draw. A 4-day trip splits the hero panel into
// four ~190px columns; left uncapped, each block would render as a wide slab
// that reads as a bar chart rather than a stack of stops. Blocks center in
// their column, so the columns stay evenly spaced either way.
//
// This is the other half of how a sparse trip fills its space: the cap only
// binds on FEW-day trips (a 14-day trip's columns are narrower than this on
// their own), so raising it widens exactly the short trips that looked thin
// and leaves dense ones untouched.
const MAX_BLOCK_WIDTH_PX = 72;

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
    counts.set(day.city, (counts.get(day.city) ?? 0) + day.stopCount);
  }
  return Array.from(counts, ([city, count]) => ({ key: city, label: `${city} · ${count}` }));
}

export type SparklineProps = { days: SparklineDay[] };

// README §1: "Shape of the trip" — right panel of the next-trip hero.
// Structure: a fixed-height row of equal-width day columns (each a bottom-up
// stack of that day's stops), a trip-day number under each column, and —
// when at least one day has a known city — a row listing every distinct city
// visited with its stop count underneath ("Tokyo · 6"), not a per-day-run
// legend.
//
// The columns bottom-align for free: the row is `items-end`, so each column
// is exactly as tall as its own blocks and sits on the row's baseline. No
// percentage heights, no absolute positioning, no per-column offset math.
export function Sparkline({ days }: SparklineProps) {
  const groups = shapeOf(days);
  const segments = citySegmentsFor(days);
  const { blockHeight, gap } = blockMetricsFor(Math.max(0, ...groups.map((group) => group.blockCount)));

  return (
    <div className="flex flex-col gap-3" role="group" aria-label="Shape of the trip">
      <div className="flex flex-col gap-1.5">
        <div
          className="flex items-end gap-1.5"
          // eslint-disable-next-line no-restricted-syntax -- the graph's own computed drawing height (see CHART_HEIGHT_PX), not a design constant with a token equivalent
          style={{ height: `${CHART_HEIGHT_PX}px` }}
        >
          {groups.map((group) => (
            // An empty day renders no blocks at all — the column still holds
            // its width and its number below, so the day reads as "nothing
            // planned yet", not as a gap in the graph.
            <div
              key={group.key}
              data-testid="sparkline-day"
              className="flex min-w-0 flex-1 flex-col items-center justify-end"
              // eslint-disable-next-line no-restricted-syntax -- gap is computed per-trip block geometry (see blockMetricsFor), not a design constant with a token equivalent
              style={{ gap: `${gap}px` }}
            >
              {Array.from({ length: group.blockCount }, (_, blockIndex) => (
                <span
                  key={blockIndex}
                  aria-hidden
                  className="w-full shrink-0 rounded-sm"
                  // eslint-disable-next-line no-restricted-syntax -- height/width/color are computed per-trip data (scaled block geometry, hashed city), not design constants
                  style={{
                    height: `${blockHeight}px`,
                    maxWidth: `${MAX_BLOCK_WIDTH_PX}px`,
                    backgroundColor: group.color,
                  }}
                />
              ))}
            </div>
          ))}
        </div>
        <div className="flex gap-1.5">
          {groups.map((group) => (
            <div key={group.key} className="min-w-0 flex-1 text-center font-mono text-xs text-slate">
              {/* The day's 1-indexed position in the trip — "day 3", not the
                  calendar date of the 3rd day, which read as though the trip
                  started on day 2. */}
              {group.dayLabel}
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
