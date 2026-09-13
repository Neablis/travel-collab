// **Self-serve invite codes and the referral reward** (M20 link 8).
//
// The gate box in full: *"A referral earns one month of the tier the referrer
// holds; a `free` referrer and a trial-only referrer each earn nothing, a code
// redeemed by its own minter earns nothing, and the per-account cap holds under
// repeated redemption."* Plus the resolver box it leans on: a `premium`
// referrer who downgrades to `plus` keeps premium until the grant expires.
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { inviteCodes, users } from "@/server/db/schema";
import { upsertUser } from "@/server/users";
import { allGrantsFor, offerTrial } from "./grants";
import { accountCan } from "./resolver";
import {
  OUTSTANDING_CODE_CAP,
  REFERRAL_REWARD_CAP,
  REFERRAL_REWARD_DAYS,
  mintReferralCode,
  rewardReferrer,
} from "./referrals";

const newUser = () => `dev-${randomUUID()}`;

async function account(planId: "free" | "plus" | "premium" = "free") {
  const id = newUser();
  await upsertUser({ id, email: null, name: null, image: null });
  await db.update(users).set({ planId, planVersion: 1 }).where(eq(users.id, id));
  return id;
}

async function codeFrom(userId: string): Promise<string> {
  const minted = await mintReferralCode(userId);
  if (!minted.ok) throw new Error(`could not mint: ${minted.reason}`);
  return minted.code;
}

describe("anyone may mint a code", () => {
  // **Minting is not the reward, redeeming is.** Refusing a `free` account a
  // code would make M11a's gate harder to get through for no gain — that gate
  // is about who reaches the product, not about who pays.
  it("lets a free account mint one, and records who minted it", async () => {
    const free = await account("free");
    const code = await codeFrom(free);
    const [row] = await db.select().from(inviteCodes).where(eq(inviteCodes.code, code));
    expect(row!.createdBy).toBe(free);
    expect(row!.redeemedBy).toBeNull();
    // Unambiguous characters only: these get read aloud and retyped.
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{10}$/);
  });

  it("caps how many unredeemed codes one account holds at once", async () => {
    const minter = await account("premium");
    for (let i = 0; i < OUTSTANDING_CODE_CAP; i += 1) await codeFrom(minter);
    expect(await mintReferralCode(minter)).toEqual({ ok: false, reason: "too-many-outstanding" });
  });
});

describe("a referral earns one month of the tier the referrer holds", () => {
  it("mints a grant at the referrer's own plan and version", async () => {
    const referrer = await account("premium");
    const code = await codeFrom(referrer);
    const now = new Date("2026-09-13T12:00:00Z");

    expect(await rewardReferrer(code, await account(), now)).toEqual({
      rewarded: true,
      planId: "premium",
    });
    const [grant] = await allGrantsFor(referrer);
    expect(grant!.source).toBe("referral");
    expect(grant!.planId).toBe("premium");
    expect(grant!.planVersion).toBe(1);
    expect(grant!.expiresAt!.getTime() - now.getTime()).toBe(
      REFERRAL_REWARD_DAYS * 24 * 60 * 60 * 1000,
    );
    // No human granted it, and the audit column says so rather than naming one.
    expect(grant!.grantedBy).toBeNull();
  });

  // **A `free` account earns nothing.** This is the narrowing that makes the
  // link safe: most of the anti-abuse surface disappears, because there is no
  // reward a throwaway account could farm.
  it("earns a free referrer nothing", async () => {
    const referrer = await account("free");
    const code = await codeFrom(referrer);
    expect(await rewardReferrer(code, await account())).toEqual({
      rewarded: false,
      reason: "referrer-holds-no-paid-plan",
    });
    expect(await allGrantsFor(referrer)).toHaveLength(0);
  });

  // **A trial is a grant, not a held plan**, so a trial-only account earns
  // nothing either. This is the case the rule is most easily lost on: the
  // account CAN use the assistant, so it looks paid from the outside.
  it("earns a trial-only referrer nothing", async () => {
    const referrer = await account("free");
    await offerTrial(referrer);
    expect(await accountCan(referrer, "ai.ask")).toBe(true);
    const code = await codeFrom(referrer);
    expect(await rewardReferrer(code, await account())).toEqual({
      rewarded: false,
      reason: "referrer-holds-no-paid-plan",
    });
    // The trial grant is the only one they hold; no referral was added.
    const grants = await allGrantsFor(referrer);
    expect(grants).toHaveLength(1);
    expect(grants[0]!.source).toBe("trial");
  });

  it("earns nothing when a code is redeemed by its own minter", async () => {
    const referrer = await account("premium");
    const code = await codeFrom(referrer);
    expect(await rewardReferrer(code, referrer)).toEqual({ rewarded: false, reason: "self-referral" });
    expect(await allGrantsFor(referrer)).toHaveLength(0);
  });

  it("earns nothing for a code nobody minted", async () => {
    expect(await rewardReferrer("NOSUCHCODE", await account())).toEqual({
      rewarded: false,
      reason: "unknown-code",
    });
  });

  // **The per-account cap holds under repeated redemption.**
  it("stops rewarding once the cap is reached", async () => {
    const referrer = await account("plus");
    for (let i = 0; i < REFERRAL_REWARD_CAP; i += 1) {
      const code = await codeFrom(referrer);
      // The outstanding-code cap is separate; spend each one immediately.
      await db.update(inviteCodes).set({ redeemedBy: "someone", redeemedAt: new Date() }).where(eq(inviteCodes.code, code));
      expect((await rewardReferrer(code, await account())).rewarded).toBe(true);
    }
    const code = await codeFrom(referrer);
    expect(await rewardReferrer(code, await account())).toEqual({
      rewarded: false,
      reason: "cap-reached",
    });
    expect(await allGrantsFor(referrer)).toHaveLength(REFERRAL_REWARD_CAP);
  });
});

describe("the reward outlives the subscription that earned it", () => {
  // **The gate box**: a referrer who earns a `premium` month and then
  // downgrades to `plus` keeps premium entitlements until the grant expires —
  // the resolver's union, with no special case anywhere.
  it("keeps premium after the referrer downgrades to plus", async () => {
    const referrer = await account("premium");
    const code = await codeFrom(referrer);
    const now = new Date("2026-09-13T12:00:00Z");
    expect((await rewardReferrer(code, await account(), now)).rewarded).toBe(true);

    // The downgrade. `users.plan_id` is what a cancelled subscription moves.
    await db.update(users).set({ planId: "plus" }).where(eq(users.id, referrer));

    // Held plan is `plus`; effective entitlements still include premium's.
    expect(await accountCan(referrer, "trip.collaborators", now)).toBe(true);
    // And it ends when the grant does, not when the subscription did.
    const after = new Date(now.getTime() + (REFERRAL_REWARD_DAYS + 1) * 24 * 60 * 60 * 1000);
    expect(await accountCan(referrer, "trip.collaborators", after)).toBe(false);
    expect(await accountCan(referrer, "ai.ask", after)).toBe(true);
  });
});
