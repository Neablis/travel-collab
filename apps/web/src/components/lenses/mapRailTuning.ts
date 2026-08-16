// Every "feel" constant for the map rail's scroll-driven focus lives here, in
// one place, so the UX sweet spot can be found by turning knobs rather than by
// editing selection logic. Which knob to turn for which symptom is documented
// in docs/specs/2026-08-16-map-rail-focus-tracking-design.md ("Tuning").
export type MapRailTuning = {
  /** Pixels of scroll travel per day of focus change. The primary feel knob. */
  scrollPxPerDay: number;
  /**
   * Where the focus line sits within the rail's viewport at each end of the
   * scroll, as a 0..1 fraction (0 = rail top, 1 = rail bottom). The line sweeps
   * between them as scrolling progresses.
   *
   * A *fixed* line (start === end) cannot reach every day: with 14 x 95px
   * buttons in a 600px rail there is only 730px of natural travel but a day
   * change costs 95px of it, so a fixed centre line reaches days 4-11 and
   * silently skips the rest. Sweeping 0 -> 1 makes the line traverse the whole
   * content, giving every day an equal share. See the spec's "Defect 4".
   */
  focusLineStart: number;
  focusLineEnd: number;
  /** How often scroll-driven focus re-evaluates, in ms. */
  scrollThrottleMs: number;
  /** Tolerance for "scrolled to the very top/bottom", in px. */
  boundaryEpsilonPx: number;
};

export const MAP_RAIL_TUNING_DEFAULTS: MapRailTuning = {
  scrollPxPerDay: 240,
  focusLineStart: 0,
  focusLineEnd: 1,
  scrollThrottleMs: 50,
  boundaryEpsilonPx: 4,
};

let override: Partial<MapRailTuning> | null = null;
const listeners = new Set<() => void>();

export function readMapRailTuning(): MapRailTuning {
  return override === null ? MAP_RAIL_TUNING_DEFAULTS : { ...MAP_RAIL_TUNING_DEFAULTS, ...override };
}

export function setMapRailTuning(next: Partial<MapRailTuning> | null): MapRailTuning {
  override = next;
  for (const listener of listeners) listener();
  return readMapRailTuning();
}

/** Subscribe to live tuning changes. Returns an unsubscribe function. */
export function onMapRailTuningChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

declare global {
  // `var` is how TS augments globalThis; the project's `no-var` rule isn't
  // enabled, so no disable comment is needed here.
  var __tuneMapRail: ((next?: Partial<MapRailTuning> | null) => MapRailTuning) | undefined;
}

// Dev-only console handle, so tuning is a one-liner with no rebuild:
//   __tuneMapRail({ scrollPxPerDay: 320 })  -> merge and apply immediately
//   __tuneMapRail()                         -> print the current values
//   __tuneMapRail(null)                     -> reset to defaults
// Stripped from production builds by the NODE_ENV guard.
if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") {
  globalThis.__tuneMapRail = (next) => {
    if (next === undefined) return readMapRailTuning();
    return setMapRailTuning(next === null ? null : { ...override, ...next });
  };
}
