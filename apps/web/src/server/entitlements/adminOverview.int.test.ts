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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ledgerReads = vi.fn();
const holderReads = vi.fn();
const priceSweeps = vi.fn();

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

vi.mock("@/server/billing/prices", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/billing/prices")>();
  return {
    ...actual,
    priceConsistencyReport: (...args: Parameters<typeof actual.priceConsistencyReport>) => {
      priceSweeps();
      return actual.priceConsistencyReport(...args);
    },
  };
});

const { adminFinancial, adminOverview, adminUsers } = await import("./admin");

beforeEach(() => {
  ledgerReads.mockClear();
  holderReads.mockClear();
  priceSweeps.mockClear();
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
  });
});

describe("the console's per-tab reads", () => {
  it("Financial reads the ledger and the grant holders once, and sweeps prices", async () => {
    const financial = await adminFinancial();
    expect(financial.plans.length).toBeGreaterThan(0);
    expect(ledgerReads.mock.calls).toEqual([["costPerAccount"]]);
    expect(holderReads).toHaveBeenCalledTimes(1);
    expect(priceSweeps).toHaveBeenCalledTimes(1);
  });

  it("Users reads the ledger once, and neither the grant holders nor Stripe", async () => {
    const users = await adminUsers();
    expect(users.livePlans.length).toBeGreaterThan(0);
    expect(ledgerReads.mock.calls).toEqual([["costPerAccount"]]);
    expect(holderReads).not.toHaveBeenCalled();
    expect(priceSweeps).not.toHaveBeenCalled();
  });
});
