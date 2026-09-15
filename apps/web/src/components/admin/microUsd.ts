// **Micro-dollars, rendered** — the console's one formatter, shared by every
// panel that shows money.
//
// **Never `Money`, and never at any layer below this one.** ADR-008 defines
// `Money` in integer minor units and a live AI request costs about $0.0006,
// which rounds to zero — so every request would record as free. M20 link 9 took
// the position that the stored value stays an integer count of micro-dollars
// all the way to the point of display, and that *"formatting is a decision made
// where a number is displayed"*. This is that point, and the reason it is one
// file rather than a copy per panel is that three panels had one each before
// M21 needed a fourth.

/**
 * A cost, to four decimal places.
 *
 * Four because a single request is genuinely $0.0006 and two decimals would
 * print `$0.00` for a real number — the exact defect the micro-dollar unit
 * exists to avoid, reintroduced at the last step.
 */
export function microUsdCost(value: number | null): string {
  if (value === null) return "—";
  return `$${(value / 1_000_000).toFixed(4)}`;
}

/**
 * A price or a revenue figure, to two decimal places.
 *
 * **A different function on purpose.** Revenue is whole cents by construction —
 * a plan costs $9, never $9.0001 — so four decimals would be two digits of
 * false precision on the numbers an operator reads at a glance. The two are
 * separate because the alternative is one formatter with a flag, and a flag
 * gets passed wrong.
 */
export function microUsdMoney(value: number | null): string {
  if (value === null) return "—";
  return `$${(value / 1_000_000).toFixed(2)}`;
}

/** A signed margin: `+$4.32` or `−$1.09`, so the sign is never missed. */
export function microUsdMargin(value: number | null): string {
  if (value === null) return "—";
  // A minus sign that is a real minus sign (U+2212), not a hyphen: at the size
  // these are read, a hyphen in front of a number is easy to lose entirely, and
  // the whole point of this column is the sign.
  const sign = value < 0 ? "−" : "+";
  return `${sign}$${(Math.abs(value) / 1_000_000).toFixed(2)}`;
}
