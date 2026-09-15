import type { AccountPlanState } from "./accountPlan";

// **The words and the numbers a plan is described with**, in one place, on the
// UI side of the lint wall.
//
// Two surfaces read it — the account sheet's Plan section and the `plans`
// route — and SPEC §29's own framing is why they must not each have their own
// copy of it: *"Plans is not a second view of the same information."* Where the
// two do say the same thing, they say it in the same words.

/**
 * A price from integer minor units.
 *
 * **Formatting is a decision made where a number is displayed**, and the stored
 * value stays an integer count of minor units all the way here — the same rule
 * the operator console follows for micro-dollars. `Intl` rather than a hand
 * division, because `$9` and `$9.00` are different answers and the locale gets
 * to decide which.
 */
export function formatPrice(minor: number, currency: string | null): string {
  const code = (currency ?? "usd").toUpperCase();
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: code,
    // A whole-dollar price reads as `$9`, a prorated one as `$11.47`. Both are
    // real amounts; showing `$9.00` on a pricing card is a spreadsheet's habit.
    minimumFractionDigits: minor % 100 === 0 ? 0 : 2,
  }).format(minor / 100);
}

/** A date as a person reads it, from an ISO string. */
export function formatDate(iso: string | null): string | null {
  if (iso === null) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", { day: "numeric", month: "long" }).format(date);
}

/**
 * **The design's four words**, plus the two states the build has and the design
 * does not draw (SPEC §17.4).
 *
 * `Free week` rather than `Trial`, and `Payment failed` rather than `Past due`,
 * because those are the design's words and they are better ones: the first
 * says what you have and the second says what happened, where the alternatives
 * name an internal state.
 */
export const PLAN_STATE_LABEL: Record<AccountPlanState, string> = {
  none: "Free",
  trial: "Free week",
  active: "Active",
  cancelling: "Ends soon",
  "past-due": "Payment failed",
  lapsed: "Lapsed",
};

/** Which `Badge` variant each state wears. */
export const PLAN_STATE_BADGE: Record<
  AccountPlanState,
  "neutral" | "info" | "success" | "warning" | "danger"
> = {
  none: "neutral",
  trial: "info",
  active: "success",
  // **`warning` and not `danger` for both of the recoverable ones.** A
  // cancellation that has not reached its period end and a decline inside the
  // grace window have both taken nothing yet, and a red chip for a state where
  // nothing has been lost is the interface crying wolf — which is how the red
  // chip for `lapsed`, where something HAS been lost, stops being read.
  cancelling: "warning",
  "past-due": "warning",
  lapsed: "danger",
};

/**
 * **The past-due sentence, which names the loss rather than announcing one**
 * (M21 link 6, and §17.4's *"past due is told before anything is taken"*).
 *
 * Three facts, in this order: when the card was declined, when the window
 * closes, and what stops on that date — **including the collaborators dropping
 * to read-only**, because M20's collaborator cap means the owner's guests feel
 * this too and nobody has told them.
 *
 * With a three-day window there is no room for a gentle first notice followed
 * by a firm one. This is the only notice, so it is the firm one.
 */
export function pastDueSentence(input: {
  declinedAt: string | null;
  graceEndsAt: string | null;
  losesCollaborators: boolean;
}): string {
  const declined = formatDate(input.declinedAt);
  const ends = formatDate(input.graceEndsAt);
  const when = declined === null ? "Your card was declined" : `Your card was declined on ${declined}`;
  const deadline = ends === null ? "shortly" : `on ${ends}`;
  const losses = input.losesCollaborators
    ? "the assistant stops and everyone else on your trips goes back to reading"
    : "the assistant stops";
  return `${when}. Nothing has changed yet. If it is not fixed ${deadline}, ${losses}.`;
}

/** What a lapse has already taken, once the window has closed. */
export function lapsedSentence(losesCollaborators: boolean): string {
  return losesCollaborators
    ? "Your subscription has lapsed. The assistant is off and everyone else on your trips can read but not edit. Paying again restores both — nobody needs re-inviting."
    : "Your subscription has lapsed and the assistant is off. Paying again restores it.";
}
