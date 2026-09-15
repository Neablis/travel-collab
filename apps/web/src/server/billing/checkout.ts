// **Hosted checkout, and the reason it is hosted** (M21 link 3).
//
// **The app never sees a card number.** No PAN, no CVC, no expiry, no card
// field anywhere in this repo's DOM — which is a gate box rather than an
// assumption, and is the entire point of sending a person to Stripe's own
// pages. Everything here creates a URL and redirects to it; nothing here
// touches an instrument.
//
// **Creating a session grants nothing.** The session's success URL brings a
// browser back and that return proves only that a browser followed a URL. The
// grant happens when the webhook says so (M21 link 4), which is why the
// success page's job is to wait rather than to celebrate.
import type { PlanId } from "@tc/contracts";
import { db } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import {
  isPurchasable,
  livePlanVersion,
  planVersionRefOf,
  type PlanVersion,
} from "@/server/entitlements/planVersions";
import { checkoutReference } from "./config";
import { stripePriceFor, UnpurchasableVersionError } from "./prices";
import { createCustomer, stripeRequest, type StripeCheckoutSession, type StripePortalSession } from "./stripeApi";
import { subscriptionFor } from "./subscriptions";

/**
 * The Stripe customer for an account, creating one the first time.
 *
 * **Written here and not by the webhook**, which is the one exception to link
 * 4's sole-writer rule and is not really an exception: a customer id is who you
 * are at Stripe, not what you are entitled to. It has to exist before a
 * Checkout Session can name it, and the webhook has not run yet at that point.
 * `users.plan_id` and `subscriptions` — the two things that decide what an
 * account may do — stay the webhook's alone.
 *
 * Idempotent in two places at once: `createCustomer` sends an idempotency key
 * derived from the account id, and the column is only written when it is null.
 * Two concurrent first checkouts therefore produce one customer and one write.
 */
export async function stripeCustomerFor(userId: string): Promise<string> {
  const rows = await db
    .select({ stripeCustomerId: users.stripeCustomerId, email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const row = rows[0];
  if (row === undefined) {
    // A session outliving its row is an ordinary state in this product
    // (ADR-025), and every other reader treats it as "nothing known". Here it
    // must be an error: creating a Stripe customer for an account that does not
    // exist would be inventing a paying relationship with nobody.
    throw new Error(`No users row for ${userId}; refusing to create a Stripe customer for it.`);
  }
  if (row.stripeCustomerId !== null) return row.stripeCustomerId;

  const customer = await createCustomer({ userId, email: row.email });
  // **Only if it is still null.** Another request may have created and written
  // one between the read above and here; Stripe's idempotency key means it is
  // the SAME customer, so this is a race with no loser — but writing
  // unconditionally would still be a needless update on a column whose whole
  // value is that it never changes.
  const written = await db
    .update(users)
    .set({ stripeCustomerId: customer.id })
    .where(and(eq(users.id, userId), isNull(users.stripeCustomerId)))
    .returning({ id: users.id });
  if (written.length > 0) return customer.id;

  const settled = await db
    .select({ stripeCustomerId: users.stripeCustomerId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return settled[0]?.stripeCustomerId ?? customer.id;
}

/** Why a checkout could not be started, in words a screen can show. */
export class CheckoutRefusedError extends Error {
  constructor(
    readonly reason: "unpurchasable" | "already-held",
    message: string,
  ) {
    super(message);
    this.name = "CheckoutRefusedError";
  }
}

export interface CheckoutStart {
  url: string;
  /** What the session was created against — the version the price came from. */
  planVersionRef: string;
}

/**
 * Start a hosted checkout for one plan.
 *
 * **The version is resolved here, server-side, and travels with the session.**
 * The client names a plan; it never names a version and never names a price.
 * That is what makes *the numbers come from Stripe's preview of the change
 * against the plan version being bought* (SPEC §29) enforceable rather than a
 * convention — there is no price on the wire for a client to have been wrong
 * about.
 */
export async function startCheckout(input: {
  userId: string;
  planId: PlanId;
  returnOrigin: string;
}): Promise<CheckoutStart> {
  const version: PlanVersion = livePlanVersion(input.planId);
  if (!isPurchasable(version)) {
    throw new CheckoutRefusedError(
      "unpurchasable",
      `${planVersionRefOf(version)} is not for sale. Moving to a free plan is a cancellation, ` +
        `not a purchase (M21 link 5).`,
    );
  }

  // **Already on it is refused rather than charged.** Stripe would happily
  // create a second subscription to the same Price, and the account would pay
  // twice for one plan — the exact "charges someone twice" failure M21's *Why
  // it is separate* names as this milestone's blast radius.
  const existing = await subscriptionFor(input.userId);
  if (
    existing !== null &&
    existing.planId === input.planId &&
    (existing.status === "active" || existing.status === "trialing")
  ) {
    throw new CheckoutRefusedError(
      "already-held",
      `This account already has an ${existing.status} subscription to ${input.planId}. ` +
        `Changing an existing subscription happens in Stripe's portal, not in a second checkout.`,
    );
  }

  const [customerId, priceId] = await Promise.all([
    stripeCustomerFor(input.userId),
    stripePriceFor(version),
  ]);

  const session = await stripeRequest<StripeCheckoutSession>({
    method: "POST",
    path: "/checkout/sessions",
    body: {
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      // **How the webhook knows who bought what**, without trusting anything
      // the browser sent back. Stripe echoes this verbatim.
      client_reference_id: checkoutReference(input.userId, version.planId, version.version),
      // The same pair again on the subscription itself, because
      // `customer.subscription.updated` carries no session and therefore no
      // `client_reference_id` — and those are most of the events. Without this
      // a renewal two months later would have no way back to an account.
      subscription_data: {
        metadata: {
          userId: input.userId,
          planVersionRef: planVersionRefOf(version),
        },
      },
      // `{CHECKOUT_SESSION_ID}` is Stripe's own placeholder; it is substituted
      // on the redirect. The success page uses it to ask what happened, and
      // asking is all it does — the answer that matters comes from the webhook.
      success_url: `${input.returnOrigin}/plans?checkout={CHECKOUT_SESSION_ID}`,
      cancel_url: `${input.returnOrigin}/plans?checkout=cancelled`,
      // Stripe collects what it needs on its own page. We ask for nothing: an
      // address field here would be a field this product has no use for and a
      // row of data it would then be storing.
      allow_promotion_codes: false,
    },
    // **Scoped to the account, the version and the hour.** Not to the account
    // alone: a person who starts a checkout, abandons it and comes back an hour
    // later must get a fresh session rather than a 24-hour-old expired one.
    // Not per-request either, which would make the key decorative.
    idempotencyKey: `checkout:${input.userId}:${planVersionRefOf(version)}:${Math.floor(Date.now() / 3_600_000)}`,
  });

  if (session.url === null) {
    throw new Error("Stripe created a Checkout Session with no URL, which should not happen.");
  }
  return { url: session.url, planVersionRef: planVersionRefOf(version) };
}

/**
 * A link into Stripe's customer portal (M21 link 5).
 *
 * Payment method, invoices and cancellation, all of it Stripe's own screens.
 * Cancelling there sets `cancel_at_period_end` and the webhook tells us; access
 * runs to the end of the paid period and then lapses through M20's resolver,
 * with **no separate downgrade path to keep in sync**.
 */
export async function portalUrlFor(input: {
  userId: string;
  returnOrigin: string;
}): Promise<string> {
  const customerId = await stripeCustomerFor(input.userId);
  const session = await stripeRequest<StripePortalSession>({
    method: "POST",
    path: "/billing_portal/sessions",
    body: { customer: customerId, return_url: `${input.returnOrigin}/account` },
  });
  return session.url;
}

/** Re-exported so a route needs one import to distinguish the two refusals. */
export { UnpurchasableVersionError };
