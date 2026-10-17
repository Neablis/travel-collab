// **Who an account is at Stripe, per Stripe mode** (ADR-076 §2), against a
// real database.
//
// `stripeCustomerFor` is the one reader and writer of `stripe_customers`, and
// the failures it guards are quiet ones: a test-mode customer id handed to a
// live checkout is refused by Stripe, a second customer for one account splits
// its invoice history, and a customer id that migration 0055 failed to copy
// makes an existing subscriber a stranger at their next checkout.
//
// Stripe is stubbed at `createCustomer`, the one call this path makes. It
// answers the same id for the same account, as Stripe's idempotency key does.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { stripeCustomers, users } from "@/server/db/schema";
import { upsertUser } from "@/server/users";
import { livePlanVersion } from "@/server/entitlements/planVersions";
import { fakeStripeKey, otherFakeStripeKey } from "@/test-support/stripeSignature";

const createCustomer = vi.fn<(input: { userId: string; mode: string }) => Promise<{ id: string }>>();
vi.mock("./stripeApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./stripeApi")>()),
  createCustomer: (input: { userId: string; email: string | null; mode: string }) => createCustomer(input),
}));

const { portalUrlFor, startCheckout, stripeCustomerFor } = await import("./checkout");

const HERE = path.dirname(fileURLToPath(import.meta.url));

async function makeAccount(): Promise<string> {
  const id = `dev-${randomUUID()}`;
  await upsertUser({ id, email: `${id}@example.test`, name: null, image: null });
  return id;
}

const customersOf = (userId: string) =>
  db.select().from(stripeCustomers).where(eq(stripeCustomers.userId, userId));

beforeEach(() => {
  createCustomer.mockReset();
  createCustomer.mockImplementation(async ({ userId }) => ({ id: `cus_${userId}` }));
});

describe("the Stripe customer for an account", () => {
  it("creates one live customer the first time and reuses it after", async () => {
    const userId = await makeAccount();
    expect(await stripeCustomerFor(userId, true)).toBe(`cus_${userId}`);
    expect(await stripeCustomerFor(userId, true)).toBe(`cus_${userId}`);
    expect(createCustomer).toHaveBeenCalledTimes(1);
    expect(await customersOf(userId)).toMatchObject([{ livemode: true, customerId: `cus_${userId}` }]);
  });

  it("writes one row when two first checkouts race", async () => {
    const userId = await makeAccount();
    // Held until both have read "no customer", so both reach the insert.
    let release!: () => void;
    const bothRead = new Promise<void>((resolve) => (release = resolve));
    createCustomer.mockImplementation(async ({ userId: id }) => {
      if (createCustomer.mock.calls.length === 2) release();
      await bothRead;
      return { id: `cus_${id}` };
    });
    const both = await Promise.all([stripeCustomerFor(userId, true), stripeCustomerFor(userId, true)]);
    expect(both).toEqual([`cus_${userId}`, `cus_${userId}`]);
    expect(await customersOf(userId)).toHaveLength(1);
  });

  // Stripe's two modes are two customer spaces: the live key refuses a test
  // customer id, so one mode's row must never answer for the other.
  it("keeps a customer per mode, and never hands one mode's id to the other", async () => {
    const userId = await makeAccount();
    await db.insert(stripeCustomers).values({ userId, livemode: false, customerId: "cus_test_only" });

    expect(await stripeCustomerFor(userId, true)).toBe(`cus_${userId}`);
    expect(createCustomer).toHaveBeenCalledTimes(1);
    expect(await stripeCustomerFor(userId, false)).toBe("cus_test_only");
    const [test] = await db
      .select()
      .from(stripeCustomers)
      .where(and(eq(stripeCustomers.userId, userId), eq(stripeCustomers.livemode, false)));
    expect(test!.customerId).toBe("cus_test_only");
  });

  it("refuses to invent a customer for an account that does not exist", async () => {
    await expect(stripeCustomerFor(`dev-${randomUUID()}`, true)).rejects.toThrow(/No users row/);
    expect(createCustomer).not.toHaveBeenCalled();
  });
});

// **Migration 0055's copy, run as the migration runs it.** The template
// database is migrated before any row exists, so the statement is read out of
// the committed file and run over an account that predates it.
describe("a customer id from before stripe_customers", () => {
  it("reads back as that account's live customer", async () => {
    const migration = readFileSync(path.resolve(HERE, "../../../drizzle/0055_mode_keyed_billing.sql"), "utf8");
    const copy = migration
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .find((statement) => statement.startsWith('INSERT INTO "stripe_customers"'));
    expect(copy).toBeDefined();

    const userId = await makeAccount();
    await db.update(users).set({ stripeCustomerId: "cus_from_before" }).where(eq(users.id, userId));
    await db.execute(sql.raw(copy!));

    expect(await stripeCustomerFor(userId, true)).toBe("cus_from_before");
    expect(createCustomer).not.toHaveBeenCalled();
  });
});

// **A switched account buys in test mode** (ADR-076 §6). Its checkout and its
// portal use the test pair's key, its test customer and the test-mode Price;
// the live customer it already has is left alone. Stripe is stubbed at
// `fetch`, so the assertions are on the requests this module built.
describe("checkout for an account with the test-mode switch on", () => {
  const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>();
  const LIVE_KEY = fakeStripeKey("sk_live");
  const TEST_KEY = fakeStripeKey("sk_test");
  const plus = livePlanVersion("plus");

  beforeEach(() => {
    vi.stubEnv("STRIPE_SECRET_KEY", LIVE_KEY);
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", fakeStripeKey("whsec"));
    vi.stubEnv("STRIPE_TEST_SECRET_KEY", TEST_KEY);
    vi.stubEnv("STRIPE_TEST_WEBHOOK_SECRET", otherFakeStripeKey("whsec"));
    createCustomer.mockImplementation(async ({ userId, mode }) => ({ id: `cus_${mode}_${userId}` }));
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url) => {
      const { pathname } = new URL(url);
      const body =
        pathname === "/v1/prices"
          ? {
              data: [
                {
                  id: "price_plus",
                  active: true,
                  currency: plus.price!.currency,
                  unit_amount: plus.price!.minor,
                  lookup_key: null,
                  recurring: { interval: "month" },
                },
              ],
            }
          : pathname === "/v1/checkout/sessions"
            ? { id: "cs_1", url: "https://checkout.stripe.test/cs_1" }
            : { url: "https://billing.stripe.test/portal" };
      return new Response(JSON.stringify(body), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  async function switchedAccount(): Promise<string> {
    const userId = await makeAccount();
    await db.update(users).set({ stripeTestMode: true }).where(eq(users.id, userId));
    await db.insert(stripeCustomers).values({ userId, livemode: true, customerId: "cus_live_existing" });
    return userId;
  }

  /** Every Stripe call: the key it was made with, its path, and its form body. */
  const calls = () =>
    fetchMock.mock.calls.map(([url, init]) => ({
      key: (init.headers as Record<string, string>).Authorization,
      path: new URL(url).pathname,
      body: new URLSearchParams(typeof init.body === "string" ? init.body : ""),
    }));

  it("checks out with the test key and its test customer, leaving the live customer alone", async () => {
    const userId = await switchedAccount();
    await startCheckout({ userId, planId: "plus", returnOrigin: "https://app.test" });

    expect(createCustomer).toHaveBeenCalledWith(expect.objectContaining({ userId, mode: "test" }));
    expect(calls().map((call) => call.key)).toEqual(calls().map(() => `Bearer ${TEST_KEY}`));
    const session = calls().find((call) => call.path === "/v1/checkout/sessions");
    expect(session?.body.get("customer")).toBe(`cus_test_${userId}`);
    expect(await customersOf(userId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ livemode: true, customerId: "cus_live_existing" }),
        expect.objectContaining({ livemode: false, customerId: `cus_test_${userId}` }),
      ]),
    );
  });

  it("opens the portal on the test customer with the test key", async () => {
    const userId = await switchedAccount();
    await portalUrlFor({ userId, returnOrigin: "https://app.test" });
    expect(calls()).toHaveLength(1);
    expect(calls()[0]!.key).toBe(`Bearer ${TEST_KEY}`);
    expect(calls()[0]!.body.get("customer")).toBe(`cus_test_${userId}`);
  });

  it("checks out an unswitched account live, on its live customer", async () => {
    const userId = await switchedAccount();
    await db.update(users).set({ stripeTestMode: false }).where(eq(users.id, userId));
    await startCheckout({ userId, planId: "plus", returnOrigin: "https://app.test" });
    expect(createCustomer).not.toHaveBeenCalled();
    expect(new Set(calls().map((call) => call.key))).toEqual(new Set([`Bearer ${LIVE_KEY}`]));
    expect(calls().find((call) => call.path === "/v1/checkout/sessions")?.body.get("customer")).toBe(
      "cus_live_existing",
    );
  });
});
