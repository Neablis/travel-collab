// **Republishing a plan at a new price moves nobody** (M21's first exit-gate
// box, KI-2026-09-19-e).
//
// The box: republishing a plan at a new price leaves an existing subscriber's
// bill and entitlements untouched, while the next purchase charges the new
// price and grants the new terms. Until this file nothing held it. The only
// republished version on `main`, `premium@v2`, costs the same as `premium@v1`,
// and `prices.test.ts` proves the lookup key moves with the amount only in
// isolation. A checkout, webhook or resolver that read `livePlanVersion` where
// it should read the pinned version would have passed every test and been
// caught by the first real price change.
//
// **The new version is a fixture supplied to the test, not a published entry.**
// `plus@v2` below exists only in this file; `planVersions.ts` is untouched, as
// the entry asks. `PLAN_VERSIONS` is frozen (the immutability test next door
// proves it), so the fixture cannot be pushed onto it. Instead the module is
// wrapped: the four lookups that read the list are re-pointed at
// `PLAN_VERSIONS ++ republished`, and everything else is the real module.
// `republished` starts empty in each test, and the first test pins that the
// wrapper then agrees with the real lookups, so the wrapper can only add the
// fixture, never change an answer about what is really published.
//
// **What is real:** the webhook's attribution and its write to `users` and
// `subscriptions`, the resolver's read of the held plan, `startCheckout`'s
// version choice, `stripePriceFor`'s lookup key, and `revenue.ts`'s price read,
// all against a real database. **What is mocked:** Stripe, at the four
// functions of `stripeApi.ts` these paths call, and nothing further in.
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import type { PlanId } from "@tc/contracts";
import { db } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { upsertUser } from "@/server/users";
import type { StripePrice, StripeSubscription } from "@/server/billing/stripeApi";
import type { PlanVersion } from "./planVersions";

/** Versions this test publishes after the fact, appended to the real list. */
const republished: PlanVersion[] = [];

vi.mock("./planVersions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./planVersions")>();
  const all = (): readonly PlanVersion[] => [...actual.PLAN_VERSIONS, ...republished];
  return {
    ...actual,
    get PLAN_VERSIONS() {
      return all();
    },
    versionsOf: (planId: PlanId) => all().filter((entry) => entry.planId === planId),
    livePlanVersion: (planId: PlanId) => {
      const newest = all().filter((entry) => entry.planId === planId).at(-1);
      if (!newest) throw new actual.UnknownPlanVersionError(`${planId}@v?`);
      return newest;
    },
    planVersionFromRef: (ref: string) => {
      const found = all().find((entry) => actual.planVersionRefOf(entry) === ref);
      if (!found) throw new actual.UnknownPlanVersionError(ref);
      return found;
    },
    isPublishedRef: (ref: string) => all().some((entry) => actual.planVersionRefOf(entry) === ref),
  };
});

const retrieveSubscription = vi.fn<(id: string) => Promise<StripeSubscription>>();
const createPrice = vi.fn<(input: { lookupKey: string; currency: string; unitAmount: number }) => Promise<StripePrice>>();
const stripeRequest = vi.fn<(request: { path: string; body?: Record<string, unknown> }) => Promise<unknown>>();
vi.mock("@/server/billing/stripeApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/billing/stripeApi")>()),
  retrieveSubscription: (id: string) => retrieveSubscription(id),
  createCustomer: async ({ userId }: { userId: string }) => ({ id: `cus_${userId}` }),
  // No Price exists yet under any key, so `stripePriceFor` creates one, and
  // the key it creates under is what this file asserts.
  findPriceByLookupKey: async () => null,
  createPrice: (input: { lookupKey: string; currency: string; unitAmount: number }) => createPrice(input),
  stripeRequest: (request: { path: string; body?: Record<string, unknown> }) => stripeRequest(request),
}));

const actualPlanVersions = await vi.importActual<typeof import("./planVersions")>("./planVersions");
const planVersions = await import("./planVersions");
const { planVersionRefOf, priceLookupKey } = planVersions;
const { entitlementsFor } = await import("./resolver");
const { applyStripeEvent } = await import("@/server/billing/webhook");
const { startCheckout } = await import("@/server/billing/checkout");
const { subscriptionFor } = await import("@/server/billing/subscriptions");
const { monthlyMicroUsd, MICRO_USD_PER_MINOR } = await import("@/server/billing/revenue");

const PLUS_V1 = actualPlanVersions.planVersionFromRef("plus@v1");

/**
 * **`plus@v2`, at a different price and on different terms.** Dearer, one more
 * capability, higher ceilings, so that a subscriber wrongly moved onto it
 * differs from `plus@v1` on every axis this file checks, not only the price.
 */
const PLUS_V2: PlanVersion = Object.freeze({
  planId: "plus",
  version: 2,
  entitlements: Object.freeze(["ai.ask", "ai.command", "trip.collaborators"] as const),
  ceilings: Object.freeze({ perUserRequestsPerDay: 80, perUserStepsPerDay: 640, maxTier: null }),
  price: Object.freeze({ minor: 1200, currency: "usd", stripePriceId: null }),
  displayOrder: 2,
  publishedAt: "2026-10-15",
  enabled: true,
}) as PlanVersion;

const DAY = 24 * 60 * 60 * 1000;
const T0 = new Date("2026-10-01T12:00:00.000Z");
const T1 = new Date(T0.getTime() + 31 * DAY);

async function makeAccount(): Promise<string> {
  const id = `dev-${randomUUID()}`;
  await upsertUser({ id, email: null, name: null, image: null });
  return id;
}

function subscription(input: { id: string; userId: string; ref: string; periodEnd: Date }): StripeSubscription {
  return {
    id: input.id,
    customer: `cus_${input.userId}`,
    status: "active",
    cancel_at_period_end: false,
    current_period_end: Math.floor(input.periodEnd.getTime() / 1000),
    metadata: { userId: input.userId, planVersionRef: input.ref },
  };
}

function event(type: string, object: unknown, at: Date) {
  return {
    id: `evt_${randomUUID()}`,
    type,
    created: Math.floor(at.getTime() / 1000),
    data: { object: object as Record<string, unknown> },
  };
}

/** What a holder is stored as, read straight off the row the resolver reads. */
async function heldRow(userId: string): Promise<{ planId: string; planVersion: number }> {
  const [row] = await db
    .select({ planId: users.planId, planVersion: users.planVersion })
    .from(users)
    .where(eq(users.id, userId));
  return row!;
}

beforeEach(() => {
  republished.length = 0;
  retrieveSubscription.mockReset();
  createPrice.mockReset();
  stripeRequest.mockReset();
  createPrice.mockImplementation(async (input) => ({
    id: `price_${input.lookupKey}`,
    active: true,
    currency: input.currency,
    unit_amount: input.unitAmount,
    lookup_key: input.lookupKey,
    recurring: { interval: "month" },
  }));
  stripeRequest.mockImplementation(async (request) => {
    if (request.path !== "/checkout/sessions") throw new Error(`unexpected Stripe call ${request.path}`);
    return { id: "cs_new", url: "https://checkout.stripe.test/cs_new", customer: null, subscription: null, client_reference_id: null, status: "open" };
  });
});

describe("the wrapped plan list", () => {
  // If this fails, the fixture wrapper and the real module have drifted, and
  // nothing else in this file can be trusted.
  it("answers exactly as the real module does until something is republished", () => {
    for (const entry of actualPlanVersions.PLAN_VERSIONS) {
      const ref = actualPlanVersions.planVersionRefOf(entry);
      expect(planVersions.planVersionFromRef(ref)).toBe(actualPlanVersions.planVersionFromRef(ref));
      expect(planVersions.isPublishedRef(ref)).toBe(true);
      expect(planVersions.livePlanVersion(entry.planId)).toBe(actualPlanVersions.livePlanVersion(entry.planId));
    }
    expect(planVersions.PLAN_VERSIONS).toEqual(actualPlanVersions.PLAN_VERSIONS);
    expect(planVersions.isPublishedRef("plus@v2")).toBe(false);
  });
});

describe("republishing plus at a new price", () => {
  it("leaves an existing subscriber on the version, price and entitlements it bought", async () => {
    // **A subscriber to plus@v1**, through the real webhook.
    const userId = await makeAccount();
    const subId = `sub_${randomUUID()}`;
    retrieveSubscription.mockResolvedValue(
      subscription({ id: subId, userId, ref: "plus@v1", periodEnd: new Date(T0.getTime() + 30 * DAY) }),
    );
    await applyStripeEvent(
      event("checkout.session.completed", { id: "cs_old", subscription: subId, client_reference_id: `${userId}|plus@v1` }, T0),
      T0,
    );
    expect(await heldRow(userId)).toEqual({ planId: "plus", planVersion: 1 });
    const bought = await entitlementsFor(userId, T0);

    // **plus@v2 is published at $12.** From here, what a new buyer gets is v2;
    // asserted so the rest of this test cannot pass because the fixture never
    // became visible.
    republished.push(PLUS_V2);
    expect(planVersionRefOf(planVersions.livePlanVersion("plus"))).toBe("plus@v2");

    // **A month later the subscription renews**, and every event a renewal
    // sends goes through the same write path a price change would have to
    // corrupt. Stripe still says the subscription is plus@v1, because it is.
    const renewed = subscription({ id: subId, userId, ref: "plus@v1", periodEnd: new Date(T1.getTime() + 30 * DAY) });
    retrieveSubscription.mockResolvedValue(renewed);
    await applyStripeEvent(event("customer.subscription.updated", renewed, T1), T1);
    await applyStripeEvent(event("invoice.payment_succeeded", { id: "in_renewal", subscription: subId }, T1), T1);

    // What the account holds, and what the subscription pins: unchanged.
    expect(await heldRow(userId)).toEqual({ planId: "plus", planVersion: 1 });
    const row = await subscriptionFor(userId);
    expect(row).toMatchObject({ planId: "plus", planVersion: 1, status: "active" });

    // What the account may do: v1's terms, not v2's.
    const now = await entitlementsFor(userId, T1);
    expect(planVersionRefOf(now.held)).toBe("plus@v1");
    expect(now.held).toBe(PLUS_V1);
    expect([...now.entitlements].sort()).toEqual([...bought.entitlements].sort());
    expect(now.entitlements.has("trip.collaborators")).toBe(false);
    expect(now.ceilings).toEqual(PLUS_V1.ceilings);

    // What the account is billed: v1's price, under v1's Stripe Price key.
    expect(monthlyMicroUsd(row!)).toBe(900 * MICRO_USD_PER_MINOR);
    expect(priceLookupKey(planVersions.planVersionFromRef(`${row!.planId}@v${row!.planVersion}`))).toBe("plus_v1_usd_900");
  });

  it("sells the new version, at the new price, to the next buyer", async () => {
    republished.push(PLUS_V2);
    const userId = await makeAccount();

    const started = await startCheckout({ userId, planId: "plus", returnOrigin: "https://app.test" });

    // **The session is for plus@v2**, priced from a Stripe Price created under
    // v2's key and amount. None of it came from v1.
    expect(started.planVersionRef).toBe("plus@v2");
    expect(createPrice).toHaveBeenCalledTimes(1);
    expect(createPrice.mock.calls[0]![0]).toMatchObject({ lookupKey: "plus_v2_usd_1200", unitAmount: 1200, currency: "usd" });
    const body = stripeRequest.mock.calls[0]![0].body as {
      line_items: Array<{ price: string }>;
      client_reference_id: string;
      subscription_data: { metadata: { planVersionRef: string } };
    };
    expect(body.line_items).toEqual([{ price: "price_plus_v2_usd_1200", quantity: 1 }]);
    expect(body.client_reference_id).toBe(`${userId}|plus@v2`);
    expect(body.subscription_data.metadata.planVersionRef).toBe("plus@v2");

    // **And the webhook grants what was sold**: v2's terms, from the session's
    // own reference.
    const subId = `sub_${randomUUID()}`;
    retrieveSubscription.mockResolvedValue(
      subscription({ id: subId, userId, ref: "plus@v2", periodEnd: new Date(T0.getTime() + 30 * DAY) }),
    );
    await applyStripeEvent(
      event("checkout.session.completed", { id: started.sessionId, subscription: subId, client_reference_id: body.client_reference_id }, T0),
      T0,
    );
    expect(await heldRow(userId)).toEqual({ planId: "plus", planVersion: 2 });
    const granted = await entitlementsFor(userId, T0);
    expect(granted.held).toBe(PLUS_V2);
    expect(granted.entitlements.has("trip.collaborators")).toBe(true);
    expect(granted.ceilings).toEqual(PLUS_V2.ceilings);
    expect(monthlyMicroUsd((await subscriptionFor(userId))!)).toBe(1200 * MICRO_USD_PER_MINOR);
  });
});
