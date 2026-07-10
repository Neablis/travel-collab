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
