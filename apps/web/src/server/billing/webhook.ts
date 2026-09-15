// **The webhook, and it is the only thing that writes subscription state**
// (M21 link 4).
//
// Three properties are mandatory and each is a gate box:
//
//   * **Signature verification** — an unsigned request is rejected before it is
//     parsed. That lives in `signature.ts` and is enforced by there being no
//     other path from a body to an event.
//   * **Idempotency** — Stripe retries, and a redelivered event must not
//     double-apply. The claim is an `INSERT ... ON CONFLICT DO NOTHING` on
//     `billing_events`, which is atomic across concurrent invocations in a way
//     a read-then-write is not.
//   * **Ordering tolerance** — events arrive out of order, and state is
//     reconciled from the event's own period data, never from arrival
//     sequence. `applySubscriptionFacts` compares `created` against the newest
//     event already applied, inside the UPDATE's own WHERE clause.
//
// **And one thing it writes that the milestone's own prose only implies**:
// `users.plan_id`. An account's held plan is what M20's resolver reads, so
// "what you bought" has to land there or a subscription would grant nothing.
// Nothing else in the product writes it except account creation, and
// `billing.soleWriter.test.ts` sweeps for a third writer.
import { and, eq, isNull } from "drizzle-orm";
import { PlanId, SubscriptionStatus } from "@tc/contracts";
import { db } from "@/server/db/client";
import { billingEvents, subscriptions, users } from "@/server/db/schema";
import { isPublishedRef, livePlanVersion } from "@/server/entitlements/planVersions";
import { parseCheckoutReference } from "./config";
import type { StripeEvent } from "./signature";
import { retrieveSubscription, type StripeSubscription } from "./stripeApi";
import {
  applySubscriptionFacts,
  subscriptionByStripeId,
  subscriptionFor,
  type SubscriptionFacts,
} from "./subscriptions";

/** What one delivery did, in the words the endpoint answers with. */
export type WebhookOutcome =
  | { applied: true; note: "written" }
  | { applied: false; note: "replay" | "stale" | "ignored" | "unattributable" };

/**
 * The event types this endpoint acts on.
 *
 * **A short list on purpose.** Stripe sends dozens of types and an endpoint
 * subscribed to all of them is an endpoint whose behaviour nobody can state.
 * These five are the ones that change what an account holds:
 *
 *   * `checkout.session.completed` — the purchase. The only event carrying the
 *     `client_reference_id` that names the account, which is why it is handled
 *     separately below.
 *   * `customer.subscription.created|updated|deleted` — every later transition:
 *     renewal, cancellation scheduled, cancellation arrived, plan changed in
 *     the portal, and the move into and out of `past_due`.
 *   * `invoice.payment_failed` — the DECLINE, which is the grace window's
 *     anchor (M21 link 6). The subscription event that accompanies it says
 *     `past_due` but not *when*, and the window is measured from the decline.
 *   * `invoice.payment_succeeded` — a card fixed inside the window, which must
 *     clear the anchor so the account costs nothing (link 6 again).
 *
 * Anything else is `ignored` with a 200: Stripe retries a non-2xx, so
 * answering an error to an event we simply do not handle would make it retry
 * forever.
 */
const HANDLED = new Set([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.payment_failed",
  "invoice.payment_succeeded",
]);

/**
 * **Claim this event, or report that somebody already has it.**
 *
 * The insert IS the lock. Two concurrent deliveries of the same event — which
 * Stripe does produce — race here and exactly one wins; the loser gets an empty
 * `returning` and stops, having written nothing.
 */
async function claimEvent(event: StripeEvent, now: Date): Promise<boolean> {
  const claimed = await db
    .insert(billingEvents)
    .values({
      id: event.id,
      type: event.type,
      eventAt: new Date(event.created * 1000),
      receivedAt: now,
    })
    .onConflictDoNothing()
    .returning({ id: billingEvents.id });
  return claimed.length > 0;
}

/**
 * The period end, from wherever this API version put it.
 *
 * Stripe moved the period bounds off the subscription and onto its items. A
 * reader that knows only one location silently records `null` against the other
 * — and `null` here is what the account sheet renders as a missing renewal
 * date, so the symptom is a blank on a screen rather than an error.
 */
function periodEndOf(subscription: StripeSubscription): Date | null {
  const seconds =
    subscription.current_period_end ?? subscription.items?.data[0]?.current_period_end ?? null;
  return typeof seconds === "number" ? new Date(seconds * 1000) : null;
}

/**
 * Which account and which version a Stripe subscription belongs to.
 *
 * Three sources, tried in the order of how much they are trusted:
 *
 *   1. **The subscription's own metadata**, written by `startCheckout` at the
 *      moment of purchase. Authoritative and present on every later event.
 *   2. **The row we already have**, if this deployment has seen this
 *      subscription before. Covers a subscription created before metadata
 *      existed, or edited by hand in the dashboard.
 *   3. **Nothing** — and then the event is `unattributable` and is answered
 *      200 without a write. There is deliberately no fallback to "look up the
 *      customer and guess": a guess here grants a plan to the wrong account.
 *
 * **The version is checked against the committed plan file** (ADR-045 rule 3).
 * A pinned version this deploy does not publish must not silently become the
 * newest one — that would hand an account terms it never bought.
 */
function attribute(
  subscription: StripeSubscription,
  known: Awaited<ReturnType<typeof subscriptionByStripeId>>,
): { userId: string; planId: PlanId; planVersion: number } | null {
  const metadata = subscription.metadata ?? {};
  const userId = metadata.userId;
  const ref = metadata.planVersionRef;
  if (typeof userId === "string" && userId !== "" && typeof ref === "string" && isPublishedRef(ref)) {
    const parsed = parseCheckoutReference(`${userId}|${ref}`);
    if (parsed !== null) {
      return { userId: parsed.userId, planId: parsed.planId, planVersion: parsed.version };
    }
  }

  if (known !== null) {
    return { userId: known.userId, planId: known.planId, planVersion: known.planVersion };
  }
  return null;
}

/**
 * A status Stripe sent, or a refusal to guess.
 *
 * A status outside the contract's enum is a Stripe change we have not read
 * about, and the honest answer is to leave the row alone rather than to map it
 * onto the nearest word we have — see `SubscriptionStatus` in contracts.
 */
function statusOf(subscription: StripeSubscription): SubscriptionStatus | null {
  const parsed = SubscriptionStatus.safeParse(subscription.status);
  return parsed.success ? parsed.data : null;
}

/**
 * **The one write path**, given a Stripe subscription and the event it came on.
 *
 * `pastDueSince` is carried forward rather than recomputed: the decline is an
 * `invoice.payment_failed` and the subscription events around it do not say
 * when it happened. A subscription that is `past_due` and has no anchor yet
 * gets this event's time, which is the closest honest answer and is only ever
 * reached when the invoice event has not arrived (they can arrive in either
 * order — this is the ordering tolerance doing its job rather than an edge
 * case).
 */
async function writeFrom(
  subscription: StripeSubscription,
  event: StripeEvent,
  now: Date,
): Promise<WebhookOutcome> {
  const existing = await subscriptionByStripeId(subscription.id);
  const who = attribute(subscription, existing);
  if (who === null) return { applied: false, note: "unattributable" };

  const status = statusOf(subscription);
  if (status === null) return { applied: false, note: "ignored" };

  const eventAt = new Date(event.created * 1000);
  const pastDueSince =
    status === "past_due" ? (existing?.pastDueSince ?? eventAt) : null;

  const facts: SubscriptionFacts = {
    userId: who.userId,
    stripeCustomerId: subscription.customer,
    stripeSubscriptionId: subscription.id,
    planId: who.planId,
    planVersion: who.planVersion,
    status,
    currentPeriodEnd: periodEndOf(subscription),
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    pastDueSince,
    eventAt,
  };

  const written = await applySubscriptionFacts(facts, now);
  if (!written.applied) return { applied: false, note: "stale" };

  await syncHeldPlan(who.userId);
  return { applied: true, note: "written" };
}

/**
 * **What the account holds, after a subscription changed** — the second half of
 * the sole write.
 *
 * `users.plan_id` is what M20's resolver reads, so it is where a purchase has
 * to land. The rule it follows is the plain one: an account holds the plan its
 * subscription pins while that subscription is **not definitively over**, and
 * `free` otherwise.
 *
 * **Not "while it is conferring"**, which is the subtly wrong version and the
 * one worth naming. A `past_due` subscription inside its grace window is
 * conferring; a `past_due` subscription past the window is not, and the
 * difference is a clock rather than an event. If this wrote `free` at the
 * moment the window closed, something would have to run at that moment — and
 * link 4 says nothing but the webhook writes. So the column keeps saying what
 * was bought, and `standing.ts` decides at READ time whether it still counts.
 * A lapse is a derivation; only a definitive end is a write.
 */
async function syncHeldPlan(userId: string): Promise<void> {
  const current = await subscriptionFor(userId);
  const over =
    current === null ||
    current.status === "canceled" ||
    current.status === "unpaid" ||
    current.status === "incomplete_expired";
  const held = over
    ? { planId: livePlanVersion("free").planId, planVersion: livePlanVersion("free").version }
    : { planId: current.planId, planVersion: current.planVersion };
  await db
    .update(users)
    .set({ planId: held.planId, planVersion: held.planVersion })
    .where(eq(users.id, userId));
}

/** The subscription id an invoice event points at, if it points at one. */
function subscriptionIdOnInvoice(object: Record<string, unknown>): string | null {
  const direct = object.subscription;
  if (typeof direct === "string" && direct !== "") return direct;
  // Newer API versions nest it on the invoice's parent record.
  const parent = object.parent as { subscription_details?: { subscription?: unknown } } | undefined;
  const nested = parent?.subscription_details?.subscription;
  return typeof nested === "string" && nested !== "" ? nested : null;
}

/**
 * **Apply one verified Stripe event.**
 *
 * The caller has already verified the signature; this is everything after
 * that, and it is written so that "what happens on a redelivery" is one branch
 * at the top rather than a property each handler has to preserve.
 */
export async function applyStripeEvent(
  event: StripeEvent,
  now: Date = new Date(),
): Promise<WebhookOutcome> {
  if (!HANDLED.has(event.type)) return { applied: false, note: "ignored" };

  // **The claim comes before the work.** A redelivery stops here having done
  // nothing, which is what makes idempotency a property of the endpoint rather
  // than of each handler.
  if (!(await claimEvent(event, now))) return { applied: false, note: "replay" };

  const object = event.data.object;

  if (event.type === "checkout.session.completed") {
    const subscriptionId = object.subscription;
    if (typeof subscriptionId !== "string" || subscriptionId === "") {
      // A completed session in a mode that creates no subscription. Nothing
      // this product sells is such a thing today, and answering `ignored`
      // rather than throwing keeps a future one-off purchase from making this
      // endpoint retry forever.
      return { applied: false, note: "ignored" };
    }
    // **Fetched from Stripe rather than read off the session.** The session
    // carries a subscription ID and none of its state, and reading state from
    // the object the browser's return was about is how a redirect becomes a
    // grant. This asks Stripe.
    const subscription = await retrieveSubscription(subscriptionId);
    // The session is the one place the account id is stated outright, so an
    // attribution that would otherwise fail is rescued here — a subscription
    // created before `subscription_data.metadata` existed, for instance.
    const reference = parseCheckoutReference(
      typeof object.client_reference_id === "string" ? object.client_reference_id : null,
    );
    if (reference !== null) {
      subscription.metadata = {
        ...subscription.metadata,
        userId: reference.userId,
        planVersionRef: `${reference.planId}@v${reference.version}`,
      };
    }
    return writeFrom(subscription, event, now);
  }

  if (event.type.startsWith("customer.subscription.")) {
    return writeFrom(object as unknown as StripeSubscription, event, now);
  }

  // Both invoice events: find the subscription they are about and reconcile it.
  const subscriptionId = subscriptionIdOnInvoice(object);
  if (subscriptionId === null) return { applied: false, note: "ignored" };
  const subscription = await retrieveSubscription(subscriptionId);
  const outcome = await writeFrom(subscription, event, now);

  // **The decline's date, which only this event knows** (M21 link 6). The
  // subscription says `past_due`; it does not say when, and the window is
  // measured from the decline rather than from the period end. Written after
  // `writeFrom` so that the row exists to write it on.
  if (event.type === "invoice.payment_failed" && outcome.applied) {
    await anchorDecline(subscription.id, new Date(event.created * 1000));
  }
  return outcome;
}

/**
 * Stamp the decline this grace window is measured from, without moving one that
 * is already set.
 *
 * Stripe retries a failed invoice several times over about two weeks, and every
 * retry that fails is another `invoice.payment_failed`. Letting the second one
 * move the anchor would restart the three days on each retry, which is a
 * subscription that never lapses — the defect is invisible because everything
 * looks like it is working.
 */
async function anchorDecline(stripeSubscriptionId: string, declinedAt: Date): Promise<void> {
  await db
    .update(subscriptions)
    .set({ pastDueSince: declinedAt })
    .where(
      and(
        eq(subscriptions.stripeSubscriptionId, stripeSubscriptionId),
        eq(subscriptions.status, "past_due"),
        isNull(subscriptions.pastDueSince),
      ),
    );
}
