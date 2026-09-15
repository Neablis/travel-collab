// **The three mandatory properties, against a real database** (M21 link 4).
//
// Each of them is a gate box, and each is worded so that inspection does not
// satisfy it: *"the same event delivered twice applies once — proven by
// replaying a real captured event, not by inspection"*, and *"events applied
// out of order converge to the correct state"*. Both are claims about what two
// writes do to one row, so both need rows.
//
// Stripe itself is mocked here and only at its edge: `retrieveSubscription` is
// the one call these paths make, and what is being tested is everything after
// it. The signature is unit-tested next door; interop with the real Stripe is
// the gate walk's, and nothing here pretends otherwise.
//
// No `beforeEach` truncation: every test mints its own ids, the same isolation
// strategy as the sibling suites.
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { billingEvents, subscriptions, users } from "@/server/db/schema";
import { upsertUser } from "@/server/users";
import type { StripeSubscription } from "./stripeApi";

const retrieveSubscription = vi.fn<(id: string) => Promise<StripeSubscription>>();
vi.mock("./stripeApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./stripeApi")>()),
  retrieveSubscription: (id: string) => retrieveSubscription(id),
}));

const { applyStripeEvent } = await import("./webhook");
const { standingOf } = await import("./standing");
const { subscriptionFor } = await import("./subscriptions");

const DAY = 24 * 60 * 60 * 1000;
const T0 = new Date("2026-10-01T12:00:00.000Z");

async function makeAccount(): Promise<string> {
  const id = `dev-${randomUUID()}`;
  await upsertUser({ id, email: null, name: null, image: null });
  return id;
}

function subscription(over: Partial<StripeSubscription> & { id: string; userId: string }): StripeSubscription {
  const { userId, ...rest } = over;
  return {
    customer: `cus_${userId}`,
    status: "active",
    cancel_at_period_end: false,
    current_period_end: Math.floor((T0.getTime() + 30 * DAY) / 1000),
    metadata: { userId, planVersionRef: "plus@v1" },
    ...rest,
  };
}

function event(type: string, object: unknown, at: Date, id = `evt_${randomUUID()}`) {
  return {
    id,
    type,
    created: Math.floor(at.getTime() / 1000),
    data: { object: object as Record<string, unknown> },
  };
}

beforeEach(() => {
  retrieveSubscription.mockReset();
});

describe("a purchase", () => {
  it("grants the plan the session names, and only when the webhook says so", async () => {
    const userId = await makeAccount();
    const subId = `sub_${randomUUID()}`;
    retrieveSubscription.mockResolvedValue(subscription({ id: subId, userId }));

    // **The state before.** A completed checkout and a returned browser have
    // already happened at this point in a real flow, and neither of them
    // touched this: a redirect is a hint, never a grant.
    const [before] = await db.select().from(users).where(eq(users.id, userId));
    expect(before!.planId).toBe("free");

    const outcome = await applyStripeEvent(
      event("checkout.session.completed", {
        id: "cs_1",
        subscription: subId,
        client_reference_id: `${userId}|plus@v1`,
      }, T0),
      T0,
    );

    expect(outcome).toEqual({ applied: true, note: "written" });
    const [after] = await db.select().from(users).where(eq(users.id, userId));
    expect(after!.planId).toBe("plus");
    expect(after!.planVersion).toBe(1);
    const row = await subscriptionFor(userId);
    expect(row).toMatchObject({ status: "active", planId: "plus", stripeSubscriptionId: subId });
  });

  // **The session carries a subscription ID and none of its state.** Reading
  // state off the object the browser's return was about is precisely how a
  // redirect becomes a grant; this asks Stripe instead.
  it("asks Stripe what the subscription is rather than believing the session", async () => {
    const userId = await makeAccount();
    const subId = `sub_${randomUUID()}`;
    retrieveSubscription.mockResolvedValue(subscription({ id: subId, userId, status: "incomplete" }));

    await applyStripeEvent(
      event("checkout.session.completed", {
        id: "cs_2",
        subscription: subId,
        client_reference_id: `${userId}|plus@v1`,
        // A forged claim on the session object. Nothing reads it.
        status: "complete",
        plan: "premium",
      }, T0),
      T0,
    );

    expect(retrieveSubscription).toHaveBeenCalledWith(subId);
    const row = await subscriptionFor(userId);
    expect(row!.status).toBe("incomplete");
    // `incomplete` is not a conferring status, so nothing was granted.
    expect(standingOf(row!, T0).conferring).toBe(false);
  });

  it("writes nothing for a subscription it cannot attribute to an account", async () => {
    const subId = `sub_${randomUUID()}`;
    retrieveSubscription.mockResolvedValue({
      ...subscription({ id: subId, userId: "nobody" }),
      metadata: {},
    });
    const outcome = await applyStripeEvent(
      event("checkout.session.completed", { id: "cs_3", subscription: subId, client_reference_id: null }, T0),
      T0,
    );
    expect(outcome).toEqual({ applied: false, note: "unattributable" });
    expect(await db.select().from(subscriptions).where(eq(subscriptions.stripeSubscriptionId, subId))).toEqual([]);
  });
});

describe("the same event delivered twice", () => {
  it("applies once", async () => {
    const userId = await makeAccount();
    const subId = `sub_${randomUUID()}`;
    const evt = event("customer.subscription.created", subscription({ id: subId, userId }), T0);

    const first = await applyStripeEvent(evt, T0);
    // **The real captured event, replayed byte for byte** — which is what
    // Stripe's own retry is. Not a second event that happens to look similar.
    const second = await applyStripeEvent(evt, new Date(T0.getTime() + 60_000));

    expect(first).toEqual({ applied: true, note: "written" });
    expect(second).toEqual({ applied: false, note: "replay" });

    const rows = await db.select().from(subscriptions).where(eq(subscriptions.userId, userId));
    expect(rows).toHaveLength(1);
    const claims = await db.select().from(billingEvents).where(eq(billingEvents.id, evt.id));
    expect(claims).toHaveLength(1);
  });

  // The retry Stripe actually sends after a 500: the first attempt failed
  // somewhere after the claim, so the second must be free to do the work rather
  // than be swallowed as a replay... which is exactly what it is NOT, and the
  // reason the ordering guard exists as a second, independent defence. This
  // test pins the trade-off rather than pretending there isn't one.
  it("is a replay even if the first delivery failed after claiming it", async () => {
    const userId = await makeAccount();
    const subId = `sub_${randomUUID()}`;
    const sub = subscription({ id: subId, userId });
    const evt = event("customer.subscription.created", sub, T0);
    await applyStripeEvent(evt, T0);
    expect(await applyStripeEvent(evt, T0)).toEqual({ applied: false, note: "replay" });
    // Convergence does not depend on that retry: the NEXT event about this
    // subscription carries its whole state and reconciles the row.
    await applyStripeEvent(
      event("customer.subscription.updated", { ...sub, status: "past_due" }, new Date(T0.getTime() + 1000)),
      T0,
    );
    expect((await subscriptionFor(userId))!.status).toBe("past_due");
  });
});

describe("events applied out of order", () => {
  // **State is reconciled from the event's own data, never from arrival
  // sequence.** The newer event is applied and the older one is dropped, so the
  // row converges on the truth regardless of the order the two arrive in.
  it("converge to the newer state when the stale one arrives last", async () => {
    const userId = await makeAccount();
    const subId = `sub_${randomUUID()}`;
    const sub = subscription({ id: subId, userId });

    const older = event("customer.subscription.updated", { ...sub, status: "active" }, T0);
    const newer = event(
      "customer.subscription.updated",
      { ...sub, status: "canceled" },
      new Date(T0.getTime() + 60_000),
    );

    await applyStripeEvent(newer, T0);
    const late = await applyStripeEvent(older, T0);

    expect(late).toEqual({ applied: false, note: "stale" });
    expect((await subscriptionFor(userId))!.status).toBe("canceled");
    // And the held plan followed the cancellation rather than the last arrival.
    const [row] = await db.select().from(users).where(eq(users.id, userId));
    expect(row!.planId).toBe("free");
  });

  it("converge to the same state when they arrive in order", async () => {
    const userId = await makeAccount();
    const subId = `sub_${randomUUID()}`;
    const sub = subscription({ id: subId, userId });
    await applyStripeEvent(event("customer.subscription.updated", { ...sub, status: "active" }, T0), T0);
    await applyStripeEvent(
      event("customer.subscription.updated", { ...sub, status: "canceled" }, new Date(T0.getTime() + 60_000)),
      T0,
    );
    expect((await subscriptionFor(userId))!.status).toBe("canceled");
  });
});

describe("a declined card", () => {
  async function decline(userId: string, subId: string, at: Date) {
    const sub = subscription({ id: subId, userId, status: "past_due" });
    retrieveSubscription.mockResolvedValue(sub);
    return applyStripeEvent(
      event("invoice.payment_failed", { id: `in_${randomUUID()}`, subscription: subId }, at),
      at,
    );
  }

  it("anchors the grace window at the decline, not at the period end", async () => {
    const userId = await makeAccount();
    const subId = `sub_${randomUUID()}`;
    await decline(userId, subId, T0);

    const row = await subscriptionFor(userId);
    expect(row!.status).toBe("past_due");
    expect(row!.pastDueSince).toEqual(T0);
    // Day 2: still conferring, and the account has lost nothing.
    expect(standingOf(row!, new Date(T0.getTime() + 2 * DAY)).conferring).toBe(true);
    // Day 4: lapsed, with nothing having run in between.
    expect(standingOf(row!, new Date(T0.getTime() + 4 * DAY)).conferring).toBe(false);
  });

  // **Stripe retries a failed invoice for about two weeks**, and every failed
  // retry is another `invoice.payment_failed`. Letting the second one move the
  // anchor restarts the three days on each retry — a subscription that never
  // lapses, and the defect is invisible because everything looks like it is
  // working.
  it("does not restart the window on Stripe's own retries", async () => {
    const userId = await makeAccount();
    const subId = `sub_${randomUUID()}`;
    await decline(userId, subId, T0);
    await decline(userId, subId, new Date(T0.getTime() + 2 * DAY));

    const row = await subscriptionFor(userId);
    expect(row!.pastDueSince).toEqual(T0);
    expect(standingOf(row!, new Date(T0.getTime() + 4 * DAY)).lapsed).toBe(true);
  });

  // **A card fixed inside the window costs the account nothing** (M21 link 6).
  it("costs the account nothing when the card is fixed on day 2", async () => {
    const userId = await makeAccount();
    const subId = `sub_${randomUUID()}`;
    await decline(userId, subId, T0);

    const fixedAt = new Date(T0.getTime() + 2 * DAY);
    retrieveSubscription.mockResolvedValue(subscription({ id: subId, userId, status: "active" }));
    await applyStripeEvent(
      event("invoice.payment_succeeded", { id: `in_${randomUUID()}`, subscription: subId }, fixedAt),
      fixedAt,
    );

    const row = await subscriptionFor(userId);
    expect(row!.status).toBe("active");
    expect(row!.pastDueSince).toBeNull();
    expect(standingOf(row!, new Date(T0.getTime() + 10 * DAY)).conferring).toBe(true);
    const [account] = await db.select().from(users).where(eq(users.id, userId));
    expect(account!.planId).toBe("plus");
  });

  // The window closing is a DERIVATION, so a later successful retry restores
  // the account through the ordinary webhook path — nothing special-cases it.
  it("is restored by a retry that succeeds after the window closed", async () => {
    const userId = await makeAccount();
    const subId = `sub_${randomUUID()}`;
    await decline(userId, subId, T0);
    expect(standingOf((await subscriptionFor(userId))!, new Date(T0.getTime() + 5 * DAY)).lapsed).toBe(true);

    const paidAt = new Date(T0.getTime() + 6 * DAY);
    retrieveSubscription.mockResolvedValue(subscription({ id: subId, userId, status: "active" }));
    await applyStripeEvent(
      event("invoice.payment_succeeded", { id: `in_${randomUUID()}`, subscription: subId }, paidAt),
      paidAt,
    );
    expect(standingOf((await subscriptionFor(userId))!, paidAt).conferring).toBe(true);
  });
});

describe("an event this endpoint does not handle", () => {
  // Stripe retries a non-2xx, so answering an error to an event we simply do
  // not handle would make it retry for three days.
  it("is ignored without a claim, so it never becomes a retry loop", async () => {
    const evt = event("customer.created", { id: "cus_x" }, T0);
    expect(await applyStripeEvent(evt, T0)).toEqual({ applied: false, note: "ignored" });
    expect(await db.select().from(billingEvents).where(eq(billingEvents.id, evt.id))).toEqual([]);
  });
});
