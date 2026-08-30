import type { Money, SavedStop, TimeWindow } from "@tc/contracts";

/**
 * The facts a saved day states about itself — how many stops, the window they
 * span, and what it costs each — derived from its stops and nothing else.
 *
 * In `src/lib` for `savedStops.ts`'s reason: BOTH sides need it and the lint
 * wall forbids UI importing `@/server/*`. Discover's server computes these to
 * put on a card it sends; the shared-day route computes the identical facts
 * from the day it already has in hand. Two implementations would be two
 * chances for a card and the page it opens to disagree about the same day —
 * the same argument link 1 makes for `citiesOfStops` being one rule.
 *
 * Pure, so the interesting cases (no times, mixed currencies, nothing priced)
 * are unit-testable without a database.
 */
export type SavedDayFacts = {
  stopCount: number;
  /**
   * First start to last end, in the day's stored order.
   *
   * `stops` are stored in the order the day ran (`stopsForDay` walks
   * `day.activityIds`), so the first and last TIMED stops bound the day. Stops
   * with no time are skipped rather than treated as 00:00, which would make an
   * unplaced stop silently widen every window it appears in.
   */
  window: TimeWindow | null;
  /**
   * Sum of the priced stops, or null.
   *
   * Null in two different situations that a caller renders the same way and
   * must not conflate in code:
   *
   *   * **nothing is priced** — the day genuinely does not say what it costs;
   *   * **the priced stops disagree on currency** — ADR-008 makes currency
   *     trip-level and a saved day is lifted out of one trip, so this should be
   *     unreachable through the product's own write path. Adding two numbers in
   *     different currencies to produce a third is the failure mode worth
   *     refusing rather than the one worth guessing at, so it returns null and
   *     the surface says nothing rather than saying something false.
   */
  budgetPerPerson: Money | null;
  /** How many stops carry no price — why a budget can be lower than it looks. */
  unpricedStops: number;
};

export function savedDayFacts(stops: readonly SavedStop[]): SavedDayFacts {
  const timed = stops.map((s) => s.timeWindow).filter((w): w is TimeWindow => w !== null);
  const first = timed[0];
  const last = timed[timed.length - 1];

  let amountMinor = 0;
  let currency: string | null = null;
  let mixed = false;
  let priced = 0;
  for (const stop of stops) {
    if (stop.cost === null) continue;
    priced += 1;
    if (currency === null) currency = stop.cost.currency;
    else if (currency !== stop.cost.currency) mixed = true;
    amountMinor += stop.cost.amountMinor;
  }

  return {
    stopCount: stops.length,
    window: first !== undefined && last !== undefined ? { start: first.start, end: last.end } : null,
    budgetPerPerson: priced === 0 || mixed || currency === null ? null : { amountMinor, currency },
    unpricedStops: stops.length - priced,
  };
}
