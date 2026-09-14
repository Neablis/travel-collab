// **Whether a subscription is still conferring the plan it bought** (M21 links
// 5 and 6).
//
// **The grace window lives here and nowhere else.** M21 link 6: *"The number is
// a constant with one definition, not a literal in three branches. The resolver
// reads it, the copy reads it, and the test reads it. Changing it is then a
// one-line change rather than a hunt, which matters because 3 days is a guess
// that first contact with real declines will want to revise."* Those three
// readers are `@/server/entitlements/resolver` (the gate), the account sheet's
// past-due copy (the person), and `standing.test.ts` (the proof).
//
// **A lapse is a derivation, not a write** — which is how M21 keeps two rules
// that look like they conflict. Link 4 says the webhook is the sole writer of
// subscription state; link 5 says a lapse runs *"through M20's existing
// resolver, with no separate downgrade path to keep in sync"*. If the grace
// window ending had to be written down, something other than the webhook would
// have to write it, on a schedule, three days after an event nobody is
// watching. Instead the row keeps saying exactly what Stripe last said, and
// what it MEANS is computed at read time against the clock. Nothing to run,
// nothing to miss, and no second copy of the answer to drift.
//
// The consequence is the good one: a card fixed inside the window costs the
// account nothing, because nothing was ever taken away — there was no lapse to
// undo. And a later successful retry restores a lapsed account through the
// ordinary webhook path, because the only thing that changed was a status.
import { CONFERRING_STATUSES } from "@tc/contracts";
import { subscriptionFor, type SubscriptionRow } from "./subscriptions";

/**
 * **Three days from the decline** (Mitchell, 2026-09-13).
 *
 * Measured from the decline, **not from the period end** — the two are weeks
 * apart and the milestone is explicit about which. Four things follow from the
 * number being this short, and the first is the one that surprises:
 *
 *   * **It is shorter than Stripe's own retry schedule**, which by default
 *     spreads several attempts over about two weeks. So this is NOT "wait for
 *     Stripe to give up": the account lapses while Stripe is still retrying,
 *     and a later successful retry restores it. That is the right way round —
 *     the lapse is reversible and the access is not free in the meantime.
 *   * **The copy has to be immediate.** With three days there is no room for a
 *     gentle first notice followed by a firm one; the first notice is the only
 *     one that matters, which is why the account sheet names the date the
 *     window ends and what stops then rather than announcing that something
 *     will happen.
 *   * **A card fixed inside the window costs nothing** — no lapse, no
 *     collaborator cap, no re-invite. This is the case the window exists for.
 *   * **It is a guess.** First contact with real declines will want to revise
 *     it, which is the whole reason it is one constant.
 */
export const GRACE_WINDOW_DAYS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

/** When a decline at this instant stops being forgiven. */
export function graceEndsAt(pastDueSince: Date): Date {
  return new Date(pastDueSince.getTime() + GRACE_WINDOW_DAYS * DAY_MS);
}

/**
 * What a subscription is doing for its account, right now.
 *
 * `conferring` is the only field a gate path reads. The rest is for the
 * person: the account sheet renders every one of them.
 */
export interface SubscriptionStanding {
  row: SubscriptionRow;
  /** Is this subscription handing its account the plan it pins, this instant. */
  conferring: boolean;
  /** Set only while a decline is being forgiven — the copy's two dates. */
  pastDueSince: Date | null;
  graceEndsAt: Date | null;
  /** True once the window has closed on an unfixed decline. */
  lapsed: boolean;
}

/**
 * Read one subscription row's standing against the clock.
 *
 * Pure over its inputs — no I/O and no wall-clock read of its own — so every
 * boundary of the window is unit-testable to the millisecond without a
 * database. `standingFor` below is the one I/O wrapper, which is the same
 * arrangement `resolveEntitlements`/`entitlementsFor` uses one module over.
 */
export function standingOf(row: SubscriptionRow, now: Date = new Date()): SubscriptionStanding {
  const statusConfers = CONFERRING_STATUSES.includes(row.status);
  const pastDueSince = row.status === "past_due" ? row.pastDueSince : null;
  const endsAt = pastDueSince === null ? null : graceEndsAt(pastDueSince);
  // **`>` and not `>=`.** The gate box asks that a card never fixed lapses on
  // day 4 and NOT on day 3; the instant the window ends is the last instant
  // inside it, so equality is still forgiven.
  const lapsed = endsAt !== null && now.getTime() > endsAt.getTime();
  return {
    row,
    conferring: statusConfers && !lapsed,
    pastDueSince,
    graceEndsAt: endsAt,
    lapsed,
  };
}

/**
 * **A `past_due` row with no decline date is treated as conferring**, which is
 * the forgiving direction on purpose.
 *
 * It should not happen — the webhook writes `past_due_since` on the same event
 * that writes the status — but the alternative reading is that a missing date
 * means "lapsed since the beginning of time", which would cut off a paying
 * account over a bookkeeping gap. `standingOf` reaches that answer by leaving
 * `graceEndsAt` null; this comment exists because the behaviour is a decision
 * rather than a fallthrough.
 */

/** One account's subscription standing, or `null` when it has never had one. */
export async function standingFor(
  userId: string,
  now: Date = new Date(),
): Promise<SubscriptionStanding | null> {
  const row = await subscriptionFor(userId);
  return row === null ? null : standingOf(row, now);
}
