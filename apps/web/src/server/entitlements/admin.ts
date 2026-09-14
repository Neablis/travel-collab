// **The operator surface's guard and its reads** (M20 link 7).
//
// A route group behind `users.is_admin`, **checked server-side on every route
// and every endpoint**. The gate box is explicit that hiding is not enough:
// *"a non-admin reaches no admin route AND no admin endpoint — checked
// server-side, and a test proves the route group is not merely hidden."*
//
// **Read-only over plans.** Versions are a committed file; the console shows
// what is live and has no write path to any of it (the 2026-09-02 amendment).
// Granting is the only write, and it is account state rather than plan
// definition — the whole reason this milestone is provable without Stripe.
//
// **No MRR, no ARPU, no margin.** All three need a subscription to exist and
// are M21 link 7's. The design draws them on the same screen and does not say
// which half is which, so an implementer working from the finished picture
// builds the revenue strip here and breaks the split in the direction nobody
// checks. This module has no revenue read at all, and a test says so.
import { desc, eq, sql } from "drizzle-orm";
import type { PlanId } from "@tc/contracts";
import { db } from "@/server/db/client";
import { adminConsoleFlag } from "@/server/flags";
import { entitlementGrants, users } from "@/server/db/schema";
import { PLAN_VERSIONS, planVersionRefOf, type PlanVersion } from "./planVersions";
import { entitlementsFor } from "./resolver";
import { costPerAccount, requestCounts, topSpenders, type AccountCost } from "./usage";

/**
 * **The STORED fact, about any account.** Never consults the flag.
 *
 * This is what the console displays in its accounts table, and the distinction
 * from `callerIsAdmin` below is a correctness one rather than a tidiness one:
 * the `admin-console` flag resolves **the caller**, so asking it about somebody
 * else's id would answer with the viewer's own flag value and paint every row
 * as an operator the moment one operator had the flag. Use this whenever the
 * question is *"is that account an operator"*.
 */
export async function isAdmin(userId: string): Promise<boolean> {
  const rows = await db
    .select({ isAdmin: users.isAdmin })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return rows[0]?.isAdmin ?? false;
}

/**
 * The `admin-console` flag, for the caller of this request, failing closed.
 *
 * **The catch is load-bearing and is not decoration.** The Flags SDK applies
 * `defaultValue` only to what `decide` returns or throws — `identify` runs
 * EARLIER (`getEntities` ahead of `applyResult`, verified in `flags@4.3.0`), so
 * a session read that throws escapes the flag entirely and would propagate as
 * an unhandled rejection. `aiLive()` catches the same hole for `ai-live`. Here
 * the answer to every question this flag cannot resolve is **not an operator**,
 * which is also the answer when no adapter is configured at all — the ordinary
 * case locally and in CI, where `ADMIN_USER_IDS` is the path instead.
 */
async function adminConsoleFlagForCaller(): Promise<boolean> {
  try {
    return await adminConsoleFlag();
  } catch {
    return false;
  }
}

/**
 * **May THIS CALLER open the console** — the stored fact, or a flag targeted at
 * them. The one question the route group and every admin endpoint ask.
 *
 * `callerId` must be the id of whoever is making this request. The flag half
 * resolves the caller from the session (`identifyFlagEntities`), so passing
 * anyone else's id would silently mix two accounts' answers; `isAdmin` above is
 * the function for asking about somebody else.
 *
 * **The column is read first**, and not only because it is the cheaper hop: an
 * operator whose bit is stored stays an operator while the Flags service is
 * unreachable, which is what keeps a third-party outage from emptying the
 * console. The flag is a second way to say yes and never a way to say no —
 * revoking is clearing the column.
 */
export async function callerIsAdmin(callerId: string): Promise<boolean> {
  if (await isAdmin(callerId)) return true;
  return adminConsoleFlagForCaller();
}

/** How far back every "cost over a trailing window" number here looks. */
export const TRAILING_WINDOW_DAYS = 30;

export function trailingWindowStart(now: Date = new Date()): Date {
  return new Date(now.getTime() - TRAILING_WINDOW_DAYS * 24 * 60 * 60 * 1000);
}

/** One row of the tier panel: what a plan is, and how many hold it. */
export interface PlanPanelRow {
  planId: PlanId;
  /** Every published version, oldest first — the version history, per link 7. */
  versions: readonly PlanVersion[];
  /** The newest published version: what a new holding would pin. */
  live: PlanVersion;
  /** Accounts whose `users.plan_id` is this plan. */
  accounts: number;
}

/**
 * **Accounts per plan** (gate box), plus each plan's version history.
 *
 * Counts `users.plan_id`, which is what an account HOLDS. A grant of `premium`
 * does not move an account into the `premium` row here, and that is correct:
 * what it holds and what it was granted are two different facts, and the grant
 * counts below are where the second one is answered.
 */
export async function planPanel(): Promise<PlanPanelRow[]> {
  const counts = await db
    .select({ planId: users.planId, count: sql<number>`count(*)::int` })
    .from(users)
    .groupBy(users.planId);
  const byPlan = new Map(counts.map((row) => [row.planId, row.count]));
  const planIds = [...new Set(PLAN_VERSIONS.map((entry) => entry.planId))];
  return planIds.map((planId) => {
    const versions = PLAN_VERSIONS.filter((entry) => entry.planId === planId);
    return {
      planId,
      versions,
      live: versions[versions.length - 1]!,
      accounts: byPlan.get(planId) ?? 0,
    };
  });
}

/**
 * **Accounts per active grant source** (gate box).
 *
 * Active, so an expired trial is not counted as one somebody holds — and the
 * row it reads is still there, because nothing sweeps this table. The two
 * questions *"how many accounts are on a trial right now"* and *"how many have
 * ever had one"* are different, and this is the first.
 */
export async function grantSourcePanel(now: Date = new Date()): Promise<Record<string, number>> {
  const rows = await db
    .select({ source: entitlementGrants.source, count: sql<number>`count(distinct ${entitlementGrants.userId})::int` })
    .from(entitlementGrants)
    .where(
      sql`${entitlementGrants.revokedAt} is null and (${entitlementGrants.expiresAt} is null or ${entitlementGrants.expiresAt} > ${now})`,
    )
    .groupBy(entitlementGrants.source);
  return Object.fromEntries(rows.map((row) => [row.source, row.count]));
}

/** One active grant, as the console shows it. */
export interface AdminGrantRow {
  id: string;
  source: string;
  planVersionRef: string;
  /** ISO, or `null` for permanent — which is what a founder grant is. */
  expiresAt: string | null;
}

/** One row of the accounts table. */
export interface AdminAccountRow {
  userId: string;
  email: string | null;
  /** What they hold — plan and the version they pinned. */
  planVersionRef: string;
  isAdmin: boolean;
  /** Why they hold what they hold: every active grant's source. */
  grantSources: readonly string[];
  /**
   * The grants themselves — link 7's *"grant history"*, and what makes
   * **revoking** possible from the console rather than only granting.
   *
   * Active grants only: a revoked or expired row is retained forever (nothing
   * sweeps that table) but there is nothing left to revoke about it, and
   * offering a Revoke button for one would be a control that does nothing.
   */
  grants: readonly AdminGrantRow[];
  /** Their effective capabilities, as the resolver answers them right now. */
  entitlements: readonly string[];
  /** Requests and micro-dollars over the trailing window. */
  requests: number;
  microUsd: number;
  /** Rows whose model has no published rate, so `microUsd` understates. */
  unpriced: number;
}

/**
 * The accounts table (gate box: *"accounts per plan"*, plus the reporting in
 * link 9).
 *
 * **Resolved per account through the real resolver**, not reassembled here.
 * A second implementation of the union is a second thing that can disagree
 * with the gates, and the one that disagrees is always the one nobody is
 * looking at. Bounded by `limit` for exactly that reason: this is N+2 queries
 * and it is a page of an operator tool, not a hot path.
 */
export async function adminAccounts(
  limit = 100,
  now: Date = new Date(),
): Promise<AdminAccountRow[]> {
  const since = trailingWindowStart(now);
  const [rows, costs, counts] = await Promise.all([
    db
      .select({ id: users.id, email: users.email, isAdmin: users.isAdmin })
      .from(users)
      .orderBy(desc(users.createdAt))
      .limit(limit),
    costPerAccount(since),
    requestCounts(since),
  ]);
  const costByUser = new Map(costs.map((cost) => [cost.userId, cost]));
  return Promise.all(
    rows.map(async (row) => {
      const resolved = await entitlementsFor(row.id, now);
      const cost = costByUser.get(row.id);
      return {
        userId: row.id,
        email: row.email,
        planVersionRef: planVersionRefOf(resolved.held),
        isAdmin: row.isAdmin,
        grantSources: resolved.grants.map((grant) => grant.source),
        grants: resolved.grants.map((grant) => ({
          id: grant.id,
          source: grant.source,
          planVersionRef: `${grant.planId}@v${grant.planVersion}`,
          expiresAt: grant.expiresAt?.toISOString() ?? null,
        })),
        entitlements: [...resolved.entitlements],
        requests: counts.get(row.id) ?? 0,
        microUsd: cost?.microUsd ?? 0,
        unpriced: cost?.unpriced ?? 0,
      };
    }),
  );
}

/** **The top spenders** (gate box), over the trailing window. */
export async function adminTopSpenders(n = 10, now: Date = new Date()): Promise<AccountCost[]> {
  return topSpenders(trailingWindowStart(now), n);
}

/** **Cost per account over a trailing window** (gate box). */
export async function adminCostPerAccount(now: Date = new Date()): Promise<AccountCost[]> {
  return costPerAccount(trailingWindowStart(now));
}

/** Everything one console page needs, in one call. */
export interface AdminOverview {
  plans: PlanPanelRow[];
  grantSources: Record<string, number>;
  accounts: AdminAccountRow[];
  topSpenders: AccountCost[];
  windowDays: number;
}

export async function adminOverview(now: Date = new Date()): Promise<AdminOverview> {
  const [plans, grantSources, accounts, spenders] = await Promise.all([
    planPanel(),
    grantSourcePanel(now),
    adminAccounts(100, now),
    adminTopSpenders(10, now),
  ]);
  return {
    plans,
    grantSources,
    accounts,
    topSpenders: spenders,
    windowDays: TRAILING_WINDOW_DAYS,
  };
}
