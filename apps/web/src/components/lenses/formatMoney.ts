// Single money-display formatter shared by every money-rendering surface (#22):
// 2-decimal minor-unit amounts render with thousands grouping so long numbers
// stay readable (e.g. `1,111,106.00 USD`). `formatAmount` is the grouped number
// alone (no currency), for composite displays like the header's cost/budget
// glance; `formatMoney` appends the currency. Both are negative-aware for
// budgetRemaining. The domain's own `fmt` (packages/domain/src/trip/conflicts.ts),
// used in over-budget conflict text, mirrors this same grouping (KI-2 fix) so a
// given amount renders identically whether it comes from a lens total or a
// conflict description.
export function formatAmount(amountMinor: number): string {
  const sign = amountMinor < 0 ? "-" : "";
  const grouped = (Math.abs(amountMinor) / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${sign}${grouped}`;
}

export function formatMoney(amountMinor: number, currency: string): string {
  return `${formatAmount(amountMinor)} ${currency}`;
}
