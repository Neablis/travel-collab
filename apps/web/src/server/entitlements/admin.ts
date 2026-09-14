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
import { GrantSource, type PlanId } from "@tc/contracts";
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
  /**
   * Holders of each published version, keyed by version number — the design's
   * *"204 hold"* beside each version row. Answers "who is on an older one",
   * which is the question the tier panel exists for now that publishing has
   * left the UI.
   */
  holdsByVersion: Readonly<Record<number, number>>;
  /**
   * **Median** trailing model cost of this plan's holders, in micro-dollars,
   * or `null` when nobody on the plan spent anything measurable.
   *
   * Median rather than mean, as the design labels it: one account running a
   * batch job drags a mean far enough to make the number useless for the
   * question being asked, which is what a typical holder of this tier costs.
   *
   * **The MRR and median-margin columns beside this one in the design are M21
   * link 7's** — both need a subscription to exist. This is the half that does
   * not.
   */
  medianMicroUsd: number | null;
}

/** The middle value, or the lower of the two middles. `null` when empty. */
function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)]!;
}

/**
 * **Accounts per plan** (gate box), plus each plan's version history.
 *
 * Counts `users.plan_id`, which is what an account HOLDS. A grant of `premium`
 * does not move an account into the `premium` row here, and that is correct:
 * what it holds and what it was granted are two different facts, and the grant
 * counts below are where the second one is answered.
 */
export async function planPanel(now: Date = new Date()): Promise<PlanPanelRow[]> {
  // Grouped by (plan, version) in ONE query rather than by plan: the design
  // wants a hold count against each published version, and the plan total is
  // the sum of those — deriving it the other way round would need a second
  // query to say the same thing.
  const [counts, costs] = await Promise.all([
    db
      .select({
        planId: users.planId,
        planVersion: users.planVersion,
        count: sql<number>`count(*)::int`,
      })
      .from(users)
      .groupBy(users.planId, users.planVersion),
    costByPlan(now),
  ]);

  const planIds = [...new Set(PLAN_VERSIONS.map((entry) => entry.planId))];
  return planIds.map((planId) => {
    const versions = PLAN_VERSIONS.filter((entry) => entry.planId === planId);
    const mine = counts.filter((row) => row.planId === planId);
    return {
      planId,
      versions,
      live: versions[versions.length - 1]!,
      accounts: mine.reduce((total, row) => total + row.count, 0),
      // **Every published version, including the ones nobody holds.** Built
      // from `versions` rather than from the query, so a version with no
      // holders reads `0` instead of being absent — a sparse map makes "nobody
      // is on v1" and "v1 is not a version" the same shape at the call site,
      // and the panel renders `?? 0` for both. CodeRabbit, PR #174.
      holdsByVersion: Object.fromEntries(
        versions.map((version) => [
          version.version,
          mine.find((row) => row.planVersion === version.version)?.count ?? 0,
        ]),
      ),
      medianMicroUsd: median(costs.get(planId) ?? []),
    };
  });
}

/**
 * Every holder's trailing cost, bucketed by the plan they hold.
 *
 * Accounts with no usage in the window are deliberately **absent** rather than
 * counted as zero: "what does a typical holder of this tier cost" is a question
 * about accounts that used the assistant, and folding in every dormant account
 * pulls every median to zero and tells you nothing. This is the same
 * null-is-not-zero rule `microUsdFor` follows, one level up.
 */
async function costByPlan(now: Date): Promise<Map<PlanId, number[]>> {
  const [holders, costs] = await Promise.all([
    db.select({ id: users.id, planId: users.planId }).from(users),
    costPerAccount(trailingWindowStart(now)),
  ]);
  const planOf = new Map(holders.map((row) => [row.id, row.planId]));
  const byPlan = new Map<PlanId, number[]>();
  for (const cost of costs) {
    const planId = planOf.get(cost.userId);
    if (planId === undefined) continue;
    // **An account whose every request is unpriceable contributes NOTHING, not
    // zero.** `costPerAccount` reports such an account as
    // `{ microUsd: 0, unpriced: n }` — the 0 is "nothing could be priced", not
    // "this was free — and pushing it into the sample drags the median to zero
    // exactly when no cost is measurable, which is the `null` this function
    // documents arriving as a confident `$0.0000` instead. Caught by CodeRabbit
    // on PR #174; it is the same null-is-not-zero rule `microUsdFor` follows,
    // one more level up.
    if (cost.requests === cost.unpriced) continue;
    const bucket = byPlan.get(planId) ?? [];
    bucket.push(cost.microUsd);
    byPlan.set(planId, bucket);
  }
  return byPlan;
}

/**
 * **Accounts per active grant source** (gate box).
 *
 * Active, so an expired trial is not counted as one somebody holds — and the
 * row it reads is still there, because nothing sweeps this table. The two
 * questions *"how many accounts are on a trial right now"* and *"how many have
 * ever had one"* are different, and this is the first.
 */
export interface GrantSourceRow {
  source: string;
  /** Distinct accounts holding at least one active grant from this source. */
  accounts: number;
  /** What those accounts cost over the trailing window, in micro-dollars. */
  microUsd: number;
}

/**
 * **Underwater by construction** — the comped half of the design's *"Costs more
 * than it pays"* panel, and the only half M20 can answer.
 *
 * The other half, *"paying, and underwater"*, compares trailing cost against
 * what an account pays. Nothing pays yet, so it is M21 link 7's along with the
 * four-number strip. These accounts are underwater **by construction**: they
 * were comped on purpose, which is why the design counts them and sets them
 * aside rather than listing them — mixed into the table they would bury the
 * rows that actually need a decision.
 *
 * **Active grants only**, so an expired trial is not counted as one somebody
 * holds. The row it reads is still there — nothing sweeps that table — because
 * *"how many are on a trial now"* and *"how many ever had one"* are different
 * questions and this is the first.
 *
 * Cost is attributed **per account, once**: an account holding both a trial and
 * a referral grant contributes its whole trailing cost to each source's line,
 * because the question each line answers is "what is this source costing me",
 * not "how does this total decompose". Summing the column would double-count,
 * and the design never sums it.
 */
export async function grantSourcePanel(now: Date = new Date()): Promise<GrantSourceRow[]> {
  const [rows, costs] = await Promise.all([
    db
      .select({ source: entitlementGrants.source, userId: entitlementGrants.userId })
      .from(entitlementGrants)
      .where(
        sql`${entitlementGrants.revokedAt} is null and (${entitlementGrants.expiresAt} is null or ${entitlementGrants.expiresAt} > ${now})`,
      ),
    costPerAccount(trailingWindowStart(now)),
  ]);

  const costOf = new Map(costs.map((cost) => [cost.userId, cost.microUsd]));
  const holders = new Map<string, Set<string>>();
  for (const row of rows) {
    const set = holders.get(row.source) ?? new Set<string>();
    set.add(row.userId);
    holders.set(row.source, set);
  }

  // Every source in the contract, including the ones nobody holds — a panel
  // whose rows appear and vanish with the data makes "no trials right now" and
  // "trials are not a thing" indistinguishable.
  return GrantSource.options.map((source) => {
    const users = holders.get(source) ?? new Set<string>();
    let microUsd = 0;
    for (const userId of users) microUsd += costOf.get(userId) ?? 0;
    return { source, accounts: users.size, microUsd };
  });
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
  grantSources: GrantSourceRow[];
  accounts: AdminAccountRow[];
  topSpenders: AccountCost[];
  windowDays: number;
}

export async function adminOverview(now: Date = new Date()): Promise<AdminOverview> {
  const [plans, grantSources, accounts, spenders] = await Promise.all([
    planPanel(now),
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
