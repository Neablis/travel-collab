import type { Money, SavedStop, TimeWindow } from "@tc/contracts";
import { toMinutes } from "@/lib/time";

/**
 * The facts a saved day states about itself — how many stops, the window they
 * span, and what the whole day costs — derived from its stops and nothing else.
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
   * What the whole day costs: the sum of its priced stops, in one currency, or
   * null. Not a per-head figure — nothing here is divided by anything.
   *
   * **Named `totalCost` because it was called `budgetPerPerson` and was never
   * per person.** Mitchell, 2026-09-01: *"why are we calculating per person in
   * a notebook? just show total cost there, any per person logic and math
   * should go into the future milestone around cost."* The loop below adds up
   * `stop.cost` and stops; there is no traveller count in this codebase to
   * divide by, so the old name asserted a semantic the computation did not
   * have — the exact defect class KI-1 and KI-14 named, an invariant claimed
   * by a name with nothing behind it. `docs/milestones/M19-cost-model.md` §1
   * recorded it, and M19 owns the real model (a cost's kind, settled vs
   * estimate, who an activity is for, splits, shared-day presentation). This
   * rename is only the half that stops the lie; it deliberately builds none of
   * that. `totalCost` rather than `total` or `cost` so it does not read as a
   * near-twin of a stop's own `cost` at a call site holding both.
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
  totalCost: Money | null;
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
    totalCost: priced === 0 || mixed || currency === null ? null : { amountMinor, currency },
    unpricedStops: stops.length - priced,
  };
}

/**
 * The three buckets a day's elapsed span falls into, and the words for them.
 *
 * Mitchell, walking the shared-day rail on a phone (2026-09-01): *"also add
 * length, with a tag short medium long if the duration is <4h, 4-12h, 12h+"*.
 *
 * A pure function beside the derivation rather than a ternary in the rail,
 * because the Discover card carries the same `window` and will want the same
 * tag — and two surfaces bucketing the same minutes with two expressions is
 * the drift `savedDayFacts`' own header argues against for the facts
 * themselves. One rule decides "Long", here.
 */
export type DayLength = "short" | "medium" | "long";

/** The rendered word for each bucket — spelled once, so no caller hand-cases it. */
export const DAY_LENGTH_LABELS: Record<DayLength, string> = {
  short: "Short",
  medium: "Medium",
  long: "Long",
};

/**
 * Which bucket a day's window falls in, or null when there is no window.
 *
 * **The boundaries, written down because an undocumented one is how two
 * surfaces come to disagree.** Mitchell's ranges overlap at their edges as
 * spoken (`4-12h` and `12h+` both claim exactly twelve hours), so the seam is
 * fixed here and both edges fall on **Medium**:
 *
 *   * `duration < 4h` → **Short**
 *   * `4h <= duration <= 12h` → **Medium** — exactly 4 h and exactly 12 h are
 *     both Medium
 *   * `duration > 12h` → **Long**
 *
 * Put another way: a bucket's upper edge belongs to the bucket below it, so
 * the tag only changes once you are strictly past the number.
 *
 * **Null in, null out.** A day whose stops carry no times has no window
 * (`savedDayFacts` returns null rather than guessing at 00:00), and a day with
 * no window has no length — so the caller renders nothing rather than
 * inventing "Short", which is what a `?? 0` here would have produced. This is
 * the same choice the "Window" fact already makes when it says "No times set".
 *
 * `toMinutes` rather than re-parsing "HH:MM": the app has exactly one clock
 * parser (`lib/time.ts`) and a second one here would be free to disagree with
 * it about a malformed string.
 *
 * A window that ends before it starts cannot come out of `savedDayFacts` for
 * a day whose stops are in clock order, but `stops` is stored order and
 * nothing forces the two to agree — so a negative span is clamped to zero and
 * reads as "Short" rather than falling through the comparisons as a negative
 * number and landing somewhere arbitrary.
 */
export function dayLength(window: TimeWindow | null): DayLength | null {
  if (window === null) return null;
  const minutes = Math.max(0, toMinutes(window.end) - toMinutes(window.start));
  if (minutes < 4 * 60) return "short";
  if (minutes <= 12 * 60) return "medium";
  return "long";
}
