// Display-only labels (M1 decision): the domain never reads dates.
export function dayLabel(startDate: string | null, index: number): string {
  const base = `Day ${index + 1}`;
  if (startDate === null) return base;
  const d = new Date(`${startDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + index);
  const formatted = d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return `${base} — ${formatted}`;
}

// Inclusive day count between two ISO dates — a local equivalent of the
// domain's daySpan (packages/domain/src/trip/dates.ts). UI code must not
// import packages/domain (module map, AGENTS.md — that's a signal of
// drift, not a shortcut), so TripDateControl needs its own copy of this
// tiny bit of math to size newDayIds client-side. Same rule as dayLabel
// above: the domain never reads dates, so this stays pure Date.UTC
// arithmetic, never a bare `new Date()`.
export function daySpan(startIso: string, endIso: string): number {
  const toUtc = (iso: string): number => {
    const [y, m, d] = iso.split("-").map(Number);
    return Date.UTC(y!, m! - 1, d!);
  };
  return Math.floor((toUtc(endIso) - toUtc(startIso)) / 86_400_000) + 1;
}
