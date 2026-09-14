// **Tiered ceilings are a parameter, not a mechanism** (M20 link 5).
//
// `quota.property.test.ts` already pins the invariant universally — for ANY
// ceilings a plan version could name, the four bucket names are the same four
// literals. What that cannot show is the consequence a person would notice, and
// the milestone is explicit that naming the trap is not evidence it was
// avoided: **upgrading a tier must not reset a quota counter.**
//
// So this drives the real thing end to end against a real counter store: charge
// an account on `plus`'s ceiling, move it to `premium`, and assert the count
// carried. A tier-suffixed bucket would zero it here, which is both the upgrade
// bug and the exploit — toggle back and forth and farm free calls forever.
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { rateLimitCounters } from "@/server/db/schema";
import { aiQuotas, aiStepQuotas, consumeQuota } from "@/server/quota";
import { upsertUser } from "@/server/users";
import { eq } from "drizzle-orm";
import { users } from "@/server/db/schema";
import { entitlementsFor } from "./resolver";
import { planVersionFromRef } from "./planVersions";

const PLUS = planVersionFromRef("plus@v1").ceilings;
const PREMIUM = planVersionFromRef("premium@v1").ceilings;

async function accountOn(planId: "free" | "plus" | "premium"): Promise<string> {
  const id = `dev-${randomUUID()}`;
  await upsertUser({ id, email: null, name: null, image: null });
  await db.update(users).set({ planId, planVersion: 1 }).where(eq(users.id, id));
  return id;
}

describe("per-user ceilings come from the pinned plan version", () => {
  it("hands the account's own numbers to the quota policies", async () => {
    const plus = await entitlementsFor(await accountOn("plus"));
    const premium = await entitlementsFor(await accountOn("premium"));
    expect(plus.ceilings.perUserRequestsPerDay).toBe(50);
    expect(premium.ceilings.perUserRequestsPerDay).toBe(200);
    expect(aiQuotas(plus.ceilings).find((p) => p.name === "ai-daily")!.perUser).toBe(50);
    expect(aiQuotas(premium.ceilings).find((p) => p.name === "ai-daily")!.perUser).toBe(200);
    expect(aiStepQuotas(plus.ceilings).find((p) => p.name === "ai-steps-daily")!.perUser).toBe(400);
    expect(aiStepQuotas(premium.ceilings).find((p) => p.name === "ai-steps-daily")!.perUser).toBe(1600);
  });

  // **The other half of the split, and it is the half that is easy to lose.** A
  // per-user ceiling is a term that was SOLD and belongs on the immutable
  // version; a global ceiling is a deployment-wide abuse bound that protects
  // the operator's bill and was never sold to anyone. Republishing a plan must
  // not move one.
  it("leaves every global ceiling to the environment", () => {
    const globals = (ceilings: typeof PLUS) =>
      [...aiQuotas(ceilings), ...aiStepQuotas(ceilings)].map((policy) => policy.global);
    expect(globals(PLUS)).toEqual(globals(PREMIUM));
    // And a plan version cannot name one — the shape has no field for it.
    expect(Object.keys(PREMIUM).some((key) => /global/i.test(key))).toBe(false);
  });

  // The hourly window stays in the environment too, and that is a reading of
  // M20 rather than an omission: its plan table sells "AI requests · steps per
  // DAY", and the hourly window is the burst bound that stops a scripted loop,
  // not a term anyone bought.
  it("leaves the hourly window to the environment for both tiers", () => {
    const hourly = (ceilings: typeof PLUS) =>
      [...aiQuotas(ceilings), ...aiStepQuotas(ceilings)]
        .filter((policy) => policy.name.endsWith("-hourly"))
        .map((policy) => policy.perUser);
    expect(hourly(PLUS)).toEqual(hourly(PREMIUM));
  });
});

describe("upgrading a tier does not reset a quota counter", () => {
  beforeEach(async () => {
    await db.delete(rateLimitCounters);
  });

  it("carries the account's spend across the upgrade", async () => {
    const id = await accountOn("plus");
    const before = await entitlementsFor(id);

    // Three requests charged against `plus`'s 50/day.
    for (let i = 0; i < 3; i += 1) {
      expect(await consumeQuota(aiQuotas(before.ceilings), id)).toEqual({ allowed: true });
    }
    const charged = await db.select().from(rateLimitCounters);
    const daily = charged.find((row) => row.bucket === `ai-daily:user:${id}`);
    expect(daily!.hits).toBe(3);

    // The upgrade. `users.plan_id` is what a subscription would move (M21's
    // webhook); here it is moved directly, because M20 ships no checkout.
    await db.update(users).set({ planId: "premium" }).where(eq(users.id, id));
    const after = await entitlementsFor(id);
    expect(after.ceilings.perUserRequestsPerDay).toBe(200);

    // **The bucket did not move, so the count did not reset.** One more request
    // makes it four, not one.
    expect(await consumeQuota(aiQuotas(after.ceilings), id)).toEqual({ allowed: true });
    const afterRows = await db.select().from(rateLimitCounters);
    expect(afterRows.find((row) => row.bucket === `ai-daily:user:${id}`)!.hits).toBe(4);
    // And no second bucket appeared under a tier-suffixed name.
    expect(afterRows.filter((row) => row.bucket.includes(id)).map((row) => row.bucket).sort()).toEqual(
      ["ai-daily:user:" + id, "ai-hourly:user:" + id],
    );
  });

  // Downgrading is the same mechanism and the interesting direction: an account
  // that spent 60 requests on `premium` and drops to `plus` is already over the
  // new ceiling and is refused, rather than being handed a fresh allowance.
  it("refuses immediately when a downgrade lands below what was already spent", async () => {
    const id = await accountOn("premium");
    const premium = await entitlementsFor(id);
    const policies = aiQuotas(premium.ceilings);
    const daily = policies.find((policy) => policy.name === "ai-daily")!;
    // Charge past `plus`'s 50 without reaching `premium`'s 200.
    await db.insert(rateLimitCounters).values({
      bucket: `${daily.name}:user:${id}`,
      windowStart: new Date(Date.now() - 60_000),
      hits: 60,
    });

    await db.update(users).set({ planId: "plus" }).where(eq(users.id, id));
    const plus = await entitlementsFor(id);
    const decision = await consumeQuota(aiQuotas(plus.ceilings), id);
    expect(decision.allowed).toBe(false);
    expect(decision).toMatchObject({ reason: "user" });
  });
});
