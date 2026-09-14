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
// **No price, no renewal date, no subscription state.** Those come from Stripe
// and are M21 link 7's; M20 never learns what a plan costs. The chooser built
// on this data is wrapped in `<Preview id="account-plan-change">` for exactly
// that reason — the shapes are real and the payment is not.
import { entitlementsFor } from "./resolver";
import {
  livePlanVersion,
  planVersionRefOf,
  PLAN_VERSIONS,
  type PlanVersion,
} from "./planVersions";
import { aiQuotas, aiStepQuotas, dailyPolicy, peekQuota, type QuotaStanding } from "@/server/quota";
import { codesMintedBy } from "./referrals";

/** One plan as the chooser shows it — no price, because M20 has none. */
export interface PlanChoice {
  planId: string;
  version: number;
  entitlements: readonly string[];
  perUserRequestsPerDay: number | null;
  perUserStepsPerDay: number | null;
  /** True for the plan this account currently holds. */
  held: boolean;
}

export interface AccountPlanView {
  planVersionRef: string;
  entitlements: readonly string[];
  /** Today's standing against the pinned version's ceilings. */
  questions: QuotaStanding;
  steps: QuotaStanding;
  /** Every enabled plan, from the committed file. */
  catalogue: PlanChoice[];
  /** An unredeemed referral code this account can hand out, if it has one. */
  referralCode: string | null;
}

function choiceOf(version: PlanVersion, heldPlanId: string): PlanChoice {
  return {
    planId: version.planId,
    version: version.version,
    entitlements: version.entitlements,
    perUserRequestsPerDay: version.ceilings.perUserRequestsPerDay,
    perUserStepsPerDay: version.ceilings.perUserStepsPerDay,
    held: version.planId === heldPlanId,
  };
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
  const catalogue = [...new Set(PLAN_VERSIONS.map((entry) => entry.planId))]
    .map((planId) => livePlanVersion(planId))
    .filter((version) => version.enabled)
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map((version) => choiceOf(version, heldPlanId));

  return {
    planVersionRef: planVersionRefOf(resolved.held),
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
  };
}
