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
