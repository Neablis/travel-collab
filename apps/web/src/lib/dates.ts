// Display-only labels (M1 decision): the domain never reads dates.
export function dayLabel(startDate: string | null, index: number): string {
  const base = `Day ${index + 1}`;
  if (startDate === null) return base;
  const d = new Date(`${startDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + index);
  const formatted = d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return `${base} — ${formatted}`;
}
