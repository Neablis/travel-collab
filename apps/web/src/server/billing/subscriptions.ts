// **The Billing module's store** (M21 link 1).
//
// Reads are open to anything that needs to know what an account pays for.
// **Writes are the webhook's alone** (M21 link 4) — every write function here
// is called from exactly one place, and `billing.soleWriter.test.ts` is what
// keeps that true as the tree grows.
//
// **This module imports no plan file and no resolver**, and that is structural
// rather than tidy: the Entitlements resolver reads a subscription's standing
// to decide whether a lapse has happened (M21 link 5's *lapses through M20's
// existing resolver*), so Billing depending on Entitlements would close a
// cycle. What crosses that seam is a `planId` + `planVersion` pin and a status
// — references, never resolved terms, which is ADR-045 rule 1 pointed the
// other way.
import { and, desc, eq, inArray, lte } from "drizzle-orm";
import { CONFERRING_STATUSES, type PlanId, type SubscriptionStatus } from "@tc/contracts";
import { db, type Queryable } from "@/server/db/client";
import { subscriptions } from "@/server/db/schema";

/** One row, as read back. */
export type SubscriptionRow = typeof subscriptions.$inferSelect;

/**
 * The subscription an account is on, or `null`.
 *
 * **Newest first, and one answer.** An account can accumulate rows — cancel in
 * March, resubscribe in June — and the question every caller is asking is
 * "what is this account on now", not "what has it ever been on". A conferring
 * row wins over a dead one regardless of age, because a resubscription can be
 * created before the cancelled one's period has finished and the newer row is
 * not always the live one.
 */
export async function subscriptionFor(userId: string): Promise<SubscriptionRow | null> {
  const rows = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))
    .orderBy(desc(subscriptions.createdAt));
  return rows.find((row) => CONFERRING_STATUSES.includes(row.status)) ?? rows[0] ?? null;
}

/** Every subscription in a set of statuses — link 7's revenue reads. */
export async function subscriptionsWithStatus(
  statuses: readonly SubscriptionStatus[],
): Promise<SubscriptionRow[]> {
  if (statuses.length === 0) return [];
  return db.select().from(subscriptions).where(inArray(subscriptions.status, [...statuses]));
}

/** The row a Stripe subscription id names, if this deployment has seen it. */
export async function subscriptionByStripeId(
  stripeSubscriptionId: string,
  tx: Queryable = db,
): Promise<SubscriptionRow | null> {
  const rows = await tx
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.stripeSubscriptionId, stripeSubscriptionId))
    .limit(1);
  return rows[0] ?? null;
}

/** What the webhook has reconciled out of one Stripe event. */
export interface SubscriptionFacts {
  userId: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  planId: PlanId;
  planVersion: number;
  status: SubscriptionStatus;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  pastDueSince: Date | null;
  /** Stripe's `created` on the event these facts came from. */
  eventAt: Date;
}

/**
 * **Write what one event says, if it is not older than what we already
 * applied** (M21 link 4's ordering tolerance).
 *
 * Events arrive out of order. The defence is a comparison against
 * `last_event_at` in the UPDATE's own WHERE clause rather than a read followed
 * by a write, so two deliveries landing on two serverless instances at the same
 * moment cannot both pass a check and then both write.
 *
 * `>=` rather than `>`: two Stripe events can share a second, and dropping the
 * second would lose a real transition — a payment that failed and was retried
 * inside the same second is exactly the sequence this milestone cares about.
 * The cost of the looser comparison is that two same-second events apply in
 * arrival order; the cost of the tighter one is losing one of them.
 *
 * Returns whether anything was written, which is what the webhook reports.
 */
export async function applySubscriptionFacts(
  facts: SubscriptionFacts,
  now: Date = new Date(),
  tx: Queryable = db,
): Promise<{ applied: boolean; reason: "written" | "stale" }> {
  const existing = await subscriptionByStripeId(facts.stripeSubscriptionId, tx);
  if (existing === null) {
    await tx.insert(subscriptions).values({
      id: crypto.randomUUID(),
      userId: facts.userId,
      stripeCustomerId: facts.stripeCustomerId,
      stripeSubscriptionId: facts.stripeSubscriptionId,
      planId: facts.planId,
      planVersion: facts.planVersion,
      status: facts.status,
      currentPeriodEnd: facts.currentPeriodEnd,
      cancelAtPeriodEnd: facts.cancelAtPeriodEnd,
      pastDueSince: facts.pastDueSince,
      lastEventAt: facts.eventAt,
      createdAt: now,
      updatedAt: now,
    });
    return { applied: true, reason: "written" };
  }

  if (existing.lastEventAt > facts.eventAt) return { applied: false, reason: "stale" };

  const updated = await tx
    .update(subscriptions)
    .set({
      status: facts.status,
      planId: facts.planId,
      planVersion: facts.planVersion,
      currentPeriodEnd: facts.currentPeriodEnd,
      cancelAtPeriodEnd: facts.cancelAtPeriodEnd,
      pastDueSince: facts.pastDueSince,
      stripeCustomerId: facts.stripeCustomerId,
      lastEventAt: facts.eventAt,
      updatedAt: now,
    })
    // The guard is repeated HERE and not only above: between the read and this
    // statement another instance may have applied a newer event, and only the
    // database can settle that race.
    .where(
      and(
        eq(subscriptions.stripeSubscriptionId, facts.stripeSubscriptionId),
        // Drizzle has no `lte` on a column-to-value comparison that reads as
        // nicely as this; `sql` would work too, and `lte` is the plain one.
        lastEventAtIsNotNewerThan(facts.eventAt),
      ),
    )
    .returning({ id: subscriptions.id });

  return updated.length > 0
    ? { applied: true, reason: "written" }
    : { applied: false, reason: "stale" };
}

/** `last_event_at <= eventAt`, as a condition. */
function lastEventAtIsNotNewerThan(eventAt: Date) {
  // Imported lazily-shaped rather than at the top only to keep the comparison
  // beside the sentence that explains it; `lte` is an ordinary drizzle helper.
  return lte(subscriptions.lastEventAt, eventAt);
}
