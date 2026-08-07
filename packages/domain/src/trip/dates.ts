// Pure ISO-date math. NO wall-clock reads — dates are built only from explicit
// YYYY-MM-DD components via Date.UTC (deterministic), never `new Date()`.
function addDaysIso(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

// Day 1 is pinned to startDate; day i (0-indexed) = startDate + i days.
// startDate === null → every day is undated (ordinal-only).
export function deriveDayDates(startDate: string | null, dayCount: number): (string | null)[] {
  if (startDate === null) return Array.from({ length: dayCount }, () => null);
  return Array.from({ length: dayCount }, (_, i) => addDaysIso(startDate, i));
}

// Inclusive day count between two ISO dates. Pure: built from explicit
// components via Date.UTC, never `new Date()`. Returns 0 or less when `end`
// precedes `start`; callers treat that as invalid.
export function daySpan(startIso: string, endIso: string): number {
  const toUtc = (iso: string): number => {
    const [y, m, d] = iso.split("-").map(Number);
    return Date.UTC(y!, m! - 1, d!);
  };
  return Math.floor((toUtc(endIso) - toUtc(startIso)) / 86_400_000) + 1;
}
