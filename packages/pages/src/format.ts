export function formatMoney(amountMinor: number, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amountMinor / 100);
}

export function formatDate(iso: string | null): string {
  if (iso === null) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  // Fixed UTC construction — no wall-clock read, deterministic (Invariant 4).
  const date = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(date);
}
