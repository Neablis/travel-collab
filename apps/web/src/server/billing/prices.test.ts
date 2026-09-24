import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PLAN_VERSIONS, priceLookupKey, type PlanVersion } from "@/server/entitlements/planVersions";
import { StripeApiError, type StripePrice } from "./stripeApi";

// **The worst class of billing bug is the one where nothing errors** (M21 link
// 2): a plan version whose Stripe Price says a different number, so the pricing
// page and the card statement disagree and every system involved looks
// consistent. Nothing catches that except a check that compares them, which is
// why the milestone makes it a gate box and why this file is where it lives.

const findPriceByLookupKey = vi.fn<(key: string) => Promise<StripePrice | null>>();
const createPrice = vi.fn();

vi.mock("./stripeApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./stripeApi")>();
  return {
    ...actual,
    findPriceByLookupKey: (key: string) => findPriceByLookupKey(key),
    createPrice: (input: unknown) => createPrice(input),
  };
});

const {
  assertPriceMatches,
  checkPriceConsistency,
  PRICE_CHECK_DEADLINE_MS,
  priceConsistencyReport,
  PriceMismatchError,
  stripePriceFor,
  UnpurchasableVersionError,
} = await import("./prices");

const plan = (planId: string): PlanVersion =>
  PLAN_VERSIONS.find((entry) => entry.planId === planId && entry.version === 1)!;

function stripePrice(over: Partial<StripePrice> = {}): StripePrice {
  return {
    id: "price_abc",
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
});

describe("the lookup key is a function of the price, so the two cannot disagree", () => {
  it("names the plan, the version, the currency and the amount", () => {
    expect(priceLookupKey(plan("plus"))).toBe("plus_v1_usd_900");
    expect(priceLookupKey(plan("premium"))).toBe("premium_v1_usd_1900");
  });

  // The property that makes committing a key safer than committing an id:
  // changing the amount resolves to a DIFFERENT Stripe Price rather than
  // silently reusing the old one, which Stripe's own immutable Prices would
  // otherwise make into a mismatch nobody notices.
  it("changes when the amount changes", () => {
    const dearer: PlanVersion = { ...plan("plus"), price: { minor: 1000, currency: "usd", stripePriceId: null } };
    expect(priceLookupKey(dearer)).not.toBe(priceLookupKey(plan("plus")));
  });

  it("is null for a version nothing sells", () => {
    expect(priceLookupKey(plan("studio"))).toBeNull();
    // `free` costs nothing, and a checkout for nothing is not how anyone
    // reaches it — cancelling is (M21 link 5).
    expect(priceLookupKey(plan("free"))).toBeNull();
  });
});

describe("resolving a plan version to the Stripe Price it is sold as", () => {
  it("uses the Price already carrying the key", async () => {
    findPriceByLookupKey.mockResolvedValue(stripePrice());
    await expect(stripePriceFor(plan("plus"))).resolves.toBe("price_abc");
    expect(createPrice).not.toHaveBeenCalled();
  });

  it("creates one the first time a published price is bought", async () => {
    findPriceByLookupKey.mockResolvedValue(null);
    createPrice.mockResolvedValue(stripePrice({ id: "price_new" }));
    await expect(stripePriceFor(plan("plus"))).resolves.toBe("price_new");
    expect(createPrice).toHaveBeenCalledWith(
      expect.objectContaining({ lookupKey: "plus_v1_usd_900", unitAmount: 900, currency: "usd" }),
    );
  });

  // **Two first checkouts at the same moment.** Both find nothing, both create,
  // and Stripe refuses the second because a lookup key is unique per account.
  // The Price the winner created is the right one; showing the loser an error
  // would fail a checkout for a reason that is not the buyer's.
  it("recovers when another request created the same Price first", async () => {
    findPriceByLookupKey.mockResolvedValueOnce(null).mockResolvedValueOnce(stripePrice({ id: "price_raced" }));
    createPrice.mockRejectedValue(new StripeApiError(400, "resource_already_exists", "taken"));
    await expect(stripePriceFor(plan("plus"))).resolves.toBe("price_raced");
  });

  it("refuses a Price that charges a different amount, rather than making a second one", async () => {
    findPriceByLookupKey.mockResolvedValue(stripePrice({ unit_amount: 1000 }));
    await expect(stripePriceFor(plan("plus"))).rejects.toBeInstanceOf(PriceMismatchError);
    expect(createPrice).not.toHaveBeenCalled();
  });

  it("refuses a Price in a different currency", async () => {
    findPriceByLookupKey.mockResolvedValue(stripePrice({ currency: "eur" }));
    await expect(stripePriceFor(plan("plus"))).rejects.toBeInstanceOf(PriceMismatchError);
  });

  it.each([
    ["a disabled plan", "studio"],
    ["a plan that costs nothing", "free"],
  ])("refuses to check out %s", async (_what, planId) => {
    await expect(stripePriceFor(plan(planId))).rejects.toBeInstanceOf(UnpurchasableVersionError);
    expect(findPriceByLookupKey).not.toHaveBeenCalled();
  });
});

describe("the consistency check the gate box asks for", () => {
  it("reports a matching Price as ok and an absent one as missing, not as a fault", async () => {
    // `missing` is ordinary: a price published in a deploy nobody has bought
    // from yet has no Stripe Price, and creating one as a side effect of
    // CHECKING would make the check a write.
    findPriceByLookupKey.mockImplementation(async (key) =>
      key === "plus_v1_usd_900" ? stripePrice() : null,
    );
    const rows = await checkPriceConsistency();
    expect(rows.find((row) => row.ref === "plus@v1")?.verdict).toBe("ok");
    expect(rows.find((row) => row.ref === "premium@v1")?.verdict).toBe("missing");
    expect(rows.find((row) => row.ref === "studio@v1")?.verdict).toBe("unpriced");
    expect(createPrice).not.toHaveBeenCalled();
  });

  it("reports a divergence as a mismatch, which is the finding", async () => {
    findPriceByLookupKey.mockResolvedValue(stripePrice({ unit_amount: 1 }));
    const rows = await checkPriceConsistency();
    expect(rows.find((row) => row.ref === "plus@v1")).toMatchObject({
      verdict: "mismatch",
      committed: { minor: 900, currency: "usd" },
      stripe: { minor: 1, currency: "usd" },
    });
    // **Exactly the two facts the row's type names**, and nothing else from the
    // plan record: a spread of `entry.price` also shipped `stripePriceId` to
    // the console under a type that did not declare it.
    expect(rows.find((row) => row.ref === "plus@v1")?.committed).toEqual({ minor: 900, currency: "usd" });
  });

  it("checks amount and currency, which is exactly what the box names", () => {
    expect(() => assertPriceMatches(plan("plus"), stripePrice())).not.toThrow();
    expect(() => assertPriceMatches(plan("plus"), stripePrice({ unit_amount: null }))).toThrow(
      PriceMismatchError,
    );
  });
});

// **The console waits for the sweep, so the sweep must not wait on Stripe for
// long.** Each Stripe call has its own 15s timeout (right for checkout), and the
// sweep asks one version after another — a stalled Stripe would hold `/admin`
// for that per version. The report gives up at a short deadline instead.
describe("the console's price report", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_not_a_real_key");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_not_a_real_secret");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("gives up at its deadline when Stripe never answers", async () => {
    findPriceByLookupKey.mockImplementation(() => new Promise<never>(() => {}));
    let settled: unknown;
    void priceConsistencyReport().then((report) => (settled = report));
    await vi.advanceTimersByTimeAsync(PRICE_CHECK_DEADLINE_MS);
    expect(settled).toEqual({ status: "unavailable", reason: "timed out" });
    expect(PRICE_CHECK_DEADLINE_MS).toBeLessThanOrEqual(3_000);
  });

  it("clears its deadline when Stripe answers in time", async () => {
    findPriceByLookupKey.mockResolvedValue(null);
    const report = await priceConsistencyReport();
    expect(report.status).toBe("checked");
    // A leftover timer per console load is the leak the `finally` exists for.
    expect(vi.getTimerCount()).toBe(0);
  });
});
