// The account page's small formatters and its one chart rule (M36 link 3).
//
// **Dates in UTC, on purpose.** The page is server-rendered and its grant
// cards hydrate in the browser; a date formatted in two time zones is a
// hydration mismatch and, worse, two answers. The 30-day series are trailing
// 24-hour buckets ending at the read (`windowDayOf`), so "today" here is "the
// last 24 hours", which is what the bars mean too.

const DAY_MS = 24 * 60 * 60 * 1000;

/** Above this many input tokens a step's context is drawn in danger ink (spec). */
export const CONTEXT_DANGER_TOKENS = 24_000;

/** Whole 24-hour periods between `iso` and `now`. */
export function daysAgo(iso: string, now: string): number {
  return Math.floor((Date.parse(now) - Date.parse(iso)) / DAY_MS);
}

/** `Oct 3`, in UTC. */
export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** `Today`, `Yesterday`, or `Oct 3` — the date column of every list on the page. */
export function dayLabel(iso: string, now: string): string {
  const days = daysAgo(iso, now);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return shortDate(iso);
}

/** A plan version reference as a person reads it: `plus@v2` → `plus v2`. */
export function spokenRef(ref: string): string {
  return ref.replace("@", " ");
}

/** A token count at a glance: `800`, `5.2k`, `26k`. */
export function tokens(count: number): string {
  if (count < 1000) return String(count);
  const thousands = count / 1000;
  return `${thousands < 10 ? thousands.toFixed(1).replace(/\.0$/, "") : Math.round(thousands)}k`;
}

/** Milliseconds as `2.4s`. */
export function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * **How the questions-a-day bars are scaled against the plan's ceiling** (spec,
 * *Questions a day*).
 *
 *   * No ceiling (`null` — no version names one) → `uncapped`: scale to the data.
 *   * A ceiling of `0` → `none`: what they hold now allows no questions (the
 *     quota gate lets nothing through), so there is no line to draw and no
 *     "well above" to say — but it is a ceiling, not the absence of one.
 *   * Peak over 40% of the ceiling → `near`: the scale is the ceiling × 1.1, the
 *     ceiling draws as a line, and days AT it are danger bars. The ceiling is a
 *     hard cap, so "at" is the top of what a day can be.
 *   * Otherwise → `far`: scale to the data, no line, and the label says how
 *     far above this the ceiling sits — a line pinned to the top would flatten
 *     every bar into the floor.
 */
export type CeilingRule =
  | { mode: "uncapped"; scale: number }
  | { mode: "none"; scale: number }
  | { mode: "far"; scale: number; ceiling: number }
  | { mode: "near"; scale: number; ceiling: number; daysAtCeiling: number };

/** Decide the rule for one account's 30 days. */
export function ceilingRule(perDay: readonly number[], ceiling: number | null): CeilingRule {
  const peak = Math.max(0, ...perDay);
  const dataScale = Math.max(1, peak * 1.2);
  if (ceiling === null) return { mode: "uncapped", scale: dataScale };
  if (ceiling <= 0) return { mode: "none", scale: dataScale };
  if (peak > ceiling * 0.4) {
    return {
      mode: "near",
      scale: ceiling * 1.1,
      ceiling,
      daysAtCeiling: perDay.filter((count) => count >= ceiling).length,
    };
  }
  return { mode: "far", scale: dataScale, ceiling };
}
