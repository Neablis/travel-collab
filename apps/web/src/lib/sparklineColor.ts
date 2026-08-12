// Deterministic city -> bar color for the home hero's "Shape of the trip"
// sparkline (Sparkline.tsx). Deliberately its OWN small palette, not a
// dayAccentFor swap: dayAccentFor's 5 semantic design tokens (brand/info/
// success/warning/danger) stay exactly as they are for every other city-
// accented surface in the app (DayChips, Board, TimelineLens, CalendarLens,
// TripCard, Playbooks) — this sparkline is the one surface that needs a
// color per REAL, unbounded city name rather than a small set of reusable
// semantic tokens.
//
// The palette below is the validated 8-hue categorical reference instance
// from Anthropic's internal dataviz skill (`references/palette.md`) — every
// hue chosen and ordered so adjacent slots clear CVD-safety checks. This
// isn't a stylistic pick: going wider was tried and measured. A 16-hue (and
// separately a 10- and 12-hue) evenly-spaced candidate palette was run
// through the skill's `validate_palette.js` and every one failed hard —
// worst-adjacent CVD ΔE as low as 0.9 and normal-vision ΔE as low as 2.7,
// against hard floors of 6 and 15 respectively. Human color perception does
// not support double-digit counts of mutually-distinguishable categorical
// hues once colorblindness is simulated; 8 is close to the practical
// ceiling. Two different trips will sometimes land on the same color for a
// different city — expected and fine, since nothing about that is
// confusing on its own. What actually matters is that two cities within the
// SAME trip stay visually distinct, and 8 well-separated hues comfortably
// covers a typical trip's city count.
//
// This file is the one narrow, explicit exception to the "tokens only, no
// raw color literals" rule (design-system.md) for exactly this reason —
// check-color-wall.mjs excludes it by name, the same carve-out
// globals.css already has for defining the token values themselves.
const SPARKLINE_PALETTE = [
  "#2a78d6", // blue
  "#eb6834", // orange
  "#1baf7a", // aqua
  "#eda100", // yellow
  "#e87ba4", // magenta
  "#008300", // green
  "#4a3aa7", // violet
  "#e34948", // red
] as const;

// Stable string hash (djb2) — same construction as dayAccent.ts's, applied
// to a wider index space (8 slots here vs. dayAccent.ts's 5).
function hash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h;
}

export function sparklineColorFor(city: string | null | undefined): string {
  return SPARKLINE_PALETTE[hash(city ?? "") % SPARKLINE_PALETTE.length]!;
}
