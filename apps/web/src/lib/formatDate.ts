import { ordinal } from "@tc/pages";

// Dates are calendar dates (YYYY-MM-DD), not instants — construct in local time
// so "2026-01-01" never renders as Dec 31 in a negative-offset zone.
function parse(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
}
export function formatTripDate(iso: string): string {
  return parse(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}
/**
 * "Tue 5" — weekday and day-of-month, no month.
 *
 * The Map rail's non-boundary rows (M26 link 5b). `formatTripDate` prints the
 * month on every row, which repeats "Sep" down a September trip and says
 * nothing; `monthEdges` decides which rows earn the longer form and those use
 * `formatTripDate` instead.
 */
export function formatTripDateNoMonth(iso: string): string {
  return parse(iso).toLocaleDateString("en-US", { weekday: "short", day: "numeric" });
}
export function formatTripDateLong(iso: string): string {
  return parse(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}
// Derived-end label only (TripDateControl's "→ Oct 16, 2026", …dc.html:1122):
// no weekday — the date alone is the point, not which day it falls on.
export function formatTripDateWithYear(iso: string): string {
  return parse(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/**
 * An INSTANT (ISO 8601 with a time and a zone) as "August 31st 2026".
 *
 * Deliberately not one of the four above: those take a calendar date and parse
 * it in local time on purpose, and handing one of them an instant would drop
 * the zone on the floor. This one lets `Date` parse the instant properly and
 * then renders it in the reader's own zone — which is right, because the thing
 * being described ("you took this copy on…") happened at a moment, not on a
 * date somebody chose.
 *
 * Ordinal day, because the request asked for one (Mitchell, 2026-09-01:
 * *"just show the copied from day ... On August 31st 2026"*), reusing
 * `ordinalDayOfMonth` rather than a second suffix table.
 */
export function formatInstantLong(iso: string): string | null {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  const month = at.toLocaleDateString("en-US", { month: "long" });
  return `${month} ${ordinalDayOfMonth(at.getDate())} ${at.getFullYear()}`;
}

// "14th", for the Calendar cell's date-and-day line ("14th · Day 6"). The
// suffix table is `@tc/pages`' `ordinal`, which the spend chart's axis also
// reads ("1st", "2nd"), so the two cannot disagree about the teens.
export function ordinalDayOfMonth(dayOfMonth: number): string {
  return ordinal(dayOfMonth);
}

/**
 * An INSTANT as "4 hours ago" / "2 days ago", for the Notebook index's
 * freshness line (SPEC §7).
 *
 * `Intl.RelativeTimeFormat` rather than a hand-rolled ladder of thresholds:
 * it owns the pluralisation and the "yesterday"/"last month" wordings, and it
 * is the same class of API as the `toLocaleDateString` calls above. What is
 * hand-rolled is only the choice of UNIT, which `Intl` does not do — it
 * formats the number and unit you hand it.
 *
 * `numeric: "auto"` is what turns -1 day into "yesterday" rather than
 * "1 day ago". That is the wording a person uses, and the freshness line is
 * prose, not a data readout.
 *
 * `now` is injected rather than read from the clock so a test can assert a
 * string instead of asserting against `Date.now()` twice and hoping the
 * second call lands in the same second.
 */
const RELATIVE = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });

// Descending, so the first unit the elapsed time reaches is the one used.
// Months are 30 days and years 365: a freshness line is an approximation by
// construction ("2 months ago" is not a claim about which months), and a
// calendar-exact version would still render the same words.
const UNITS: readonly [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 60 * 60 * 1000],
  ["month", 30 * 24 * 60 * 60 * 1000],
  ["day", 24 * 60 * 60 * 1000],
  ["hour", 60 * 60 * 1000],
  ["minute", 60 * 1000],
];

export function formatRelativeInstant(iso: string, now: Date = new Date()): string | null {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  // Clamped at zero, so nothing in the future is ever formatted. A row can
  // carry a server timestamp ahead of the reader's clock — a second or two from
  // ordinary skew, hours if a machine's clock is wrong — and "edited in 2
  // hours" is a bug report, not a freshness line. Clamping says "just now",
  // which is both the least wrong thing available and what the reader would
  // conclude anyway.
  //
  // This is deliberately a clamp rather than a symmetric `Math.abs`: absolute
  // elapsed time would render a clock-skewed row as "2 hours ago", inventing a
  // past that is just as false as the future it avoided.
  const elapsedMs = Math.max(0, now.getTime() - at.getTime());
  for (const [unit, ms] of UNITS) {
    if (elapsedMs >= ms) return RELATIVE.format(-Math.round(elapsedMs / ms), unit);
  }
  // Below the smallest unit above.
  return "just now";
}

/**
 * **How far off a calendar date is, in the reader's own words** — the next-trip
 * countdown (DRIFT D6, `dc.html:9486`/`:8973`, M26 link 9d).
 *
 * `relDays` in the artboard, kept to its five cases and its exact wording:
 * `today`, `tomorrow`, `yesterday`, `in N days`, `N days ago`. Two days out in
 * either direction is where the word form stops carrying and the number starts.
 *
 * **Calendar days, counted in UTC, from two calendar dates.** Both sides are
 * reduced to a UTC midnight, so the difference is an exact multiple of 86.4M ms
 * whatever the reader's zone.
 *
 * **To be precise about what that buys**, because the obvious claim is wrong:
 * a LOCAL-time subtraction across a DST transition is 23 or 25 hours rather
 * than 24, and `Math.round` absorbs that — an hour of error over a span of days
 * never changes the answer. Local arithmetic would in fact pass every test in
 * `relativeCalendarDays.test.ts`, DST cases included. The point of UTC here is
 * that the subtraction is exact instead of merely being rescued by the
 * rounding, so a later change to the rounding cannot quietly introduce a
 * twice-a-year off-by-one.
 *
 * The rest of this file parses in LOCAL time on purpose, because those
 * functions render a date; this one measures a distance between two.
 *
 * Returns `null` for an unparseable input rather than a wrong number: an
 * invented countdown beside a real date is worse than no countdown.
 */
export function relativeCalendarDays(iso: string, todayIso: string): string | null {
  const utcDay = (value: string): number | null => {
    const parts = value.split("-").map(Number);
    if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
    const [y, m, d] = parts as [number, number, number];
    const at = Date.UTC(y, m - 1, d);
    // `Date.UTC` happily rolls 2026-13-40 over into a real date; re-deriving
    // the parts is what tells a typo from a date.
    const round = new Date(at);
    if (round.getUTCFullYear() !== y || round.getUTCMonth() !== m - 1 || round.getUTCDate() !== d) {
      return null;
    }
    return at;
  };
  const from = utcDay(todayIso);
  const to = utcDay(iso);
  if (from === null || to === null) return null;
  const days = Math.round((to - from) / 86_400_000);
  if (days <= -2) return `${Math.abs(days)} days ago`;
  if (days === -1) return "yesterday";
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
}
