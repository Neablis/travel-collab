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
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { stripeCustomers, users } from "@/server/db/schema";
import { upsertUser } from "@/server/users";
import { deploymentOrigin } from "@/lib/deploymentOrigin";
import { fakeStripeKey, otherFakeStripeKey } from "@/test-support/stripeSignature";
import type { StripeMode } from "./config";

const createCustomer = vi.fn<(input: { userId: string; mode?: StripeMode }) => Promise<{ id: string }>>();
const stripeRequest = vi.fn<(request: { mode: StripeMode; path: string; body?: Record<string, unknown> }) => Promise<unknown>>();
vi.mock("./stripeApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./stripeApi")>()),
  createCustomer: (input: { userId: string; email: string | null; mode: StripeMode }) => createCustomer(input),
  stripeRequest: (request: { mode: StripeMode; path: string; body?: Record<string, unknown> }) =>
    stripeRequest(request),
}));
vi.mock("./prices", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./prices")>()),
  stripePriceFor: async (_version: unknown, mode: StripeMode) => `price_${mode}`,
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
  createCustomer.mockImplementation(async ({ userId, mode }) => ({ id: `cus_${mode ?? "live"}_${userId}` }));
  stripeRequest.mockReset();
  stripeRequest.mockResolvedValue({ id: "cs_1", url: "https://checkout.stripe.test/cs_1" });
});

describe("the Stripe customer for an account", () => {
  it("creates one live customer the first time and reuses it after", async () => {
    const userId = await makeAccount();
    expect(await stripeCustomerFor(userId, true)).toBe(`cus_live_${userId}`);
    expect(await stripeCustomerFor(userId, true)).toBe(`cus_live_${userId}`);
    expect(createCustomer).toHaveBeenCalledTimes(1);
    expect(await customersOf(userId)).toMatchObject([{ livemode: true, customerId: `cus_live_${userId}` }]);
  });

  it("writes one row when two first checkouts race", async () => {
    const userId = await makeAccount();
    // Held until both have read "no customer", so both reach the insert.
    let release!: () => void;
    const bothRead = new Promise<void>((resolve) => (release = resolve));
    createCustomer.mockImplementation(async ({ userId: id }) => {
      if (createCustomer.mock.calls.length === 2) release();
      await bothRead;
      return { id: `cus_live_${id}` };
    });
    const both = await Promise.all([stripeCustomerFor(userId, true), stripeCustomerFor(userId, true)]);
    expect(both).toEqual([`cus_live_${userId}`, `cus_live_${userId}`]);
    expect(await customersOf(userId)).toHaveLength(1);
  });

  // Stripe's two modes are two customer spaces: the live key refuses a test
  // customer id, so one mode's row must never answer for the other.
  it("keeps a customer per mode, and never hands one mode's id to the other", async () => {
    const userId = await makeAccount();
    await db.insert(stripeCustomers).values({ userId, livemode: false, customerId: "cus_test_only" });

    expect(await stripeCustomerFor(userId, true)).toBe(`cus_live_${userId}`);
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

// **The mode an unswitched account buys and manages in**: the primary pair's.
// Live where a live key is primary, whatever test pair sits beside it, and
// test where the only key is a test key (PR 476 review, finding 4).
describe("the mode checkout and the portal use", () => {
  const LIVE = { STRIPE_SECRET_KEY: fakeStripeKey("sk_live"), STRIPE_WEBHOOK_SECRET: fakeStripeKey("whsec") };
  const TEST_PAIR = {
    STRIPE_TEST_SECRET_KEY: fakeStripeKey("sk_test"),
    STRIPE_TEST_WEBHOOK_SECRET: otherFakeStripeKey("whsec"),
  };

  it.each([
    ["live beside a test pair", { ...LIVE, ...TEST_PAIR }, "live"],
    // A broken test pair must not cost the live sale (finding 1).
    ["live beside half a test pair", { ...LIVE, STRIPE_TEST_SECRET_KEY: fakeStripeKey("sk_test") }, "live"],
    ["a lone test pair", { STRIPE_SECRET_KEY: fakeStripeKey("sk_test"), STRIPE_WEBHOOK_SECRET: fakeStripeKey("whsec") }, "test"],
  ] as const)("is %s's primary mode", async (_what, env, mode) => {
    for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
    onTestFinished(() => {
      vi.unstubAllEnvs();
    });
    const userId = await makeAccount();

    await startCheckout({ userId, planId: "plus", returnOrigin: "http://localhost" });
    const [checkout] = stripeRequest.mock.calls.at(-1)!;
    expect(checkout).toMatchObject({
      mode,
      path: "/checkout/sessions",
      body: {
        customer: `cus_${mode}_${userId}`,
        line_items: [{ price: `price_${mode}` }],
        subscription_data: { metadata: { deploymentOrigin: deploymentOrigin() } },
        metadata: { deploymentOrigin: deploymentOrigin() },
      },
    });
    expect(await customersOf(userId)).toMatchObject([{ livemode: mode === "live" }]);

    stripeRequest.mockResolvedValue({ url: "https://billing.stripe.test/p" });
    await portalUrlFor({ userId, returnOrigin: "http://localhost" });
    const [portal] = stripeRequest.mock.calls.at(-1)!;
    expect(portal).toMatchObject({ mode, path: "/billing_portal/sessions", body: { customer: `cus_${mode}_${userId}` } });
  });
});
