// **Link 7's own gate box, which names the test it wants**:
//
// > *"A test seeds one comped account and one genuinely-underwater paying
// > account and asserts they land in different buckets — unsegmented, the
// > comped accounts swamp the list and the metric is worthless."*
//
// That is the shape of this file, and it needs a database because both halves
// are joins across three tables this pair of milestones owns: `subscriptions`
// for what is paid, `ai_usage` for what is spent, `entitlement_grants` for why
// an account has what it has.
//
// **The failure it guards against is not a crash.** A merged list still renders,
// still sorts, and is still wrong — on this deployment every account predating
// M20's migration holds a permanent founder grant, so the comped accounts would
// be most of it and the rows that need a decision would be at the bottom.
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { aiUsage, entitlementGrants, subscriptions, users } from "@/server/db/schema";
import { upsertUser } from "@/server/users";
import { issueGrant } from "@/server/entitlements/grants";
import { MICRO_USD_PER_MINOR, monthlyMicroUsd, revenueSummary, underwaterReport } from "./revenue";

const WINDOW = 30;
const NOW = new Date("2026-11-01T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

// **The suite owns the whole database**, unlike its siblings which mint ids and
// leave rows behind. Every number here is an aggregate over EVERY row — MRR is
// a sum and ARPU is a division by the account count — so a leftover account
// from another test is not isolation noise, it is a wrong answer.
beforeEach(async () => {
  await db.execute(sql`truncate table ${subscriptions}, ${aiUsage}, ${entitlementGrants}, ${users}`);
});

async function account(): Promise<string> {
  const id = `dev-${randomUUID()}`;
  await upsertUser({ id, email: null, name: null, image: null });
  return id;
}

/** A conferring subscription on a real plan, at that plan's real price. */
async function subscribe(userId: string, planId: "plus" | "premium"): Promise<void> {
  await db.insert(subscriptions).values({
    id: randomUUID(),
    userId,
    stripeCustomerId: `cus_${userId}`,
    stripeSubscriptionId: `sub_${randomUUID()}`,
    planId,
    planVersion: 1,
    status: "active",
    currentPeriodEnd: new Date(NOW.getTime() + 10 * DAY),
    cancelAtPeriodEnd: false,
    pastDueSince: null,
    lastEventAt: new Date(NOW.getTime() - DAY),
    createdAt: new Date(NOW.getTime() - 60 * DAY),
    updatedAt: new Date(NOW.getTime() - DAY),
  });
}

/**
 * Spend money on the assistant — as many rows as it takes to exceed `atLeast`.
 *
 * Priced through the same dated rate record the console uses, rather than by
 * writing a dollar figure: a test that invented a cost would pass against a
 * change that broke the rate join, which is the one thing making these numbers
 * real.
 */
async function spend(userId: string, rows: number): Promise<void> {
  for (let index = 0; index < rows; index += 1) {
    await db.insert(aiUsage).values({
      id: randomUUID(),
      userId,
      endpoint: "ask",
      outcome: "ok",
      taskClass: "plan",
      turnModel: "deepseek/deepseek-v4-flash-0731",
      turnTokensIn: 2_000_000,
      turnTokensOut: 500_000,
      classifierModel: null,
      classifierTokensIn: null,
      classifierTokensOut: null,
      steps: 8,
      planVersionRef: "plus@v1",
      createdAt: new Date(NOW.getTime() - DAY),
    });
  }
}

describe("what a subscription is worth", () => {
  // **What you bought is what you get, in the revenue number.** The price comes
  // off the version the subscription PINS, so an account on `plus@v1` at $9
  // keeps contributing $9 after a `plus@v2` at $12 is published.
  it("reads the price off the pinned version, not the live one", async () => {
    const userId = await account();
    await subscribe(userId, "plus");
    const [row] = await db.select().from(subscriptions);
    expect(monthlyMicroUsd(row!)).toBe(900 * MICRO_USD_PER_MINOR);
  });

  it("reports a version it cannot price as null rather than as free", async () => {
    const userId = await account();
    await subscribe(userId, "plus");
    await db.update(subscriptions).set({ planVersion: 99 });
    const [row] = await db.select().from(subscriptions);
    // Not zero. A subscription we cannot price is a reporting gap, and counting
    // it as free would understate MRR in silence.
    expect(monthlyMicroUsd(row!)).toBeNull();
  });
});

describe("the four numbers", () => {
  it("sums MRR from conferring subscriptions only", async () => {
    const paying = await account();
    const lapsed = await account();
    await subscribe(paying, "premium");
    await subscribe(lapsed, "plus");
    await db
      .update(subscriptions)
      .set({ status: "canceled" })
      .where(sql`${subscriptions.userId} = ${lapsed}`);

    const summary = await revenueSummary(WINDOW, NOW);
    expect(summary.mrrMicroUsd).toBe(1900 * MICRO_USD_PER_MINOR);
    expect(summary.payingAccounts).toBe(1);
  });

  // **The whole reason ARPU is reported twice.** Here it is three accounts and
  // one payer, so the two differ by a factor of three — and with founder,
  // trial and referral grants in a real deployment they differ by far more.
  it("reports ARPU across all accounts and across payers, and they differ", async () => {
    const paying = await account();
    await account();
    await account();
    await subscribe(paying, "plus");

    const summary = await revenueSummary(WINDOW, NOW);
    expect(summary.accounts).toBe(3);
    expect(summary.payingAccounts).toBe(1);
    expect(summary.arpuPayingMicroUsd).toBe(900 * MICRO_USD_PER_MINOR);
    expect(summary.arpuAllMicroUsd).toBe(Math.floor((900 * MICRO_USD_PER_MINOR) / 3));
    expect(summary.arpuAllMicroUsd).not.toBe(summary.arpuPayingMicroUsd);
  });

  // Median over payers, and a comped heavy user must not drag it — the same
  // reasoning the tier panel's cost median already carries.
  it("takes the median margin over paying accounts only", async () => {
    const light = await account();
    const heavy = await account();
    const comped = await account();
    await subscribe(light, "plus");
    await subscribe(heavy, "plus");
    await spend(heavy, 4);
    await spend(comped, 400);
    await issueGrant({
      userId: comped,
      planId: "premium",
      planVersion: 1,
      source: "founder",
      expiresAt: null,
    });

    const summary = await revenueSummary(WINDOW, NOW);
    // Two payers, so the median is the lower of the two middles — the heavy
    // one. The comped account contributes nothing to it at all.
    expect(summary.medianMarginMicroUsd).not.toBeNull();
    expect(summary.medianMarginMicroUsd!).toBeLessThan(900 * MICRO_USD_PER_MINOR);
    expect(summary.payingAccounts).toBe(2);
  });

  it("reports no margin at all rather than zero when nobody is paying", async () => {
    await account();
    const summary = await revenueSummary(WINDOW, NOW);
    expect(summary.medianMarginMicroUsd).toBeNull();
    expect(summary.mrrMicroUsd).toBe(0);
  });
});

describe("costs more than it pays, segmented by why", () => {
  /**
   * **The gate box's own scenario.** One comped account burning money and one
   * paying account burning more than it sends, and they must not land in the
   * same list.
   */
  async function seedBothKinds(): Promise<{ comped: string; underwater: string }> {
    const comped = await account();
    await issueGrant({
      userId: comped,
      planId: "premium",
      planVersion: 1,
      source: "founder",
      expiresAt: null,
    });
    await spend(comped, 300);

    const underwater = await account();
    await subscribe(underwater, "plus");
    // Enough requests that the trailing cost clears $9.
    await spend(underwater, 400);

    return { comped, underwater };
  }

  it("puts the comped account and the paying one in different buckets", async () => {
    const { comped, underwater } = await seedBothKinds();
    const report = await underwaterReport(WINDOW, NOW);

    expect(report.paying.map((row) => row.userId)).toEqual([underwater]);
    // **And the comped one is nowhere near that list.** It is a count under its
    // source, which is what "set aside" means.
    expect(report.paying.map((row) => row.userId)).not.toContain(comped);
    expect(report.grantFunded.find((row) => row.source === "founder")?.accounts).toBe(1);
  });

  it("reports the grant-funded half as a count, never as a list of accounts", async () => {
    await seedBothKinds();
    const report = await underwaterReport(WINDOW, NOW);
    const founder = report.grantFunded.find((row) => row.source === "founder");
    expect(founder).toBeDefined();
    expect(Object.keys(founder!)).toEqual(["source", "accounts", "costMicroUsd"]);
    // Underwater by construction is a decision already taken, so what it costs
    // is worth knowing and who they are is not a finding.
    expect(founder!.costMicroUsd).toBeGreaterThan(0);
  });

  it("leaves a paying account that covers its cost out of the list entirely", async () => {
    const thrifty = await account();
    await subscribe(thrifty, "premium");
    await spend(thrifty, 2);
    const report = await underwaterReport(WINDOW, NOW);
    expect(report.paying).toEqual([]);
  });

  // **A payer who is ALSO comped is still a payer.** Being granted something as
  // well does not make its bill a decision somebody already took, and shunting
  // it into the set-aside bucket would hide the row that needs an answer.
  // **The two segments are disjoint, and that is the claim the report rests
  // on.** A paying grant holder was appearing in `paying` AND under its grant
  // source, so the same account was counted twice and the "set aside" half
  // stopped meaning what it says. CodeRabbit, PR #177.
  it("counts a paying grant holder once, in the paying half only", async () => {
    const both = await account();
    await subscribe(both, "plus");
    await issueGrant({
      userId: both,
      planId: "premium",
      planVersion: 1,
      source: "admin",
      grantedBy: "dev-operator",
      reason: "support case",
      expiresAt: null,
    });
    await spend(both, 400);

    const report = await underwaterReport(WINDOW, NOW);
    expect(report.paying.map((row) => row.userId)).toEqual([both]);
    expect(report.grantFunded.find((row) => row.source === "admin")).toBeUndefined();
  });

  it("counts a paying account that also holds a grant as paying", async () => {
    const both = await account();
    await subscribe(both, "plus");
    await issueGrant({
      userId: both,
      planId: "premium",
      planVersion: 1,
      source: "admin",
      grantedBy: "dev-operator",
      reason: "support case",
      expiresAt: null,
    });
    await spend(both, 400);

    const report = await underwaterReport(WINDOW, NOW);
    expect(report.paying.map((row) => row.userId)).toEqual([both]);
  });
});
