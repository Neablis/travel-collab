// **Self-serve invite codes, and the referral reward** (M20 link 8).
//
// The reward keys on platform admission — *someone I invited got an account* —
// which `invite_codes.redeemed_by` already records. The data has been there
// since M11a; what was missing is that **codes are minted by hand**, so nobody
// could earn a referral they could not issue.
//
// **The reward is one month of the tier the referrer already holds** (Mitchell,
// 2026-09-01), and three consequences follow, all deliberate:
//
//   * **A `free` account earns nothing**, and neither does an account whose
//     only entitlement is its trial — a trial is a GRANT, not a held plan.
//     This narrows the brief's *"inviting new users gets more paid or
//     premium"* to paying users only, and it is the narrowing that makes this
//     link safe: **most of the anti-abuse surface disappears**, because there
//     is no reward a throwaway account could farm.
//   * **The grant is minted at redemption, for the tier held AT THAT MOMENT,
//     and expires independently of any subscription.** Cancelling afterwards
//     does not claw it back — the month was earned.
//   * **A `premium` referrer who later downgrades to `plus` holds both** until
//     the grant expires. That is the resolver's union behaving correctly, not
//     an edge case to special-case, and there is no code here for it.
//
// Self-referral still earns nothing and the per-account cap still holds, but
// neither is now load-bearing.
import { and, eq, gte, isNull, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { entitlementGrants, inviteCodes } from "@/server/db/schema";
import { heldPlanFor, issueGrant } from "./grants";
import { planVersionFromRef } from "./planVersions";

/** How long a referral reward runs. One month, as one constant. */
export const REFERRAL_REWARD_DAYS = 30;

/**
 * How many referral rewards one account may earn in a rolling window.
 *
 * Not load-bearing — a `free` referrer earns nothing, so there is no reward a
 * throwaway account could farm — but a cap that exists is cheaper than a cap
 * argued about later, and it bounds the one case that is left: a paying account
 * minting codes in bulk.
 */
export const REFERRAL_REWARD_CAP = 10;
export const REFERRAL_CAP_WINDOW_DAYS = 30;

/** How many unredeemed codes one account may hold at once. */
export const OUTSTANDING_CODE_CAP = 5;

/**
 * Mint a code this account can hand out.
 *
 * **Anyone may mint**, including a `free` account — minting is not the reward,
 * redeeming is. Refusing to mint would make the invite gate harder to get
 * through for no gain, and M11a's gate is about who reaches the product, not
 * about who pays.
 */
export async function mintReferralCode(
  userId: string,
  now: Date = new Date(),
): Promise<{ ok: true; code: string } | { ok: false; reason: "too-many-outstanding" }> {
  const outstanding = await db
    .select({ code: inviteCodes.code })
    .from(inviteCodes)
    .where(and(eq(inviteCodes.createdBy, userId), isNull(inviteCodes.redeemedBy)));
  if (outstanding.length >= OUTSTANDING_CODE_CAP) {
    return { ok: false, reason: "too-many-outstanding" };
  }
  // Base32-ish, no ambiguous characters: these are read aloud and retyped.
  const code = Array.from(crypto.getRandomValues(new Uint8Array(10)))
    .map((byte) => "ABCDEFGHJKMNPQRSTUVWXYZ23456789"[byte % 31])
    .join("");
  await db.insert(inviteCodes).values({ code, createdBy: userId, createdAt: now });
  return { ok: true, code };
}

/** Every code this account minted, redeemed or not. */
export async function codesMintedBy(userId: string) {
  return db.select().from(inviteCodes).where(eq(inviteCodes.createdBy, userId));
}

/** Why a redemption earned its minter nothing. Reported, never thrown. */
export type RewardOutcome =
  | { rewarded: true; planId: string }
  | { rewarded: false; reason: "self-referral" | "referrer-holds-no-paid-plan" | "cap-reached" | "unknown-code" };

/**
 * Reward the minter of a code that was just redeemed.
 *
 * Called after admission has already succeeded, and **never in its path**: a
 * reward that failed must not stop someone getting an account. M11a decides
 * who reaches the product; this decides what their inviter earns, and the two
 * are separate mechanisms on purpose.
 */
export async function rewardReferrer(
  code: string,
  redeemedBy: string,
  now: Date = new Date(),
): Promise<RewardOutcome> {
  const [row] = await db.select().from(inviteCodes).where(eq(inviteCodes.code, code)).limit(1);
  if (row === undefined) return { rewarded: false, reason: "unknown-code" };

  // **A code redeemed by its own minter earns nothing.** The minter and the
  // redeemer must be distinct accounts, and this is the only check that says
  // so — `invite_codes` has no constraint preventing it, because admitting
  // yourself with your own code is not itself a problem.
  if (row.createdBy === redeemedBy) return { rewarded: false, reason: "self-referral" };

  // **The tier the referrer HOLDS, not what they were granted.** A trial is a
  // grant, not a held plan, so a trial-only account earns nothing — which is
  // the narrowing that removes most of the anti-abuse surface. `heldPlanFor`
  // reads `users.plan_id`; the resolver's union is deliberately not consulted.
  const held = await heldPlanFor(row.createdBy);
  if (held === null) return { rewarded: false, reason: "referrer-holds-no-paid-plan" };
  const version = planVersionFromRef(`${held.planId}@v${held.planVersion}`);
  // A plan that grants nothing is not a paid plan. Asked as *"does this plan
  // grant anything"* rather than *"is this plan `free`"*, because the second is
  // a comparison against a plan id — the one shape ADR-045 rule 4 forbids, and
  // the one a fourth plan cannot survive.
  if (version.entitlements.length === 0) {
    return { rewarded: false, reason: "referrer-holds-no-paid-plan" };
  }

  if (await rewardsInWindow(row.createdBy, now) >= REFERRAL_REWARD_CAP) {
    return { rewarded: false, reason: "cap-reached" };
  }

  // **Minted at redemption, for the tier held at that moment.** Cancelling
  // afterwards does not claw it back: the month was earned, and the grant's own
  // expiry is the only thing that ends it.
  await issueGrant(
    {
      userId: row.createdBy,
      planId: version.planId,
      planVersion: version.version,
      source: "referral",
      grantedBy: null,
      reason: `Referral: an invited account joined.`,
      expiresAt: new Date(now.getTime() + REFERRAL_REWARD_DAYS * 24 * 60 * 60 * 1000),
    },
    now,
  );
  return { rewarded: true, planId: version.planId };
}

/** Referral grants this account has earned inside the cap's rolling window. */
async function rewardsInWindow(userId: string, now: Date): Promise<number> {
  const since = new Date(now.getTime() - REFERRAL_CAP_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(entitlementGrants)
    .where(
      and(
        eq(entitlementGrants.userId, userId),
        eq(entitlementGrants.source, "referral"),
        gte(entitlementGrants.createdAt, since),
      ),
    );
  return row?.count ?? 0;
}
