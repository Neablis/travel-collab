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
import { db, type Queryable } from "@/server/db/client";
import { entitlementGrants, inviteCodes } from "@/server/db/schema";
import { heldPlanFor, issueGrant } from "./grants";
import { planVersionFromRef } from "./planVersions";

/**
 * The alphabet a code is drawn from: no `I`, `L`, `O`, `0` or `1`, because
 * these are read aloud and retyped.
 */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/**
 * Ten characters drawn UNIFORMLY from that alphabet.
 *
 * **Rejection sampling, not modulo.** This was
 * `bytes.map((byte) => ALPHABET[byte % 31])`, and 256 is not a multiple of 31:
 * bytes 0-7 map to the first eight letters twice as often as the rest, so `A`
 * was about twice as likely as `9`. Caught by CodeQL on PR #174
 * ("creating biased random numbers from a cryptographically secure source"),
 * which is the right place for it to be caught — the bias is invisible in any
 * sample a person would eyeball.
 *
 * It costs the guessing bound roughly a bit and a half of the 49 a uniform
 * ten-character draw carries, which is not the reason to fix it. The reason is
 * that a code is an admission credential (M11a), and a credential whose
 * distribution is skewed in a way nobody wrote down is one nobody can reason
 * about later.
 *
 * The loop discards any byte at or above the largest multiple of the alphabet
 * length that fits in a byte (248), so every accepted byte has exactly one of
 * 31 equally likely residues. It draws more bytes than it needs up front,
 * because rejecting ~3% of them one at a time would mean a syscall per
 * rejection.
 */
function mintCode(length = 10): string {
  const limit = Math.floor(256 / CODE_ALPHABET.length) * CODE_ALPHABET.length;
  const out: string[] = [];
  while (out.length < length) {
    for (const byte of crypto.getRandomValues(new Uint8Array(length * 2))) {
      if (byte >= limit) continue;
      out.push(CODE_ALPHABET[byte % CODE_ALPHABET.length]!);
      if (out.length === length) break;
    }
  }
  return out.join("");
}

/**
 * Serialise a referral decision for one account.
 *
 * **Both caps below are count-then-write, and a count-then-write is not a
 * cap.** Two concurrent requests each read four outstanding codes, each decide
 * there is room, and each insert — five becomes six, and the same shape lets a
 * referrer earn past the reward cap. Flagged twice by CodeRabbit on PR #174.
 *
 * A transaction alone does not fix it: under READ COMMITTED both transactions
 * see the same pre-insert count, and neither writes a row the other conflicts
 * on. The trial's one-time-ever rule is enforced by a partial unique index for
 * exactly that reason — but a COUNT has no row to be unique about, so there is
 * nothing to index.
 *
 * `pg_advisory_xact_lock` is the mechanism for that case: a lock on an
 * arbitrary key, held to the end of the transaction, released by commit or
 * rollback without a cleanup path. Keyed on the account, so two different
 * referrers never wait on each other — which matters because this sits on the
 * sign-in path, where the referral reward is issued.
 *
 * `hashtext` is Postgres's own hash over the id; a collision costs two
 * unrelated accounts a moment of serialisation and nothing else.
 */
async function withAccountLock<T>(userId: string, run: (tx: Queryable) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}))`);
    return run(tx);
  });
}

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
  return withAccountLock(userId, async (tx) => {
    const outstanding = await tx
      .select({ code: inviteCodes.code })
      .from(inviteCodes)
      .where(and(eq(inviteCodes.createdBy, userId), isNull(inviteCodes.redeemedBy)));
    if (outstanding.length >= OUTSTANDING_CODE_CAP) {
      return { ok: false, reason: "too-many-outstanding" } as const;
    }
    const code = mintCode();
    await tx.insert(inviteCodes).values({ code, createdBy: userId, createdAt: now });
    return { ok: true, code } as const;
  });
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

  // **The cap and the grant in one transaction, under the referrer's lock**, so
  // "count says there is room" and "write the row" cannot be interleaved by a
  // concurrent redemption. See `withAccountLock`.
  return withAccountLock(row.createdBy, async (tx) => {
    if ((await rewardsInWindow(row.createdBy, now, tx)) >= REFERRAL_REWARD_CAP) {
      return { rewarded: false, reason: "cap-reached" } as const;
    }

    // **Minted at redemption, for the tier held at that moment.** Cancelling
    // afterwards does not claw it back: the month was earned, and the grant's
    // own expiry is the only thing that ends it.
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
      tx,
    );
    return { rewarded: true, planId: version.planId } as const;
  });
}

/** Referral grants this account has earned inside the cap's rolling window. */
async function rewardsInWindow(userId: string, now: Date, tx: Queryable = db): Promise<number> {
  const since = new Date(now.getTime() - REFERRAL_CAP_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const [row] = await tx
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
