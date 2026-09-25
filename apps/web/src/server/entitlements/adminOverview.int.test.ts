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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ledgerReads = vi.fn();
const holderReads = vi.fn();

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

const { adminOverview } = await import("./admin");

beforeEach(() => {
  ledgerReads.mockClear();
  holderReads.mockClear();
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
  });
});
