import type { DistanceUnit } from "@tc/contracts";

// Kilometres per mile's reciprocal, the constant the design prototype uses
// (`Trip Planner Redesign.dc.html:3916`). Kept to its digits rather than
// rounded: every distance in the app is rendered through this file, so a
// coarser constant would shift map rail totals by a visible tenth.
const MILES_PER_KM = 0.621371;
const FEET_PER_MILE = 5280;

// SPEC §12: "Miles below 0.19 render as feet; km below 1 as metres." Both
// numbers are the design's, not derived — 0.19 mi is ~1000 ft, which is where a
// decimal mile stops reading as a walk.
const FEET_BELOW_MILES = 0.19;
const METRES_BELOW_KM = 1;

// Above this the fraction is noise on a straight-line estimate, so it rounds to
// a whole unit. Applies in both systems, which is why it is one constant.
const WHOLE_UNITS_ABOVE = 10;

/**
 * The ONE place a distance becomes something to read (SPEC §12, C6).
 *
 * Every distance in the app is computed in kilometres — `haversineKm` in
 * `mapRailData.ts`, `costSubtotal`-adjacent rollups, the conflict engine — and
 * *rendered* in whatever the reader prefers. The unit is a property of the
 * person, never of the trip (`UserPreferences.distanceUnit`: "a trip does not
 * have a unit, a person does"), so it arrives here as an argument and lives
 * nowhere in the domain: `packages/domain` is pure and takes no preferences.
 *
 * A faithful port of the design prototype's own `kmLabel`, including its two
 * edges, which are deliberate and not rounding bugs to tidy:
 *
 *   * metres and feet are quantised to 50 (`350 m`, `900 ft`) — a straight-line
 *     estimate between two pins does not support a metre;
 *   * 0.999 km renders as `1000 m`, not `1.0 km`, because the branch is chosen
 *     on the kilometre value and the rounding happens after it.
 *
 * Negative input is not defended against: every caller's value is a haversine
 * distance or a sum of them, and inventing a behaviour for a distance that
 * cannot exist would be a branch no test could justify.
 */
export function kmLabel(km: number, unit: DistanceUnit): string {
  if (unit === "mi") {
    const miles = km * MILES_PER_KM;
    if (miles < FEET_BELOW_MILES) return `${quantise(miles * FEET_PER_MILE, 50)} ft`;
    return `${miles < WHOLE_UNITS_ABOVE ? miles.toFixed(1) : Math.round(miles)} mi`;
  }
  if (km < METRES_BELOW_KM) return `${quantise(km * 1000, 50)} m`;
  return `${km < WHOLE_UNITS_ABOVE ? km.toFixed(1) : Math.round(km)} km`;
}

/**
 * To the nearest `step`, which is what makes `350 m` rather than `347 m`.
 *
 * Spelled as `value / step` where the prototype divides the kilometre value by
 * 0.05 — the same arithmetic, except at an exact tie: `0.075 / 0.05` is
 * 1.4999999999999998 in binary floating point and rounds DOWN to 50 m, while
 * `75 / 50` is exactly 1.5 and rounds up to 100 m. Half-up is what "nearest 50"
 * means, so the tie is resolved here rather than by a representation artifact.
 */
function quantise(value: number, step: number): number {
  return Math.round(value / step) * step;
}
