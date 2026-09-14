// **Who holds what** — the Entitlements module's second store (ADR-045 rule 1).
//
// The write surface over `entitlement_grants` and the two `users` columns. The
// read side is `resolver.ts`, which is the module's one entry point for
// answering *what may this account do*.
//
// **This module does not know what a trip is** (ADR-045 rule 5). No trip type
// is imported here or anywhere under `server/entitlements/`, and
// `moduleBoundary.test.ts` enforces it.
import { and, eq, isNull, or, gt, sql } from "drizzle-orm";
import type { GrantSource, PlanId } from "@tc/contracts";
import { db, type Queryable } from "@/server/db/client";
import { entitlementGrants, users } from "@/server/db/schema";
import { livePlanVersion } from "./planVersions";

/** One row of `entitlement_grants`, as read back. */
export type GrantRow = typeof entitlementGrants.$inferSelect;

/** What an account holds as its base plan, before any grant. */
export interface HeldPlan {
  planId: PlanId;
  planVersion: number;
}

/**
 * Active means: not revoked, and not expired **as at this instant**.
 *
 * `expires_at IS NULL` is permanent — a founder grant. Expiry is resolved on
 * read and **never swept**, which is the gate box's *"the grant expires; the
 * next request is refused again. Nothing was revoked by hand and no job ran."*
 */
function activeAt(now: Date) {
  return and(
    isNull(entitlementGrants.revokedAt),
    or(isNull(entitlementGrants.expiresAt), gt(entitlementGrants.expiresAt, now)),
  );
}

/** Every grant this account holds right now. */
export async function activeGrantsFor(userId: string, now: Date = new Date()): Promise<GrantRow[]> {
  return db
    .select()
    .from(entitlementGrants)
    .where(and(eq(entitlementGrants.userId, userId), activeAt(now)));
}

/**
 * Every grant this account has EVER held, active or not.
 *
 * The eligibility read. It exists separately from `activeGrantsFor` because the
 * two ask different questions and conflating them is how the one-time-ever
 * trial dies: *"has this account ever held a trial"* must see expired and
 * revoked rows, and *"what may this account do"* must not.
 */
export async function allGrantsFor(userId: string): Promise<GrantRow[]> {
  return db.select().from(entitlementGrants).where(eq(entitlementGrants.userId, userId));
}

/**
 * Has this account ever been offered a trial — expired, revoked or running.
 *
 * **One time ever per account** (Mitchell, 2026-09-13). Not one per
 * subscription, not one per lapse. An account that trials, lapses, subscribes,
 * cancels and comes back is not offered another week, and this is the read that
 * makes that true: it ignores `expires_at` and `revoked_at` entirely.
 *
 * **"Per account" means the `users` row, and that is the honest limit.** The id
 * is the Auth.js subject verbatim (ADR-025), so the same Google account
 * returning is the same row and gets no second trial. Someone with a second
 * Google account gets a second trial; M11a gates who reaches the product at
 * all, and stacking an identity check on the invite gate buys little.
 */
export async function hasEverHeldTrial(userId: string): Promise<boolean> {
  const rows = await db
    .select({ id: entitlementGrants.id })
    .from(entitlementGrants)
    .where(and(eq(entitlementGrants.userId, userId), eq(entitlementGrants.source, "trial")))
    .limit(1);
  return rows.length > 0;
}

/** What one account holds as its base plan. `null` when there is no row. */
export async function heldPlanFor(userId: string): Promise<HeldPlan | null> {
  const rows = await db
    .select({ planId: users.planId, planVersion: users.planVersion })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const row = rows[0];
  return row === undefined ? null : { planId: row.planId, planVersion: row.planVersion };
}

/** What a grant is asked for, by the trial, the referral loop, and an operator. */
export interface IssueGrant {
  userId: string;
  planId: PlanId;
  planVersion: number;
  source: GrantSource;
  /** Null for `trial` and `referral` — there is no operator behind either. */
  grantedBy?: string | null;
  reason?: string | null;
  /** Null is permanent. A founder grant is the only one that uses it today. */
  expiresAt: Date | null;
}

/**
 * Write one grant.
 *
 * `ON CONFLICT DO NOTHING` against the partial unique index that makes the
 * trial one-time-ever: a second trial for the same account is a **no-op, not an
 * error**, because a returning account simply does not get another week and
 * that is not a failure to report. Every other source is unconstrained, so this
 * clause never fires for them.
 *
 * Returns whether a row was actually written, which is what the caller needs to
 * know at signup.
 */
export async function issueGrant(
  grant: IssueGrant,
  now: Date = new Date(),
  // The referral loop counts a rolling window and then writes, and a
  // count-then-write is not a cap unless both happen under one lock — so it
  // passes its transaction in (`referrals.ts`'s `withAccountLock`). Defaults to
  // the pool for every other caller, which needs no serialisation: the trial's
  // one-time-ever rule is a partial unique index, and an admin grant is one
  // operator pressing one button.
  tx: Queryable = db,
): Promise<boolean> {
  const written = await tx
    .insert(entitlementGrants)
    .values({
      id: crypto.randomUUID(),
      userId: grant.userId,
      planId: grant.planId,
      planVersion: grant.planVersion,
      source: grant.source,
      grantedBy: grant.grantedBy ?? null,
      reason: grant.reason ?? null,
      createdAt: now,
      expiresAt: grant.expiresAt,
      revokedAt: null,
      revokedBy: null,
    })
    .onConflictDoNothing()
    .returning({ id: entitlementGrants.id });
  return written.length > 0;
}

/** How long a trial runs. One constant, read by the issuer and by its test. */
export const TRIAL_DAYS = 7;

/**
 * Offer the one-week `plus` trial, if this account has never held one.
 *
 * **The trial is link 2's table and link 3's resolver with a different
 * `source`** — M20's own words, and the test of whether *The shape*'s collapse
 * actually held. It needed no ninth link and it gets no special case in the
 * resolver.
 *
 * The `hasEverHeldTrial` read is an optimisation and a place to log, **not the
 * guarantee**: two concurrent sign-ins can both pass it. The partial unique
 * index is what makes one-time-ever true, and `issueGrant`'s
 * `ON CONFLICT DO NOTHING` is what makes the loser silent.
 *
 * `plus`, not `premium` (Mitchell, 2026-09-01). One accepted consequence:
 * **nobody experiences collaboration before paying for it**, since
 * `trip.collaborators` is never trialled — which is why M20 link 6's refusal
 * copy has to name the tier rather than read as a permission error.
 */
export async function offerTrial(userId: string, now: Date = new Date()): Promise<boolean> {
  if (await hasEverHeldTrial(userId)) return false;
  const trialled = livePlanVersion("plus");
  const expiresAt = new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
  return issueGrant(
    {
      userId,
      planId: trialled.planId,
      planVersion: trialled.version,
      source: "trial",
      grantedBy: null,
      reason: `Automatic ${TRIAL_DAYS}-day trial at signup.`,
      expiresAt,
    },
    now,
  );
}

/**
 * Revoke a grant — the operator's undo, and the only write that ever ends one
 * early.
 *
 * **Marks, never deletes.** Revoking is not tidying: the row is what answers
 * *"has this account ever held a trial"*, and removing it would restore the
 * trial to whoever had it revoked. Conditional on `revoked_at IS NULL`, so a
 * second revoke is a no-op rather than a rewrite of who did it and when.
 */
export async function revokeGrant(
  grantId: string,
  revokedBy: string,
  now: Date = new Date(),
): Promise<boolean> {
  const updated = await db
    .update(entitlementGrants)
    .set({ revokedAt: now, revokedBy })
    .where(and(eq(entitlementGrants.id, grantId), isNull(entitlementGrants.revokedAt)))
    .returning({ id: entitlementGrants.id });
  return updated.length > 0;
}

/**
 * Count of every grant ever written for an account, by source.
 *
 * Phase 6's console reads this; it is here rather than there because the
 * console must not learn this table's shape (ADR-045 rule 1 — the store is the
 * module's).
 */
export async function grantCountsBySource(): Promise<Record<string, number>> {
  const rows = await db
    .select({ source: entitlementGrants.source, count: sql<number>`count(*)::int` })
    .from(entitlementGrants)
    .where(activeAt(new Date()))
    .groupBy(entitlementGrants.source);
  return Object.fromEntries(rows.map((row) => [row.source, row.count]));
}
