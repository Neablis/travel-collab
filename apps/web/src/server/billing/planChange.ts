// **The confirm step's numbers, and the change they describe** (M21 link 5,
// SPEC §29).
//
// **Every figure comes from Stripe, and none from a price string in the UI.**
// §29 is explicit: *"in a build every figure comes from Stripe's preview of the
// change against the plan version being bought"*. The client never sends a
// price and never receives one it did not get from here, so that rule is a
// property of the API rather than a convention the UI keeps.
//
// **A stale plan version at pay time is a conflict, not an error** (§29, and
// rule 6). A preview is taken against a version, the version travels back with
// it, and applying a change re-reads what is live: if a deploy has published a
// new version in between, the change is refused with the new numbers rather
// than charged at the old amount silently.
import type { PlanId } from "@tc/contracts";
import {
  isPurchasable,
  livePlanVersion,
  planVersionRefOf,
  type PlanVersion,
} from "@/server/entitlements/planVersions";
import { CheckoutRefusedError, startCheckout, stripeCustomerFor } from "./checkout";
import { stripePriceFor } from "./prices";
import {
  defaultPaymentMethod,
  previewSubscriptionChange,
  retrieveSubscriptionWithItems,
  updateSubscription,
} from "./stripeApi";
import { subscriptionFor } from "./subscriptions";

/** One order line, in minor units of `currency`. */
export interface OrderLine {
  description: string;
  minor: number;
  /** True for the credit half of a proration — the design draws it as −$4.53. */
  proration: boolean;
}

/**
 * What the confirm step renders.
 *
 * **`kind` is the thing the screen branches on**, and the three are genuinely
 * different transactions rather than three labels:
 *
 *   * `first-purchase` — no subscription exists, so there is nothing to
 *     prorate and the whole price is due. It goes through hosted Checkout,
 *     because there is no card on file yet.
 *   * `change` — an existing subscription moves to another Price, prorated to
 *     the day against the card already on file. No checkout, no redirect.
 *   * `cancel` — the move to `free`. **No money in it at all**: §29's order
 *     card collapses to one button, and *What changes* names the losses on the
 *     date they happen rather than today.
 */
export type PlanChangeKind = "first-purchase" | "change" | "cancel";

export interface PlanChangePreview {
  kind: PlanChangeKind;
  planId: PlanId;
  /** The version this preview was taken against — carried back on apply. */
  planVersionRef: string;
  currency: string;
  lines: OrderLine[];
  /** What Stripe says is due now, in minor units. Zero for a cancellation. */
  dueTodayMinor: number;
  /** When the plan being bought renews, or when a cancellation takes effect. */
  effectiveAt: string | null;
  /** `visa •••• 4242`, or null when there is no card on file yet. */
  cardOnFile: string | null;
}

/**
 * **Moving to a plan that costs nothing is a cancellation, not a purchase.**
 *
 * Asked of the price rather than of the plan id, which is not a stylistic
 * preference: `planVersions.fourthPlan.test.ts` refused the first version of
 * this file for comparing `planId === "free"`, and it was right to. `free` is
 * not special because of its name — it is special because it costs nothing, and
 * a second zero-priced plan would have to behave identically without anyone
 * remembering to add it to a list.
 */
function isCancellation(version: PlanVersion): boolean {
  return version.price === null || version.price.minor === 0;
}

/** The version a plan is sold at today, refusing the ones nothing sells. */
function sellableVersion(planId: PlanId): PlanVersion {
  const version = livePlanVersion(planId);
  if (!isCancellation(version) && !isPurchasable(version)) {
    throw new CheckoutRefusedError(
      "unpurchasable",
      `${planVersionRefOf(version)} is not for sale.`,
    );
  }
  return version;
}

/**
 * **What this change would cost, asked of Stripe.**
 *
 * The `change` branch is the only one that asks: a first purchase has nothing
 * to prorate against and a cancellation takes no money, so inventing a preview
 * call for either would be a round trip to be told the price we already
 * published.
 */
export async function previewPlanChange(input: {
  userId: string;
  planId: PlanId;
}): Promise<PlanChangePreview> {
  const version = sellableVersion(input.planId);
  const ref = planVersionRefOf(version);
  const current = await subscriptionFor(input.userId);
  const live = current !== null && (current.status === "active" || current.status === "trialing" || current.status === "past_due");

  if (isCancellation(version)) {
    // **The losses are named on the date they happen** (§29). `effectiveAt` is
    // the end of the period already paid for, which is when the assistant
    // stops and the collaborators drop to reading — not today.
    return {
      kind: "cancel",
      planId: input.planId,
      planVersionRef: ref,
      currency: "usd",
      lines: [],
      dueTodayMinor: 0,
      effectiveAt: current?.currentPeriodEnd?.toISOString() ?? null,
      cardOnFile: null,
    };
  }

  if (!live || current === null) {
    const price = version.price!;
    return {
      kind: "first-purchase",
      planId: input.planId,
      planVersionRef: ref,
      currency: price.currency,
      // One line, and it is the published price rather than a preview, because
      // there is no existing subscription for Stripe to prorate against. Said
      // plainly rather than dressed up as a computed order: the whole amount is
      // due, and that is the simplest true statement about a first purchase.
      lines: [{ description: `${input.planId} — one month`, minor: price.minor, proration: false }],
      dueTodayMinor: price.minor,
      effectiveAt: null,
      cardOnFile: null,
    };
  }

  const [customerId, priceId, subscription] = await Promise.all([
    stripeCustomerFor(input.userId),
    stripePriceFor(version),
    retrieveSubscriptionWithItems(current.stripeSubscriptionId),
  ]);
  const item = subscription.items?.data[0];
  if (item === undefined) {
    throw new Error(`Stripe subscription ${current.stripeSubscriptionId} has no items to change.`);
  }

  const [preview, card] = await Promise.all([
    previewSubscriptionChange({
      customerId,
      subscriptionId: current.stripeSubscriptionId,
      subscriptionItemId: item.id,
      priceId,
    }),
    defaultPaymentMethod(customerId),
  ]);

  return {
    kind: "change",
    planId: input.planId,
    planVersionRef: ref,
    currency: preview.currency,
    lines: preview.lines.data.map((line) => ({
      description: line.description ?? "Adjustment",
      minor: line.amount,
      proration: line.proration === true,
    })),
    dueTodayMinor: preview.amount_due,
    effectiveAt: current.currentPeriodEnd?.toISOString() ?? null,
    cardOnFile: card?.card === null || card === null ? null : `${card.card.brand} •••• ${card.card.last4}`,
  };
}

/** The version shown on the confirm step is no longer the version being sold. */
export class StalePlanVersionError extends Error {
  constructor(
    readonly shown: string,
    readonly live: string,
  ) {
    super(
      `The confirm step was rendered against ${shown} and ${live} is what is published now. ` +
        `Re-render with the new numbers rather than charging the old amount (SPEC §29).`,
    );
    this.name = "StalePlanVersionError";
  }
}

export type PlanChangeResult =
  | { kind: "checkout"; url: string; sessionId: string }
  | { kind: "applied"; planVersionRef: string }
  | { kind: "cancelling"; effectiveAt: string | null };

/**
 * **Apply what the confirm step showed** — or refuse, if it is no longer what
 * is being sold.
 *
 * Nothing here writes a row. A change and a cancellation both go to Stripe and
 * come back through the webhook (M21 link 4), so what this returns is *what is
 * happening*, never *what an account now holds*. The screen's result state
 * reads the account afresh; it does not believe this answer.
 */
/**
 * **An idempotency key that identifies one operation, not one target state.**
 *
 * The first version was `cancel:${subscriptionId}` and
 * `change:${subscriptionId}:${ref}`. Stripe replays the stored response for a
 * reused key, so those keys meant: an account that cancels, resumes, and
 * cancels again gets the FIRST cancellation's response replayed and the second
 * cancellation is never applied — silently, with a 200. Same for changing away
 * from a version and back to it.
 *
 * A key has to name *this request*. `operationId` comes from the client's
 * confirmation and is stable across a retry of that same confirmation, so a
 * double-click still cannot charge two prorations while a genuinely new
 * intention gets a genuinely new key. Absent one — an older client, a direct
 * API call — the current minute stands in: still idempotent across an
 * immediate retry, still distinct across two deliberate acts.
 * CodeRabbit, PR #177.
 */
function operationKey(what: string, subscriptionId: string, operationId: string | undefined): string {
  const operation = operationId ?? `t${Math.floor(Date.now() / 60_000)}`;
  return `${what}:${subscriptionId}:${operation}`;
}

export async function applyPlanChange(input: {
  userId: string;
  planId: PlanId;
  /** The version the confirm step was rendered against. */
  shownVersionRef: string;
  returnOrigin: string;
  /**
   * Identifies this confirmation, so a retry of it is idempotent and a second,
   * deliberate change is not mistaken for one. See `operationKey`.
   */
  operationId?: string;
}): Promise<PlanChangeResult> {
  const version = sellableVersion(input.planId);
  const liveRef = planVersionRefOf(version);
  // **The conflict, checked before anything is charged.** An admin publishing
  // a new version while someone sits on the confirm step is rare and is exactly
  // the case where charging the old amount silently would be worst.
  if (input.shownVersionRef !== liveRef) {
    throw new StalePlanVersionError(input.shownVersionRef, liveRef);
  }

  const current = await subscriptionFor(input.userId);
  const live =
    current !== null &&
    (current.status === "active" || current.status === "trialing" || current.status === "past_due");

  if (isCancellation(version)) {
    if (!live || current === null) {
      // Already on free, or never anywhere else. Nothing to cancel, and saying
      // so beats a Stripe call that errors.
      throw new CheckoutRefusedError("already-held", "There is no subscription to cancel.");
    }
    // **Cancelling sets `cancel_at_period_end`** (M21 link 5). Access runs to
    // the end of the paid period and then lapses through M20's resolver, with
    // no separate downgrade path to keep in sync.
    await updateSubscription(
      current.stripeSubscriptionId,
      { cancel_at_period_end: true },
      operationKey("cancel", current.stripeSubscriptionId, input.operationId),
    );
    return { kind: "cancelling", effectiveAt: current.currentPeriodEnd?.toISOString() ?? null };
  }

  if (!live || current === null) {
    const started = await startCheckout({
      userId: input.userId,
      planId: input.planId,
      returnOrigin: input.returnOrigin,
    });
    return { kind: "checkout", url: started.url, sessionId: started.sessionId };
  }

  const [priceId, subscription] = await Promise.all([
    stripePriceFor(version),
    retrieveSubscriptionWithItems(current.stripeSubscriptionId),
  ]);
  const item = subscription.items?.data[0];
  if (item === undefined) {
    throw new Error(`Stripe subscription ${current.stripeSubscriptionId} has no items to change.`);
  }

  await updateSubscription(
    current.stripeSubscriptionId,
    {
      items: [{ id: item.id, price: priceId }],
      // **`always_invoice`, not `create_prorations`** — and the difference is
      // exactly the confirm step's honesty. `create_prorations` computes the
      // adjustment and leaves it for the NEXT invoice; the button said `Pay
      // $11.47 with Stripe` and nothing would have been collected today. This
      // creates and collects the invoice now, which is what the reader agreed
      // to. CodeRabbit, PR #177.
      proration_behavior: "always_invoice",
      payment_behavior: "error_if_incomplete",
      // A cancellation already scheduled is undone by choosing a paid plan
      // again, which is what a person means by picking one.
      cancel_at_period_end: false,
      metadata: { userId: input.userId, planVersionRef: liveRef },
    },
    operationKey(`change:${liveRef}`, current.stripeSubscriptionId, input.operationId),
  );
  return { kind: "applied", planVersionRef: liveRef };
}
