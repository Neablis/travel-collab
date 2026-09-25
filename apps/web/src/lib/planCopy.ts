import type { AccountGrantView, AccountPlanState } from "./accountPlan";

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

/**
 * A billing boundary as a person reads it, from an ISO instant.
 *
 * **Rendered in UTC, and that is the opposite of `formatInstantLong`'s rule on
 * purpose.** That helper renders an instant in the reader's own zone because
 * the thing it describes ("you took this copy on…") happened at a moment. The
 * dates here are not moments that happened — they are `renewsAt`, `trialEndsAt`,
 * `graceEndsAt` and `effectiveAt`: boundaries the SERVER acts on, stored and
 * compared in UTC. Rendering them locally tells a reader west of Greenwich a
 * different day from the one the system will act on, because every one of them
 * arrives as midnight UTC and midnight UTC is the previous afternoon in a
 * negative-offset zone.
 *
 * The cost of getting this wrong is not cosmetic. M21's failed-payment grace
 * window is three days (decided 2026-09-13), so a one-day error in the date a
 * person is shown is a third of the window they are being warned about.
 *
 * **CI cannot catch a regression here.** The runner has no `TZ` pinned, so it
 * runs in UTC where local and UTC agree and the bug is invisible. The tests
 * beside this file fail on any developer machine west of Greenwich and pass in
 * CI either way — see `planCopy.test.ts`.
 */
export function formatDate(iso: string | null): string | null {
  if (iso === null) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", { day: "numeric", month: "long", timeZone: "UTC" }).format(date);
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

/**
 * What each grant source is called on the account sheet — the operator
 * console's own words for *why they hold it* (SPEC §17.2), except `trial`,
 * which the sheet already calls *Free week* in its state badge (§17.4).
 */
export const GRANT_SOURCE_LABEL: Record<AccountGrantView["source"], string> = {
  trial: "free week",
  referral: "referral",
  founder: "founder",
  admin: "admin",
};

/**
 * **Every grant on the account, by name, with why it is there and when it
 * ends** (KI-20260916-b-the-account-sheet-never-names-the-grants-an-account-holds).
 *
 * The line above it says which tier the grants add up to; this one says what
 * they ARE. Without it an account holding `free` with an admin comp and a
 * founder grant read as one unexplained tier, and the founder grant appeared
 * nowhere — a correct answer that looked like a bug.
 *
 * `trialEndShown` drops the free week's date when the trial-ends line below
 * already carries it, so one card does not print the same date twice. Returns
 * `null` for an account with no grants: there is nothing to name.
 */
export function grantsSentence(
  grants: readonly AccountGrantView[],
  trialEndShown: boolean,
): string | null {
  if (grants.length === 0) return null;
  const named = grants.map((grant) => {
    const source = GRANT_SOURCE_LABEL[grant.source];
    const ends = formatDate(grant.expiresAt);
    let term: string | null = null;
    if (grant.expiresAt === null) term = "permanent";
    else if (ends !== null && !(grant.source === "trial" && trialEndShown)) term = `until ${ends}`;
    return `${grant.planId} v${grant.version} (${term === null ? source : `${source}, ${term}`})`;
  });
  return `Granted to you: ${new Intl.ListFormat("en-US", { type: "conjunction" }).format(named)}.`;
}
