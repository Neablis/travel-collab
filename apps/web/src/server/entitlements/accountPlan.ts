// **What an account sees about its own plan** (M20 link 5's display half, and
// link 8's referral code).
//
// The design draws a Plan section at the top of Account settings: what you
// hold, two meters against the ceilings of the version you hold, a plan
// chooser, and a referral code. This module answers the half M20 can:
//
//   * **what you hold** — plan, version, entitlements, resolved per request
//     from the database like every other gate;
//   * **the meters** — today's counters against **the ceilings actually in
//     force**, read without charging them. That is the resolver's answer: the
//     most generous of the held version and every active grant, which is
//     exactly what `/ask` enforces. The milestone's prose and the design both
//     say "the version you bought" — true only when no grant is in play, and a
//     meter that showed the held version's ceiling while the endpoint enforced
//     a grant's would be a number that contradicts the product. A new account
//     holds `free` (0 questions) and carries a `plus` trial (50); the honest
//     meter reads 50, because 50 is what it can spend. What stays true from the
//     prose is the other half: the ENVIRONMENT's global ceiling is never shown,
//     because it was never sold to anyone;
//   * **the catalogue** — every enabled plan with what it grants and its
//     ceilings, from the committed plan file, which is the same source the
//     operator console's tier panel reads. One definition of what a plan is,
//     two surfaces reading it.
//
// **M21 added the three things M20 could not answer**: what a plan costs, when
// this one renews, and what state the subscription behind it is in. The chooser
// left this screen at the same time — SPEC §29 makes it a route — so what this
// module feeds is the sheet's Plan section and the `plans` route's chooser
// alike, which is why the catalogue is still here.
import { billingConfigured } from "@/server/billing/config";
import { entitlementsFor, type AccountEntitlements } from "./resolver";
import {
  livePlanVersion,
  planVersionRefOf,
  PLAN_VERSIONS,
  type PlanVersion,
} from "./planVersions";
import { aiQuotas, aiStepQuotas, dailyPolicy, peekQuota, type QuotaStanding } from "@/server/quota";
import { codesMintedBy } from "./referrals";

/** One plan as the chooser shows it. */
export interface PlanChoice {
  planId: string;
  version: number;
  entitlements: readonly string[];
  perUserRequestsPerDay: number | null;
  perUserStepsPerDay: number | null;
  /** True for the plan this account currently holds. */
  held: boolean;
  /**
   * What it costs, in integer minor units, or `null` when it is not sold.
   *
   * **Presentation only, and the ladder is not authority.** M21's
   * *Prerequisites*: *"nothing in code may treat $19 > $9 as meaning `premium`
   * ⊇ `plus`"*. The comparison table on the `plans` route is the one place
   * these numbers sit beside each other, and the only comparison on that page
   * is the one the reader makes.
   */
  priceMinor: number | null;
  currency: string | null;
}

/**
 * **What state the account's plan is in**, in the four words the design uses
 * plus the two it does not draw (SPEC §17.4).
 *
 *   * `none` — free, and never anything else. No subscription, no grant.
 *   * `trial` — the design's *Free week*. A grant, not a subscription, which is
 *     why it outranks the subscription states below: an account on a trial has
 *     nothing to pay yet.
 *   * `active` — paid and current.
 *   * `cancelling` — cancelled, and running out the period already paid for.
 *     Not drawn by the design and needed by the build, because
 *     `cancel_at_period_end` is what M21 link 5's cancellation actually sets.
 *   * `past-due` — the design's *Payment failed*. Inside the grace window, so
 *     **nothing has been lost yet**, which is exactly what the copy has to say.
 *   * `lapsed` — the window closed on an unfixed decline, or a cancellation
 *     reached its period end. Entitlements are gone; the row is not.
 */
export type PlanState = "none" | "trial" | "active" | "cancelling" | "past-due" | "lapsed";

/** The subscription half of the Plan section, or nulls when there is none. */
export interface PlanBillingView {
  state: PlanState;
  /** ISO. The renewal date, or the date a cancellation takes effect. */
  renewsAt: string | null;
  /** ISO. When the card was declined — the grace window's anchor. */
  pastDueSince: string | null;
  /**
   * ISO. When the window closes and the losses happen.
   *
   * **The copy names this date and what stops on it.** M21 link 6: *"naming the
   * loss beats announcing it"*, and with three days there is no room for a
   * gentle first notice followed by a firm one.
   */
  graceEndsAt: string | null;
  /**
   * Whether anything can be bought here at all.
   *
   * A deployment with no Stripe keys is legitimate — every local run and every
   * CI run is one — and the design's rule for it is *"do not offer a CTA that
   * opens a checkout that cannot succeed"* (SPEC §29).
   */
  available: boolean;
}

export interface AccountPlanView {
  planVersionRef: string;
  /**
   * What that version confers right now — the same string as `planVersionRef`
   * except after a lapse, when it is the live `free` version.
   *
   * Both are on the wire because the screen has to say both: *your premium
   * subscription is past due, and until it is fixed you are on free*. One field
   * could not carry that sentence.
   */
  conferredVersionRef: string;
  entitlements: readonly string[];
  /** Today's standing against the pinned version's ceilings. */
  questions: QuotaStanding;
  steps: QuotaStanding;
  /** Every enabled plan, from the committed file. */
  catalogue: PlanChoice[];
  /** An unredeemed referral code this account can hand out, if it has one. */
  referralCode: string | null;
  /**
   * **Whether the referral row appears at all** (M21 link 5).
   *
   * *"A `free` or trial-only account has no referral row at all, because it
   * earns nothing."* A referral earns a month of the tier the referrer already
   * holds, so an account holding nothing earns nothing — and showing the row
   * anyway would be offering a reward that resolves to zero.
   *
   * A trial does not count: it is a week of `plus` that the account did not
   * buy and will not keep.
   */
  canRefer: boolean;
  billing: PlanBillingView;
}

function choiceOf(version: PlanVersion, heldPlanId: string): PlanChoice {
  return {
    planId: version.planId,
    version: version.version,
    entitlements: version.entitlements,
    perUserRequestsPerDay: version.ceilings.perUserRequestsPerDay,
    perUserStepsPerDay: version.ceilings.perUserStepsPerDay,
    held: version.planId === heldPlanId,
    priceMinor: version.price?.minor ?? null,
    currency: version.price?.currency ?? null,
  };
}

/**
 * The four words, decided in one place.
 *
 * **A trial outranks every subscription state**, because an account on its free
 * week has nothing to pay and no card to have declined — telling it "payment
 * failed" would be describing a subscription it does not have.
 */
function planStateOf(resolved: AccountEntitlements): PlanState {
  const onTrial = resolved.grants.some((grant) => grant.source === "trial");
  if (onTrial) return "trial";
  const subscription = resolved.subscription;
  if (subscription === null) return "none";
  if (subscription.lapsed) return "lapsed";
  if (subscription.row.status === "past_due") return "past-due";
  if (!subscription.conferring) return "lapsed";
  return subscription.row.cancelAtPeriodEnd ? "cancelling" : "active";
}

export async function accountPlanView(
  userId: string,
  now: Date = new Date(),
): Promise<AccountPlanView> {
  const resolved = await entitlementsFor(userId, now);

  // **Read, never charge.** `peekQuota` exists so that rendering this page
  // cannot consume the thing it is reporting on.
  const [questions, steps, codes] = await Promise.all([
    peekQuota(dailyPolicy(aiQuotas(resolved.ceilings)), userId, now),
    peekQuota(dailyPolicy(aiStepQuotas(resolved.ceilings)), userId, now),
    codesMintedBy(userId),
  ]);

  // `held` is the version the account HOLDS, not the union — the meters and
  // the "what you hold" marker are both about the plan, and a grant does not
  // move an account onto a tier.
  const heldPlanId = resolved.held.planId;
  const state = planStateOf(resolved);
  // **A trial earns nothing to refer with**, and neither does a bare `free`
  // account. Anything else — a paid subscription, a founder grant, an admin
  // comp, a referral month already earned — holds a tier that a referral can
  // pay a month of.
  const canRefer =
    state === "active" ||
    state === "cancelling" ||
    state === "past-due" ||
    resolved.grants.some((grant) => grant.source !== "trial");
  // **In the plan file's own declaration order, and the presentation ladder is
  // deliberately not read here.**
  //
  // `planVersions.noExtension.test.ts` allows that sort field to be named only
  // by the plan file itself and by RENDERING — *"a GATE joining this list is
  // the failure this test exists to catch"*. This function calls
  // `entitlementsFor`, so it is exactly the kind of module that rule is pointed
  // at, even though ordering a chooser is a presentation use. It caught the
  // first version of this line in CI, and then caught the comment explaining
  // the fix: that check greps RAW source, so merely spelling the field's name
  // here — even to say it is not used — puts this file back on the list.
  //
  // Declaration order answers the same question without touching the ladder,
  // and the two are pinned to agree by an assertion inside that same
  // (allowlisted) test, so a future edit that reorders the plans without moving
  // their sort values fails loudly instead of quietly reordering a chooser.
  const catalogue = [...new Set(PLAN_VERSIONS.map((entry) => entry.planId))]
    .map((planId) => livePlanVersion(planId))
    .filter((version) => version.enabled)
    .map((version) => choiceOf(version, heldPlanId));

  return {
    planVersionRef: planVersionRefOf(resolved.held),
    conferredVersionRef: planVersionRefOf(resolved.conferred),
    // The EFFECTIVE set — what this account can actually do right now, grants
    // included — which is the honest answer to "what can I do" even though the
    // meters below are the held version's. A `plus` holder with a `premium`
    // grant sees premium's capabilities and premium's ceilings, because the
    // resolver takes the most generous of each.
    entitlements: [...resolved.entitlements],
    questions,
    steps,
    catalogue,
    // The oldest unredeemed code, so the same one is shown every visit rather
    // than a different one each render — a code somebody has already sent to a
    // friend must keep appearing here.
    referralCode: codes.find((code) => code.redeemedBy === null)?.code ?? null,
    canRefer,
    billing: {
      state,
      renewsAt: resolved.subscription?.row.currentPeriodEnd?.toISOString() ?? null,
      pastDueSince: resolved.subscription?.pastDueSince?.toISOString() ?? null,
      graceEndsAt: resolved.subscription?.graceEndsAt?.toISOString() ?? null,
      available: billingConfigured(),
    },
  };
}
