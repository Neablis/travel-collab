// **The admin's Stripe test-mode switch** (ADR-076 §6), the one reader and
// writer of `users.stripe_test_mode`.
//
// On, an account's new checkouts and its portal use the test pair, so a test
// card confers a plan through the ordinary webhook path, with
// `plan_livemode = false`. That is a free-plan switch, which is why the only
// door to `setTestMode` is the admin route behind `requireAdminApi`, and why
// nothing here is returned to the account itself.
import type { AdminTestMode } from "@tc/contracts";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { billingConfig, testPairConfigured, type StripeMode } from "./config";

/** One account's switch, or `null` when there is no such account. */
export async function testModeFor(userId: string): Promise<AdminTestMode | null> {
  const rows = await db
    .select({ enabled: users.stripeTestMode })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const row = rows[0];
  return row === undefined ? null : { enabled: row.enabled, available: testPairConfigured() };
}

/** Set one account's switch; `false` when there is no such account. */
export async function setTestMode(userId: string, enabled: boolean): Promise<boolean> {
  const written = await db
    .update(users)
    .set({ stripeTestMode: enabled })
    .where(eq(users.id, userId))
    .returning({ id: users.id });
  return written.length > 0;
}

/**
 * The Stripe mode a new checkout or portal session for this account uses.
 *
 * Test when the switch is on **and** a test pair is configured; otherwise the
 * primary pair's mode, which is live on production and test on a deployment
 * holding only test keys. A switch left on after its pair was removed falls
 * back rather than failing every checkout for that account.
 *
 * Not for a change to an existing subscription: that uses the subscription's
 * own `livemode`, because Stripe knows it in that mode only (`planChange.ts`).
 */
export async function billingModeFor(userId: string): Promise<StripeMode> {
  const { primary } = billingConfig();
  const switched = await testModeFor(userId);
  return switched?.enabled === true && switched.available ? "test" : primary;
}
