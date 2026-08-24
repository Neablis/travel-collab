// The add-stop sheet's "How long" dropdown (Phase 7, Task 7.1) offers five
// fixed durations rather than a free-form end time — create mode computes
// `end = start + minutes` from whichever one is picked. `Half day` is 4
// hours (design's own literal), the rest are the label's own number.
export const DURATION_OPTIONS = [
  { label: "30 min", minutes: 30 },
  { label: "1 hour", minutes: 60 },
  { label: "1.5 hours", minutes: 90 },
  { label: "2 hours", minutes: 120 },
  { label: "Half day", minutes: 240 },
] as const;

export type DurationLabel = (typeof DURATION_OPTIONS)[number]["label"];

export const DEFAULT_DURATION_LABEL: DurationLabel = "1 hour";

const MINUTES_BY_LABEL: Record<DurationLabel, number> = Object.fromEntries(
  DURATION_OPTIONS.map((o) => [o.label, o.minutes]),
) as Record<DurationLabel, number>;

export function durationMinutes(label: DurationLabel): number {
  return MINUTES_BY_LABEL[label];
}

// Reverse mapping for prefilled create-mode windows (e.g. TimelineLens's
// nextSlot): a prefilled duration has no guarantee of landing on one of the
// five options (a rack-fitted slot can be 45 minutes), so this picks the
// closest one instead of failing to render a selection at all.
//
// Tie-break: strictly-less-than only replaces the running best, and
// DURATION_OPTIONS is already ascending by minutes, so on an exact tie
// (e.g. 75 sits equidistant from 60 and 90) the shorter option wins without
// any special-cased comparison — a shorter default undersells rather than
// oversells the fitted window.
export function closestDurationLabel(minutes: number): DurationLabel {
  let best: DurationLabel = DURATION_OPTIONS[0].label;
  let bestDiff = Math.abs(minutes - DURATION_OPTIONS[0].minutes);
  for (const option of DURATION_OPTIONS.slice(1)) {
    const diff = Math.abs(minutes - option.minutes);
    if (diff < bestDiff) {
      best = option.label;
      bestDiff = diff;
    }
  }
  return best;
}
