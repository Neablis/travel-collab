// **The price-consistency sweep has a caller, and it is the operator console**
// (KI-2026-09-16-c).
//
// `checkPriceConsistency` was written as M21 link 2's gate box and then never
// invoked, so a published version whose Stripe Price charged a different number
// would have been reported by nothing. These tests hold that the console's one
// read carries its verdicts — and that a Stripe which is unconfigured or down
// costs the operator one panel, not the whole page.
//
// **Nothing here can reach Stripe.** `findPriceByLookupKey` and `createPrice`
// are replaced, and `fetch` is stubbed to throw so any call that slipped past
// the mock fails the test instead of leaving the machine (ADR-047).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StripePrice } from "@/server/billing/stripeApi";

const findPriceByLookupKey = vi.fn<(key: string) => Promise<StripePrice | null>>();
const createPrice = vi.fn();

vi.mock("@/server/billing/stripeApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/billing/stripeApi")>();
  return {
    ...actual,
    findPriceByLookupKey: (key: string) => findPriceByLookupKey(key),
    createPrice: (input: unknown) => createPrice(input),
  };
});

const { adminOverview } = await import("./admin");

function stripePrice(over: Partial<StripePrice> = {}): StripePrice {
  return {
    id: "price_plus",
    active: true,
    currency: "usd",
    unit_amount: 900,
    lookup_key: "plus_v1_usd_900",
    recurring: { interval: "month" },
    ...over,
  };
}

beforeEach(() => {
  findPriceByLookupKey.mockReset();
  createPrice.mockReset();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("this test must not reach the network");
    }),
  );
  // Test-shaped, and never real: billing only has to look configured.
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_not_a_real_key");
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_not_a_real_secret");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("the operator console reports whether the plan file and Stripe agree", () => {
  it("surfaces a Price that charges a different amount as a mismatch", async () => {
    findPriceByLookupKey.mockImplementation(async (key) =>
      key === "plus_v1_usd_900" ? stripePrice({ unit_amount: 1 }) : null,
    );
    const overview = await adminOverview();
    expect(overview.prices.status).toBe("checked");
    const rows = overview.prices.status === "checked" ? overview.prices.rows : [];
    expect(rows.find((row) => row.ref === "plus@v1")).toMatchObject({
      verdict: "mismatch",
      committed: { minor: 900, currency: "usd" },
      stripe: { id: "price_plus", minor: 1, currency: "usd" },
    });
    // A version nobody has bought yet is ordinary, not a finding.
    expect(rows.find((row) => row.ref === "premium@v1")?.verdict).toBe("missing");
    // **Checking is a read.** Creating the missing Price here would make the
    // console a write against the vendor.
    expect(createPrice).not.toHaveBeenCalled();
  });

  it("still renders the rest of the console when Stripe cannot be reached", async () => {
    findPriceByLookupKey.mockRejectedValue(new Error("stripe is down"));
    const overview = await adminOverview();
    expect(overview.prices).toMatchObject({ status: "unavailable" });
    expect(overview.plans.length).toBeGreaterThan(0);
  });

  it("does not ask Stripe at all on a deployment with no billing", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    const overview = await adminOverview();
    expect(overview.prices).toEqual({ status: "unconfigured" });
    expect(findPriceByLookupKey).not.toHaveBeenCalled();
  });
});
