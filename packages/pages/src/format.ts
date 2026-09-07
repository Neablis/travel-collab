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
