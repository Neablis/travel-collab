// `minimumFractionDigits: 2`, explicitly, because `amountMinor` is hundredths
// for every currency here — not the ISO 4217 minor unit (ADR-008, amended
// 2026-09-07: the input multiplies by 100, the planning prompt tells the model
// to, and every reader divides by 100, whatever the currency). Left to itself
// `Intl` applies the currency's own exponent, which is 0 for JPY: it read
// hundredths as whole yen and rendered `amountMinor` 123456 as `¥1,235` here
// while `apps/web/src/components/lenses/formatMoney.ts` rendered the same
// stored field as `¥1,234.56` on the board — a notebook cost widget and the
// board disagreeing about the same number (KI-2026-09-05-y / F-G04). This is
// deliberately NOT a currency-exponent map: one is only worth building when a
// genuinely non-decimal currency is a real use case, and then it belongs at the
// input and the prompt too, not in one of two formatters.
export function formatMoney(amountMinor: number, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: 2 }).format(
    amountMinor / 100,
  );
}

export function formatDate(iso: string | null): string {
  if (iso === null) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  // Fixed UTC construction — no wall-clock read, deterministic (Invariant 4).
  const date = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(date);
}

/** `formatDate` without the year ("Jun 1"), for a cell too narrow to repeat it; `null` for no date. */
export function formatShortDate(iso: string | null): string | null {
  const ms = iso === null ? null : isoToUtcMs(iso);
  if (ms === null) return null;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(ms));
}

/**
 * Whole days from `from` to `to`, both `yyyy-mm-dd`. Negative when `to` is
 * earlier.
 *
 * `Date.UTC` on the split parts, the same construction `formatDate` uses and
 * for the same reason: no wall-clock read, no timezone, no DST. Two UTC
 * midnights are always an exact multiple of a day apart, so the division is
 * integral rather than rounded.
 */
function isoDaysBetween(from: string, to: string): number | null {
  const a = isoToUtcMs(from);
  const b = isoToUtcMs(to);
  if (a === null || b === null) return null;
  return Math.round((b - a) / 86_400_000);
}

function isoToUtcMs(iso: string): number | null {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return null;
  return Date.UTC(y, m - 1, d);
}

/**
 * Where a trip sits relative to today, as the phrase a person would say.
 *
 * **`today` is passed in, never read.** Invariant 4 — *"no wall-clock reads
 * (time is passed in)"* — and it is what keeps this testable at every branch
 * rather than only on the day the suite happens to run.
 *
 * The five states, and why each is worded the way it is:
 *
 * - **Before it starts.** "in 34 days" is the countdown people actually keep,
 *   and the two near days get their own words because "in 1 days" is wrong and
 *   "in 0 days" is not what anybody says about today.
 * - **During.** "day 3 of 14" — once a trip has started, how long until it
 *   started stops being the question, and which day of it you are on starts
 *   being one. Counted INCLUSIVE of both ends, which is how a person counts the
 *   days of their own trip.
 * - **After.** Past tense, so a finished trip cannot read as an upcoming one.
 *   A notebook outlives the trip it describes.
 *
 * Returns `null` when it cannot say — no dates, or no today — and the caller
 * turns that into the widget's empty state rather than inventing a phrase.
 */
export function formatCountdown(today: string, first: string, last: string): string | null {
  const toStart = isoDaysBetween(today, first);
  const toEnd = isoDaysBetween(today, last);
  if (toStart === null || toEnd === null) return null;

  if (toStart > 1) return `in ${toStart} days`;
  if (toStart === 1) return "starts tomorrow";
  if (toStart === 0) return "starts today";

  // Started. Still running while today is on or before the last day; `toEnd` is
  // how many days are left, so 0 is the last day itself rather than over.
  if (toEnd >= 0) {
    const length = isoDaysBetween(first, last);
    if (length === null) return null;
    // Inclusive of both ends: a trip from the 3rd to the 3rd is one day long
    // and today is day 1 of 1.
    return `day ${-toStart + 1} of ${length + 1}`;
  }

  const since = -toEnd;
  if (since === 1) return "ended yesterday";
  return `ended ${since} days ago`;
}

/**
 * A stored `HH:mm` as the house's 12-hour clock: minutes dropped on the hour
 * ("1 pm", "9:05 am"), midnight and noon as 12.
 *
 * Moved here from `apps/web/src/lib/time.ts`, which re-exports it, so the
 * notebook's widgets print the same clock as the board. Mitchell, on the
 * PR #221 preview's `day.sun`: *"All times should be in AM/PM not military
 * time."* Storage stays 24-hour — string comparison is time comparison, and
 * every widget compares before it prints — so only the printed text goes
 * through this.
 *
 * Not `Intl.DateTimeFormat`, which needs a date and a zone to print a bare
 * wall-clock time and would emit "1:00 PM" rather than the house "1 pm".
 */
export function toClockLabel(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const hours24 = (h ?? 0) % 24;
  const mins = m ?? 0;
  const suffix = hours24 < 12 ? "am" : "pm";
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  return mins === 0 ? `${hours12} ${suffix}` : `${hours12}:${String(mins).padStart(2, "0")} ${suffix}`;
}

/**
 * A start–end pair as one label: "2:30 pm – 4 pm". Spaced, because the
 * meridiem ran into an unspaced dash (Mitchell, walking the #71 preview).
 */
export function toClockRange(start: string, end: string): string {
  return `${toClockLabel(start)} – ${toClockLabel(end)}`;
}

/**
 * A trip day's name from its 0-based index: "Day 1" for the first. The one
 * place that wording lives, so a chart, a table and a sentence token cannot
 * name the same day differently.
 */
export function dayLabel(index: number): string {
  return `Day ${index + 1}`;
}

/**
 * `n` as an English ordinal: "1st", "2nd", "3rd", "4th", "11th", "21st".
 *
 * The 11-13 check comes first because those take "th" whatever their last
 * digit is, and it reads `n % 100` so 111-113 follow them. `Intl.PluralRules`
 * with `type: "ordinal"` gives only the plural category, never the suffix, so
 * a table is needed either way.
 */
export function ordinal(n: number): string {
  const teen = n % 100;
  if (teen >= 11 && teen <= 13) return `${n}th`;
  const suffix = ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${suffix}`;
}
