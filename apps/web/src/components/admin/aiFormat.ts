// **How the AI models tab writes its numbers** (M36 link 4). Formatting is a
// decision made where a number is displayed (M20 link 9), so the report stays
// raw counts, tokens, ms and bytes, and these turn them into the design's
// `6.2k`, `1.9s`, `14.2 KB` and `27 Sep`. Money is not here: it goes through
// `microUsd.ts`, the console's one money formatter.

/** A count with thousands separators: `20,130`. */
export function count(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

/** Tokens and other large counts as the design writes them: `840`, `6.2k`, `24k`, `82.1M`. */
export function compact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}k`;
  return String(Math.round(value));
}

/**
 * A share as a percentage: one decimal under 10% (`2.6%`), whole above (`62%`)
 * — the precision the design reads at, and where a tenth stops meaning anything.
 */
export function percent(share: number): string {
  const value = share * 100;
  return `${value < 10 && value > 0 ? value.toFixed(1) : Math.round(value)}%`;
}

/** A median that may be fractional: `3`, `2.5`. */
export function decimal(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/** A duration: `38ms` under a second, `1.9s` from one. */
export function duration(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

/** A size of JSON in bytes, as the design writes it: `0.4 KB`, `14.2 KB`. */
export function bytes(value: number): string {
  return `${(value / 1000).toFixed(1)} KB`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * An ISO instant as a day, `27 Sep`, in UTC — the ledger's days are 24-hour
 * windows counted back from the read, so a local calendar would shift them.
 */
export function shortDay(iso: string): string {
  const date = new Date(iso);
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
}

/** An ISO instant as `27 Sep 09:40` UTC, for when a gap began. */
export function shortDayTime(iso: string): string {
  const date = new Date(iso);
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mm = String(date.getUTCMinutes()).padStart(2, "0");
  return `${shortDay(iso)} ${hh}:${mm} UTC`;
}
