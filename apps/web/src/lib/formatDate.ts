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
