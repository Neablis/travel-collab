// Whole-percent shares that add up. Mitchell, 2026-09-26, on the Spend
// breakdown's key: *"I would always cap math so it can never be 101% but
// JavaScript math is hard."* Rounding each slice on its own cannot promise
// that — 16.5% + 16.5% + 67% rounds to 17 + 17 + 67 = 101, and three equal
// thirds round to 33 + 33 + 33 = 99 — so the shares are apportioned instead,
// by the largest-remainder (Hamilton) method:
//
// 1. every part gets the floor of its exact share;
// 2. the points that leaves over (at most one per part) go one each to the
//    parts with the largest remainders;
// 3. a tie goes to the part that comes first, so the answer depends only on
//    the amounts and their order — the order the caller lists them in, which
//    for a pie is the contract's series order.
//
// **Integer arithmetic throughout.** Money here is already integer minor units,
// so `amount * 100 / total` is done as an integer division with an integer
// remainder: no float ever decides which slice gets the last point, and two
// remainders that are equal are equal, not 1e-16 apart.
//
// **"<1%" is a label, not a number.** The numbers always sum to exactly 100.
// A nonzero part that apportions to 0 is still 0 in that sum; `shareLabel`
// only says "<1%" for it, so a reader is never told a real cost is "0%".

/**
 * Each amount's share of their total as whole percents that sum to exactly
 * 100, by largest remainder with ties to the earlier amount. Each share is
 * within 1 of its exact value, and a zero amount's share is 0. `null` when the
 * total is 0: there is nothing to have a share of.
 *
 * @param amounts - nonnegative integers (minor units), in the order ties
 *   should be broken.
 * @throws RangeError when an amount is negative or not an integer, or when
 *   `total * 100` is past `Number.MAX_SAFE_INTEGER` (about 90 trillion in major
 *   units) — beyond which the integer arithmetic would stop being exact.
 */
export function apportionPercents(amounts: readonly number[]): number[] | null {
  for (const amount of amounts) {
    if (!Number.isSafeInteger(amount) || amount < 0) throw new RangeError(`not a nonnegative integer amount: ${amount}`);
  }
  const total = amounts.reduce((sum, amount) => sum + amount, 0);
  if (total === 0) return null;
  if (!Number.isSafeInteger(total * 100)) throw new RangeError(`total too large to apportion exactly: ${total}`);

  // `%` on safe integers is exact, and `scaled - remainder` is an exact
  // multiple of `total`, so the floor is an exact division too — unlike
  // `Math.floor(scaled / total)`, whose float quotient can round up onto the
  // next integer once `total` is large. The remainder is in units of 1/total
  // of a percent, so comparing remainders is comparing integers.
  const remainders = amounts.map((amount) => (amount * 100) % total);
  const floors = amounts.map((amount, i) => (amount * 100 - remainders[i]!) / total);
  const leftover = 100 - floors.reduce((sum, share) => sum + share, 0);
  const byRemainder = amounts
    .map((_, i) => i)
    .sort((a, b) => remainders[b]! - remainders[a]! || a - b);
  for (const i of byRemainder.slice(0, leftover)) floors[i] = floors[i]! + 1;
  return floors;
}

/**
 * A share as a reader says it: "34%", or "<1%" for an amount that is there
 * but apportioned to 0 — never "0%" for money that exists. `null` for a zero
 * amount, which has no share to state.
 */
export function shareLabel(amount: number, percent: number): string | null {
  if (amount === 0) return null;
  return percent === 0 ? "<1%" : `${percent}%`;
}
