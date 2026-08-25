// Single money-display formatter shared by every money-rendering surface (#22):
// 2-decimal minor-unit amounts render with thousands grouping so long numbers
// stay readable (e.g. `1,111,106.00 USD`). `formatAmount` is the grouped number
// alone (no currency), for composite displays like the header's cost/budget
// glance; `formatMoney` appends the currency. Both are negative-aware for
// budgetRemaining. The domain's own `fmt` (packages/domain/src/trip/conflicts.ts),
// used in over-budget conflict text, mirrors this same grouping (KI-2 fix) so a
// given amount renders identically whether it comes from a lens total or a
// conflict description — that grouping stays the ONE thing shared between the
// two; the symbol substitution below is UI-only (`packages/domain` is
// off-limits, so the conflict banner still spells the code out).
export function formatAmount(amountMinor: number): string {
  const sign = amountMinor < 0 ? "-" : "";
  const grouped = (Math.abs(amountMinor) / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${sign}${grouped}`;
}

// Mitchell, reviewing the preview: "Can we just map USD to $ for currencies
// to save space?" Scoped to the currencies TripMoneySettings' select actually
// offers (USD/EUR/GBP/JPY/CAD/AUD/CHF). CAD and AUD get `CA$`/`A$`, not a bare
// `$` — the select offers three dollar currencies, and a bare `$` on all
// three would make them indistinguishable at a glance. These match the
// symbols `Intl.NumberFormat(..., { currencyDisplay: "symbol" })` produces
// for `en-US`, so they read the way a browser's own currency formatting
// would. CHF has no distinct symbol — deliberately absent from this map so
// it falls through to the code below.
const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  JPY: "¥",
  CAD: "CA$",
  AUD: "A$",
};

// Symbol prefixes the amount (`$1,234.00`, matching the design handoff's own
// `money()` helper — current/…dc.html:2799). A currency with no well-known
// symbol falls back to its code — but as a trailing suffix with a space
// (`1,234.00 CHF`), the pre-existing convention, since gluing a 3-letter code
// straight onto the digits (`CHF1,234.00`) reads as a typo, not a currency.
export function formatMoney(amountMinor: number, currency: string): string {
  // Object.hasOwn, not a plain `CURRENCY_SYMBOLS[currency]` lookup: a
  // currency code of "constructor"/"toString"/etc. resolves through the
  // prototype chain to an inherited Object.prototype function instead of
  // `undefined`, skipping the unknown-currency fallback below entirely
  // (CodeRabbit, PR #46 final review).
  const symbol = Object.hasOwn(CURRENCY_SYMBOLS, currency) ? CURRENCY_SYMBOLS[currency] : undefined;
  const sign = amountMinor < 0 ? "-" : "";
  const abs = formatAmount(Math.abs(amountMinor));
  return symbol ? `${sign}${symbol}${abs}` : `${sign}${abs} ${currency}`;
}
