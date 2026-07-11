// 2-decimal minor-unit display formatter (ADR-008 M4 simplification), shared
// by every money-displaying lens so the same amount always renders the same
// way. Matches the domain's own `fmt` (packages/domain/src/trip/conflicts.ts)
// used in the over-budget conflict text. Negative-aware for budgetRemaining.
export function formatMoney(amountMinor: number, currency: string): string {
  const sign = amountMinor < 0 ? "-" : "";
  return `${sign}${(Math.abs(amountMinor) / 100).toFixed(2)} ${currency}`;
}
