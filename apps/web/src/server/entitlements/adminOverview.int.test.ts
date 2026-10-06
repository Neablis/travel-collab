// **One console page, one read of the ledger** (PR #234 review).
//
// Every panel on the operator console that speaks about the trailing window
// (plans, grant sources, accounts, top spenders, revenue, underwater) used to
// run its own `costPerAccount` — six reads of `ai_usage` per page — and two
// panels their own `activeGrantHolders`. A row written between two of those
// reads lands in some panels and not others, so the page could disagree with
// itself. `adminOverview` now reads each once and hands the rows down.
//
// The spies wrap the real functions, so the reads still happen against the
// test database; only the call count is observed. `topSpenders` is counted too
// because it is `costPerAccount(...).slice(0, n)` — a ledger read by another
// name. Billing is left unconfigured, so the price sweep never asks Stripe.
//
// **Each console tab reads only what it draws** (M36 link 1). Users is the one
// that must not pay for the price sweep, a Stripe round trip per published
// version that it never shows; the sweep is spied for that, and counted on the
// other two so a spy that never fires cannot pass the Users case.
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { aiUsage, subscriptions, users } from "@/server/db/schema";
import { upsertUser } from "@/server/users";

const ledgerReads = vi.fn();
const holderReads = vi.fn();
const priceSweeps = vi.fn();
const accountReads = vi.fn();
// Set by a test that needs the sweep to wait on something; null otherwise.
let sweepWaitsFor: Promise<unknown> | null = null;

vi.mock("./usage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./usage")>();
  return {
    ...actual,
    costPerAccount: (...args: Parameters<typeof actual.costPerAccount>) => {
      ledgerReads("costPerAccount");
      return actual.costPerAccount(...args);
    },
    topSpenders: (...args: Parameters<typeof actual.topSpenders>) => {
      ledgerReads("topSpenders");
      return actual.topSpenders(...args);
    },
    // Only the accounts table asks for request counts, so this is the moment
    // its reads start.
    requestCounts: (...args: Parameters<typeof actual.requestCounts>) => {
      accountReads();
      return actual.requestCounts(...args);
    },
  };
});

vi.mock("./grants", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./grants")>();
  return {
    ...actual,
    activeGrantHolders: (...args: Parameters<typeof actual.activeGrantHolders>) => {
      holderReads();
      return actual.activeGrantHolders(...args);
    },
  };
});

// The report the accounts table and Financial's panel share, built once.
const underwaterReports = vi.fn();
vi.mock("@/server/billing/revenue", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/billing/revenue")>();
  return {
    ...actual,
    underwaterReport: (...args: Parameters<typeof actual.underwaterReport>) => {
      underwaterReports();
      return actual.underwaterReport(...args);
    },
  };
});

vi.mock("@/server/billing/prices", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/billing/prices")>();
  return {
    ...actual,
    priceConsistencyReport: async (...args: Parameters<typeof actual.priceConsistencyReport>) => {
      priceSweeps();
      if (sweepWaitsFor !== null) await sweepWaitsFor;
      return actual.priceConsistencyReport(...args);
    },
  };
});

const { adminFinancial, adminOverview, adminUsers } = await import("./admin");

beforeEach(() => {
  ledgerReads.mockClear();
  holderReads.mockClear();
  priceSweeps.mockClear();
  underwaterReports.mockClear();
  accountReads.mockReset();
  sweepWaitsFor = null;
  vi.stubEnv("STRIPE_SECRET_KEY", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("adminOverview", () => {
  it("reads the trailing ledger once and the active grant holders once", async () => {
    const overview = await adminOverview();
    expect(overview.plans.length).toBeGreaterThan(0);
    expect(ledgerReads.mock.calls).toEqual([["costPerAccount"]]);
    expect(holderReads).toHaveBeenCalledTimes(1);
    expect(priceSweeps).toHaveBeenCalledTimes(1);
    expect(underwaterReports).toHaveBeenCalledTimes(1);
  });

  // **The accounts table is not held behind Stripe's price sweep** (M36 part 3
  // review). The sweep here finishes only once the table's reads have started,
  // or after two seconds if they never do; an overview that awaited the sweep
  // first takes the two seconds and records it in the wrong order.
  it("starts the accounts table's reads before the price sweep finishes", async () => {
    const order: string[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    const accountsStarted = new Promise<void>((resolve) => {
      accountReads.mockImplementation(() => {
        order.push("accounts");
        resolve();
      });
    });
    sweepWaitsFor = Promise.race([
      accountsStarted,
      new Promise((resolve) => (timer = setTimeout(resolve, 2_000))),
    ]).then(() => order.push("sweep"));
    try {
      await adminOverview();
    } finally {
      clearTimeout(timer);
    }
    expect(order).toEqual(["accounts", "sweep"]);
  });
});

describe("the console's per-tab reads", () => {
  // **The sweep is not Financial's database read** (M36 perf pass): the page
  // streams it in its own Suspense boundary, so Stripe's round trip — up to
  // three seconds — does not hold the tier panel and the four numbers.
  it("Financial reads the ledger and the grant holders once, and leaves Stripe to the page", async () => {
    const financial = await adminFinancial();
    expect(financial.plans.length).toBeGreaterThan(0);
    expect(ledgerReads.mock.calls).toEqual([["costPerAccount"]]);
    expect(holderReads).toHaveBeenCalledTimes(1);
    expect(priceSweeps).not.toHaveBeenCalled();
  });

  // The holders are read once, for the underwater report whose paying ids
  // drive the table's *Costs more than it pays* filter (M36 part 3 review).
  it("Users reads the ledger and the grant holders once, and never Stripe", async () => {
    const users = await adminUsers();
    // Shape, not data: this file can run first, on a database with no accounts.
    expect(Object.keys(users.table.counts)).toHaveLength(6);
    expect(ledgerReads.mock.calls).toEqual([["costPerAccount"]]);
    expect(holderReads).toHaveBeenCalledTimes(1);
    expect(priceSweeps).not.toHaveBeenCalled();
  });
});

// **Show them in Users finds every account Financial counted** (M36 part 3
// review). The overview's table is the newest 100 accounts and
// `underwaterReport` reads every account with a cost, so an underwater payer
// older than the 100 was counted on Financial and drawn nowhere. The Users tab
// pages in SQL now and has no bound; its underwater filter must still list it.
describe("the accounts table and the underwater count", () => {
  const DAY = 24 * 60 * 60 * 1000;

  it("has a row for an underwater payer older than the newest hundred accounts", async () => {
    const now = new Date();
    const payer = `dev-${randomUUID()}`;
    await upsertUser({ id: payer, email: null, name: null, image: null });
    await db.update(users).set({ createdAt: "2000-01-01T00:00:00.000Z" }).where(eq(users.id, payer));
    await db.insert(subscriptions).values({
      id: randomUUID(),
      userId: payer,
      stripeCustomerId: `cus_${payer}`,
      stripeSubscriptionId: `sub_${randomUUID()}`,
      planId: "plus",
      planVersion: 1,
      status: "active",
      currentPeriodEnd: new Date(now.getTime() + 10 * DAY),
      cancelAtPeriodEnd: false,
      pastDueSince: null,
      lastEventAt: new Date(now.getTime() - DAY),
      createdAt: new Date(now.getTime() - 60 * DAY),
      updatedAt: new Date(now.getTime() - DAY),
    });
    // Priced through the real rate record, as `revenue.int.test.ts` spends:
    // enough turns to cost more than `plus@v1` sends.
    await db.insert(aiUsage).values(
      Array.from({ length: 400 }, () => ({
        id: randomUUID(),
        userId: payer,
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
        createdAt: new Date(now.getTime() - DAY),
      })),
    );
    // A hundred newer accounts, so the payer is outside the table's bound
    // whatever else this run's database holds.
    const stamp = now.toISOString();
    await db
      .insert(users)
      .values(Array.from({ length: 100 }, () => ({ id: `dev-${randomUUID()}`, createdAt: stamp, updatedAt: stamp })));

    const overview = await adminOverview(now);
    // The witness: the payer is counted on Financial, so the case is live.
    expect(overview.underwater.paying.map((row) => row.userId)).toContain(payer);
    const rows = overview.accounts.filter((row) => row.userId === payer);
    expect(rows).toHaveLength(1);
    // Appended after the newest hundred, not among them. Its position past
    // them is not: another test's underwater payer, sharing this database, is
    // appended alongside it.
    expect(overview.accounts.findIndex((row) => row.userId === payer)).toBeGreaterThanOrEqual(100);
    // And the Users tab's own read, which is what the console draws: *Costs
    // more than it pays* lists it, on whichever page, however old it is.
    const listed: string[] = [];
    for (let page = 0; ; page += 1) {
      const { table } = await adminUsers(now, { query: "", filter: "underwater", page });
      if (table.page !== page) break;
      listed.push(...table.rows.map((row) => row.userId));
      expect(table.underwater).toEqual(table.rows.map((row) => row.userId));
      if (listed.length >= table.counts.underwater) break;
    }
    expect(listed.filter((id) => id === payer)).toHaveLength(1);
  });
});
