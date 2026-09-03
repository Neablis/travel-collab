// Dates are calendar dates (YYYY-MM-DD), not instants — construct in local time
// so "2026-01-01" never renders as Dec 31 in a negative-offset zone.
function parse(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
}
export function formatTripDate(iso: string): string {
  return parse(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
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
// suffix has to be computed rather than taken from `Intl`: en-US's
// `Intl.DateTimeFormat` has no ordinal day option, and `Intl.PluralRules`
// with `type: "ordinal"` returns the plural *category* ("one", "two",
// "few", "other"), not the suffix, so a lookup table is needed either way.
// The 11-13 exception comes before the 1/2/3 cases because 11th, 12th and
// 13th do not follow their last digit.
export function ordinalDayOfMonth(dayOfMonth: number): string {
  const teen = dayOfMonth % 100;
  if (teen >= 11 && teen <= 13) return `${dayOfMonth}th`;
  switch (dayOfMonth % 10) {
    case 1:
      return `${dayOfMonth}st`;
    case 2:
      return `${dayOfMonth}nd`;
    case 3:
      return `${dayOfMonth}rd`;
    default:
      return `${dayOfMonth}th`;
  }
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
