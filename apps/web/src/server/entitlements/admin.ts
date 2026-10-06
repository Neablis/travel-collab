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
// **The revenue half arrived with M21 link 7**, which is where the split note
// above always said it would. What that means for this module is narrow and is
// worth stating, because the split it replaces was load-bearing for two
// milestones: **every revenue number is computed in `server/billing/revenue.ts`
// and passed through here.** This module reads plans, grants and cost; it does
// not learn what a subscription is. The tier panel is *"split down the middle"*
// exactly as the milestone says — accounts, versions and hold counts are M20's
// and live here; MRR and median margin per tier are link 7's and are merged in
// from Billing.
import { asc, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { CONFERRING_STATUSES, type PlanId } from "@tc/contracts";
import { db } from "@/server/db/client";
import { adminConsoleFlag } from "@/server/flags";
import { aiUsage, entitlementGrants, events, subscriptions, users } from "@/server/db/schema";
import { activeGrantHolders } from "./grants";
import { PLAN_VERSIONS, livePlanVersion, planVersionRefOf, type PlanVersion } from "./planVersions";
import { entitlementsFor, type AccountEntitlements } from "./resolver";
import {
  monthlyMicroUsd,
  revenueByPlan,
  revenueSummary,
  underwaterReport,
  type RevenueSummary,
  type UnderwaterReport,
} from "@/server/billing/revenue";
import { priceConsistencyReport, type PriceConsistencyReport } from "@/server/billing/prices";
import { GRACE_WINDOW_DAYS } from "@/server/billing/standing";
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
 *
 * **The `FLAGS` check is what closes KI-2026-09-14-a**, and which env it reads
 * is the whole point. Unconfigured, the SDK still answers `false` — correctly —
 * but logs `Flag "admin-console" is falling back to its defaultValue … No flag
 * definitions available` on EVERY evaluation, and `/api/account/preferences` is
 * hit twice per page load for every non-admin, which is everybody in exactly
 * the environments where it cannot work. Dozens of lines per e2e run, in the
 * one place a developer is reading output.
 *
 * That entry considered gating on `process.env.VERCEL` and rejected it, for a
 * good reason: *"a deployment that is not Vercel, with Flags genuinely
 * configured, silently stops honouring the flag. A control that quietly stops
 * working is worse than a log line."* It asked instead for *"a positive signal
 * that Flags is configured at all — one env read the adapter already depends
 * on"*, and said it *"needs checking against `@flags-sdk/vercel`'s actual
 * configuration surface rather than guessed at"*.
 *
 * Checked, 2026-09-23. `@flags-sdk/vercel` reads no environment itself; it
 * delegates to `@vercel/flags-core`, whose client is built by
 * `createClient(process.env.FLAGS)`. **`FLAGS` IS the configuration surface** —
 * without it there is no auth, so `resolveDataWithFallbacks` exhausts stream,
 * polling, datafile, bundled definitions and a one-time fetch, and throws.
 *
 * So this is not the rejected gate wearing a different name. `VERCEL` is a
 * proxy for "probably configured" and can be wrong in both directions;
 * `FLAGS` is the credential the SDK itself requires, so its absence is not
 * evidence that the flag is inert — it is the *definition* of inert. A
 * non-Vercel deployment with Flags genuinely configured has `FLAGS` set and is
 * unaffected, which is precisely the case the rejection was protecting.
 */
async function adminConsoleFlagForCaller(): Promise<boolean> {
  // Asked before the call, not after: the log line this avoids is emitted by
  // the SDK during evaluation, so catching afterwards cannot suppress it.
  if (!process.env.FLAGS) return false;
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
   * **The MRR and median-margin columns beside this one are M21 link 7's** and
   * are the two fields below. This one is the half that needed no subscription:
   * what a typical HOLDER of this tier costs, whether or not they pay.
   */
  medianMicroUsd: number | null;
  /** M21 link 7 — what this tier brings in a month, in micro-dollars. */
  mrrMicroUsd: number;
  /**
   * M21 link 7 — the median of (what a payer on this tier pays) minus (what
   * they cost), over the trailing window. `null` when nobody on the tier pays.
   *
   * **Not `medianMicroUsd` minus anything.** That number includes holders who
   * pay nothing, so subtracting a price from it would be comparing a cost
   * across all holders with a price only some of them send.
   */
  medianMarginMicroUsd: number | null;
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
 * what it holds and what it was granted are two different facts, and the
 * per-source counts in Billing's `underwaterReport` are where the second one is
 * answered.
 */
export async function planPanel(
  now: Date = new Date(),
  trailing?: readonly AccountCost[],
): Promise<PlanPanelRow[]> {
  // `trailing` is the overview's one ledger read, handed down so this panel is
  // computed over the same rows as every other (see `adminOverview`). Read here
  // only when the panel is asked for on its own.
  const ledger = trailing ?? (await adminCostPerAccount(now));
  // Grouped by (plan, version) in ONE query rather than by plan: the design
  // wants a hold count against each published version, and the plan total is
  // the sum of those — deriving it the other way round would need a second
  // query to say the same thing.
  const [counts, costs, revenue] = await Promise.all([
    db
      .select({
        planId: users.planId,
        planVersion: users.planVersion,
        count: sql<number>`count(*)::int`,
      })
      .from(users)
      .groupBy(users.planId, users.planVersion),
    costByPlan(ledger),
    // Billing prices the revenue half; the cost it is compared against is this
    // module's ledger, read once and handed across (ADR-047 decision 1, as
    // amended 2026-09-25 — Billing reads no ledger).
    revenueByPlan(ledger, now),
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
      mrrMicroUsd: revenue.find((row) => row.planId === planId)?.mrrMicroUsd ?? 0,
      medianMarginMicroUsd:
        revenue.find((row) => row.planId === planId)?.medianMarginMicroUsd ?? null,
    };
  });
}

/**
 * Plan ids an operator may grant: those whose live version is enabled — the
 * same test `POST /api/admin/grants` refuses on. `enabled` bounds what may be
 * handed out, never what a holder may do.
 */
export function grantablePlanIds(): PlanId[] {
  return [...new Set(PLAN_VERSIONS.map((entry) => entry.planId))].filter(
    (planId) => livePlanVersion(planId).enabled,
  );
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
async function costByPlan(costs: readonly AccountCost[]): Promise<Map<PlanId, number[]>> {
  const holders = await db.select({ id: users.id, planId: users.planId }).from(users);
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
  /**
   * Requests and micro-dollars over the trailing window.
   *
   * `requests` is the console's **Asked 30d** (M36 link 2): one `ai_usage` row
   * is one assistant turn, so a count of them in the window is the questions
   * asked. It was already this, so the column reads it rather than adding a
   * second field that would have to agree with it.
   */
  requests: number;
  microUsd: number;
  /** Rows whose model has no published rate, so `microUsd` understates. */
  unpriced: number;
  /**
   * **What this account pays a month**, in micro-dollars, or 0 (M21 link 7).
   *
   * **Three values, not two.** `0` is an account with no conferring
   * subscription — a measurement. `null` is one that HAS a conferring
   * subscription pinned to a version this deploy cannot price — a reporting
   * gap. The first version collapsed the second into the first with a `?? 0`,
   * which made an unpriceable subscription read as "pays nothing" and
   * suppressed the underwater chip on the one row that most needed it.
   * CodeRabbit, PR #177.
   */
  paysMicroUsd: number | null;
  /** Stripe's own word, or `null` for an account that has never subscribed. */
  subscriptionState: string | null;
  /**
   * **Last active** (M36 D6), ISO — the later of the account's newest planning
   * event and its newest assistant turn inside the trailing window, or `null`
   * when it did neither in that window. See `lastActiveSince`.
   */
  lastActiveAt: string | null;
}

/**
 * **When each of these accounts last did anything**, over the trailing window
 * (M36 D6).
 *
 * Derived, never stored: the newest of its planning events (`events.actor_id`)
 * and its assistant turns (`ai_usage.user_id`), so no `last_seen` column and
 * no write on the request path. Bounded by the window as D6 words it, so
 * `null` reads "not in 30 days", not "never".
 *
 * **Only the accounts asked about** — one page of the table, or one account
 * page — over `events_actor_occurred` (migration 0040) and
 * `ai_usage_user_created`. It was one grouped read over everyone's window,
 * which is a sequential scan of the event log on every console load: 31 ms at
 * 300k events and growing with the log, against ~1 ms scoped (M36 perf pass).
 *
 * This reads the event log, which is the planning domain's and not this
 * module's; a read of who wrote a row is not a write through it (invariant 1),
 * and nothing here learns what any event means — only its actor and time.
 */
export async function lastActiveSince(
  since: Date,
  userIds: readonly string[],
): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map();
  const from = since.toISOString();
  const ids = sql.join(
    userIds.map((id) => sql`${id}`),
    sql`, `,
  );
  const rows = await db.execute<{ user_id: string; at: Date | string }>(sql`
    select user_id, max(at) as at from (
      select ${events.actorId} as user_id, max(${events.occurredAt}) as at
        from ${events} where ${events.actorId} in (${ids}) and ${events.occurredAt} >= ${from}
       group by ${events.actorId}
      union all
      select ${aiUsage.userId} as user_id, max(${aiUsage.createdAt}) as at
        from ${aiUsage} where ${aiUsage.userId} in (${ids}) and ${aiUsage.createdAt} >= ${from}
       group by ${aiUsage.userId}
    ) as activity
    group by user_id
  `);
  // `db.execute` hands back whatever the driver produced: node-postgres parses
  // a `timestamptz` into a `Date`, and a string is accepted for the day it does not.
  return new Map(rows.rows.map((row) => [row.user_id, new Date(row.at).toISOString()]));
}

/**
 * The newest `limit` accounts, newest first, plus any id in `include` that is
 * not among them — what `GET /api/admin/overview` answers. The console's own
 * table is `adminAccountsPage`, which pages in SQL instead.
 *
 * **Resolved per account through the real resolver**, not reassembled here.
 * A second implementation of the union is a second thing that can disagree
 * with the gates, and the one that disagrees is always the one nobody is
 * looking at. Bounded by `limit` for exactly that reason: the resolver is
 * three queries an account.
 *
 * **`include` is outside the bound.** The `limit` newest accounts come first,
 * newest first; any id in `include` that is not among them is appended after,
 * also newest first. Ties on `createdAt` — a bulk insert stamps one instant —
 * break on the id, so the bound and the order are the same on every read.
 * The overview passes the underwater payers, so *Show them in Users* finds
 * every account Financial counted — `underwaterReport` reads every account
 * with a cost, and a payer older than the newest 100 was counted there and
 * drawn nowhere.
 */
export async function adminAccounts(
  limit = 100,
  now: Date = new Date(),
  trailing?: readonly AccountCost[],
  include: readonly string[] = [],
): Promise<AdminAccountRow[]> {
  const columns = { id: users.id, email: users.email, isAdmin: users.isAdmin };
  const newest = await db.select(columns).from(users).orderBy(desc(users.createdAt), asc(users.id)).limit(limit);
  const shown = new Set(newest.map((row) => row.id));
  const missing = [...new Set(include)].filter((id) => !shown.has(id));
  const rows =
    missing.length === 0
      ? newest
      : [
          ...newest,
          ...(await db
            .select(columns)
            .from(users)
            .where(inArray(users.id, missing))
            .orderBy(desc(users.createdAt), asc(users.id))),
        ];
  return accountRows(rows, now, trailing);
}

/**
 * These accounts' rows, in the order given: the resolver per account, and the
 * window's activity read for these ids only. `trailing` is the caller's one
 * ledger read when it has one (see `adminOverview`); without it only these
 * accounts' cost is priced.
 */
async function accountRows(
  rows: readonly { id: string; email: string | null; isAdmin: boolean }[],
  now: Date,
  trailing?: readonly AccountCost[],
): Promise<AdminAccountRow[]> {
  const since = trailingWindowStart(now);
  const ids = rows.map((row) => row.id);
  const [costs, counts, lastActive, resolved] = await Promise.all([
    trailing ?? costPerAccount(since, ids),
    requestCounts(since, ids),
    lastActiveSince(since, ids),
    Promise.all(ids.map((id) => entitlementsFor(id, now))),
  ]);
  const costByUser = new Map(costs.map((cost) => [cost.userId, cost]));
  return rows.map((row, index) =>
    accountRow(row, resolved[index]!, {
      cost: costByUser.get(row.id),
      requests: counts.get(row.id) ?? 0,
      lastActiveAt: lastActive.get(row.id) ?? null,
    }),
  );
}

/**
 * **The accounts table's six filters** (M36 link 2), by what each group means
 * — never a plan id (ADR-045 rule 4). The UI's `ACCOUNT_FILTERS` carries the
 * labels; `adminWireShape.test.ts` holds the two lists of ids identical.
 */
export const ACCOUNT_FILTER_IDS = ["all", "paying", "granted", "unentitled", "pastDue", "underwater"] as const;
export type AccountFilterId = (typeof ACCOUNT_FILTER_IDS)[number];

/** Rows a page of the accounts table — the design's eight (SPEC §18.2). */
export const ACCOUNTS_PAGE_SIZE = 8;

/** The table's view, as the URL carries it (D2). `page` is zero-based. */
export interface AccountsQuery {
  query: string;
  filter: AccountFilterId;
  page: number;
}

/** One page of the accounts table, and the six counts over the whole search. */
export interface AdminAccountsPage {
  rows: AdminAccountRow[];
  /** Every filter's size over the search — the whole matching set, not this page. */
  counts: Record<AccountFilterId, number>;
  /** The page served, zero-based: the one asked for, or the last that has rows. */
  page: number;
  pageSize: number;
  /** Which of `rows` the underwater report lists as a paying account. */
  underwater: string[];
}

/** `column in (…)`, or `false` for an empty list, which `in ()` cannot say. */
function inList(column: SQL, values: readonly string[]): SQL {
  if (values.length === 0) return sql`false`;
  return sql`${column} in (${sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  )})`;
}

/**
 * Versions sold at no charge: a subscription to one confers, and pays nothing.
 * `monthlyMicroUsd` answers 0 for exactly these, and `null` — an unpriceable
 * subscription, which still counts as paying — for a ref the file lacks.
 */
const FREE_OF_CHARGE = PLAN_VERSIONS.filter((entry) => entry.price !== null && entry.price.minor === 0).map(
  planVersionRefOf,
);

/**
 * **Plans whose live version grants nothing** — the *Free* filter, asked as
 * "does this plan grant anything" rather than "is this plan free" (ADR-045
 * rule 4, which `planVersions.fourthPlan.test.ts` enforces).
 */
function plansGrantingNothing(): PlanId[] {
  return [...new Set(PLAN_VERSIONS.map((entry) => entry.planId))].filter(
    (planId) => livePlanVersion(planId).entitlements.length === 0,
  );
}

/**
 * Every account the search matches, with one boolean per filter, as a
 * subquery. **Each boolean is the rule the row itself is drawn by**, written
 * in SQL so the counts and the page are taken over the whole set rather than
 * over rows the server already resolved:
 *
 *   * `paying` — the account's subscription (`subscriptionFor`'s pick: its
 *     newest conferring-status row, else its newest) confers right now
 *     (`standingOf`: a conferring status, and not `past_due` beyond the grace
 *     window) and is not on a version sold at no charge. That is the row's
 *     `paysMicroUsd !== 0`, unpriceable subscriptions included.
 *   * `granted` — an active grant: not revoked, not expired (`activeAt`).
 *   * `unentitled` — `users.plan_id` grants nothing, the row's held plan.
 *   * `pastDue` — Stripe says `past_due` and the window is still open; past
 *     it the row reads `lapsed`.
 *   * `underwater` — the underwater report's paying ids, handed in, so *Show
 *     them in Users* lists every account Financial counted.
 *
 * `admin.int.test.ts` builds one account per rule and holds the counts to
 * the rows the resolver draws.
 */
function accountsMatching(view: AccountsQuery, now: Date, underwater: readonly string[]): SQL {
  const needle = view.query.trim().toLowerCase();
  // `\` is ILIKE's default escape, so a `%` or `_` typed into the box is a
  // character to find rather than a wildcard.
  const pattern = `%${needle.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
  const search =
    needle === "" ? sql`true` : sql`(coalesce(u.email, '') ilike ${pattern} or u.id ilike ${pattern})`;
  const at = now.toISOString();
  const lapsed = sql`(s.status = 'past_due' and s.past_due_since is not null
    and ${at}::timestamptz > s.past_due_since + make_interval(days => ${GRACE_WINDOW_DAYS}::int))`;
  const confers = inList(sql`s.status`, CONFERRING_STATUSES);
  return sql`(
    select u.id, u.email, u.is_admin, u.created_at,
           coalesce(${confers} and not ${lapsed}
             and not ${inList(sql`(s.plan_id || '@v' || s.plan_version)`, FREE_OF_CHARGE)}, false) as paying,
           exists (select 1 from ${entitlementGrants} g
                    where g.user_id = u.id and g.revoked_at is null
                      and (g.expires_at is null or g.expires_at > ${at}::timestamptz)) as granted,
           ${inList(sql`u.plan_id`, plansGrantingNothing())} as unentitled,
           coalesce(s.status = 'past_due' and not ${lapsed}, false) as past_due,
           ${inList(sql`u.id`, underwater)} as underwater
      from ${users} u
      left join lateral (
        select s.status, s.plan_id, s.plan_version, s.past_due_since
          from ${subscriptions} s where s.user_id = u.id
         order by ${confers} desc, s.created_at desc
         limit 1
      ) s on true
     where ${search}
  )`;
}

/** The boolean column of `accountsMatching` that a filter selects on. */
const FILTER_COLUMN: Record<AccountFilterId, SQL> = {
  all: sql`true`,
  paying: sql`m.paying`,
  granted: sql`m.granted`,
  unentitled: sql`m.unentitled`,
  pastDue: sql`m.past_due`,
  underwater: sql`m.underwater`,
};

/**
 * **One page of the accounts table, for the view in the URL** (D2).
 *
 * The server pages, counts and searches, and resolves only the rows it
 * draws. It used to resolve the newest 100 accounts plus every underwater
 * payer — three resolver queries each, 310 round trips a load — and the client
 * paged and counted over them, so an account older than the newest 100 could
 * be found only if it was underwater. Now every account is reachable, and a
 * load is three queries plus the resolver for eight rows (M36 perf pass).
 *
 * Newest first, as before. A page past the end serves the last page that has
 * rows rather than an empty table under a range line that says otherwise.
 */
export async function adminAccountsPage(
  view: AccountsQuery,
  now: Date,
  trailing: readonly AccountCost[],
  underwater: readonly string[],
): Promise<AdminAccountsPage> {
  const matching = accountsMatching(view, now, underwater);
  const counted = await db.execute<Record<AccountFilterId, number>>(sql`
    select count(*)::int as "all",
           (count(*) filter (where m.paying))::int as "paying",
           (count(*) filter (where m.granted))::int as "granted",
           (count(*) filter (where m.unentitled))::int as "unentitled",
           (count(*) filter (where m.past_due))::int as "pastDue",
           (count(*) filter (where m.underwater))::int as "underwater"
      from ${matching} m
  `);
  const counts = counted.rows[0]!;
  const pageCount = Math.max(1, Math.ceil(counts[view.filter] / ACCOUNTS_PAGE_SIZE));
  const page = Math.min(Math.max(view.page, 0), pageCount - 1);
  const found = await db.execute<{ id: string; email: string | null; is_admin: boolean }>(sql`
    select m.id, m.email, m.is_admin from ${matching} m
     where ${FILTER_COLUMN[view.filter]}
     order by m.created_at desc, m.id desc
     limit ${ACCOUNTS_PAGE_SIZE} offset ${page * ACCOUNTS_PAGE_SIZE}
  `);
  const rows = await accountRows(
    found.rows.map((row) => ({ id: row.id, email: row.email, isAdmin: row.is_admin })),
    now,
    trailing,
  );
  const sinking = new Set(underwater);
  return {
    rows,
    counts,
    page,
    pageSize: ACCOUNTS_PAGE_SIZE,
    underwater: rows.filter((row) => sinking.has(row.userId)).map((row) => row.userId),
  };
}

/**
 * **One account's row, built by the same code as the table's** (M36 link 3).
 * The account page's header and facts are this row, so the page and the row it
 * was opened from cannot describe the account differently. `null` when there
 * is no such account.
 *
 * **Every read is this account's alone** — its cost, its turns, its last
 * activity. It priced every account's window and kept one, ~400 of the page's
 * ~450 ms at 20k turns (M36 perf pass); `costPerAccount` scoped is the same
 * rule over the same rows.
 */
export async function adminAccount(
  userId: string,
  now: Date = new Date(),
): Promise<{ row: AdminAccountRow; resolved: AccountEntitlements; cost: AccountCost | undefined } | null> {
  const since = trailingWindowStart(now);
  const [found, costs, counts, lastActive, resolved] = await Promise.all([
    db
      .select({ id: users.id, email: users.email, isAdmin: users.isAdmin })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1),
    costPerAccount(since, [userId]),
    requestCounts(since, [userId]),
    lastActiveSince(since, [userId]),
    entitlementsFor(userId, now),
  ]);
  const user = found[0];
  if (user === undefined) return null;
  const cost = costs.find((entry) => entry.userId === userId);
  return {
    cost,
    row: accountRow(user, resolved, {
      cost,
      requests: counts.get(userId) ?? 0,
      lastActiveAt: lastActive.get(userId) ?? null,
    }),
    resolved,
  };
}

/** One `users` row and its resolver answer, as the accounts table shows it. */
function accountRow(
  row: { id: string; email: string | null; isAdmin: boolean },
  resolved: AccountEntitlements,
  reads: { cost: AccountCost | undefined; requests: number; lastActiveAt: string | null },
): AdminAccountRow {
  // **Read off the resolver's own answer**, not re-queried. It already
  // fetched this account's subscription standing to decide what the account
  // may do, so asking again would be a second read that can disagree with
  // the gate — which is the one thing an operator console must never do.
  const subscription = resolved.subscription;
  const pays =
    subscription !== null && subscription.conferring ? monthlyMicroUsd(subscription.row) : 0;
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
    requests: reads.requests,
    microUsd: reads.cost?.microUsd ?? 0,
    unpriced: reads.cost?.unpriced ?? 0,
    paysMicroUsd: pays,
    subscriptionState: subscription?.lapsed === true ? "lapsed" : (subscription?.row.status ?? null),
    lastActiveAt: reads.lastActiveAt,
  };
}

/**
 * **The top spenders** (gate box), over the trailing window. Given the
 * overview's `trailing` read it ranks that instead of reading again — it is the
 * same list `topSpenders` would build, already sorted by cost.
 */
export async function adminTopSpenders(
  n = 10,
  now: Date = new Date(),
  trailing?: readonly AccountCost[],
): Promise<AccountCost[]> {
  return trailing ? trailing.slice(0, n) : topSpenders(trailingWindowStart(now), n);
}

/** **Cost per account over a trailing window** (gate box). */
export async function adminCostPerAccount(now: Date = new Date()): Promise<AccountCost[]> {
  return costPerAccount(trailingWindowStart(now));
}

/**
 * **What the Financial tab reads from the database**: the tier panel, the four
 * numbers and the segmented underwater list. Not the accounts table, which is
 * a resolver per row for a tab that never shows it.
 *
 * **Not the price sweep either**, though the tab draws it: the page streams
 * that panel on its own (`priceConsistencyReport` in a Suspense boundary), so
 * Stripe's round trip — up to `PRICE_CHECK_DEADLINE_MS`, 3 s — no longer holds
 * the rest of the tab (M36 perf pass).
 */
export type AdminFinancial = Pick<AdminOverview, "plans" | "windowDays" | "revenue" | "underwater">;

/**
 * **What the Users tab draws**: one page of the accounts table, and the
 * revenue summary for the stale banner.
 *
 * **No price sweep** — that is a round trip to Stripe per published version,
 * and this tab shows none of it — and no tier panel or underwater report.
 */
export interface AdminUsers {
  table: AdminAccountsPage;
  windowDays: number;
  /** Only `unpricedSubscriptions` is drawn, by the banner both tabs share. */
  revenue: RevenueSummary;
}

/** Everything the console reads, in one call — what `GET /api/admin/overview` answers. */
export interface AdminOverview {
  plans: PlanPanelRow[];
  accounts: AdminAccountRow[];
  topSpenders: AccountCost[];
  windowDays: number;
  /** M21 link 7's four numbers. */
  revenue: RevenueSummary;
  /** M21 link 7's segmented *"costs more than it pays"*. */
  underwater: UnderwaterReport;
  /**
   * **Whether each published version's Stripe Price charges what the plan file
   * says** — M21 link 2's gate box, swept across every version rather than only
   * the one being bought at the till (KI-2026-09-16-c). A read against Stripe:
   * a `missing` Price is reported, never created.
   */
  prices: PriceConsistencyReport;
}

/**
 * **One read of the trailing cost and one of the grant holders, for every
 * panel.** Each panel used to read its own — six `costPerAccount`s and two
 * `activeGrantHolders` per page — so a request logged between two of them
 * counted in some panels and not others, and the page could disagree with
 * itself (PR #234 review). Billing takes both as arguments rather than reading
 * Entitlements' tables (ADR-047's 2026-09-25 amendment).
 * `adminOverview.int.test.ts` pins one read of each.
 */
interface SharedReads {
  trailing: AccountCost[];
  holders: Awaited<ReturnType<typeof activeGrantHolders>>;
}

async function sharedReads(now: Date): Promise<SharedReads> {
  const [trailing, holders] = await Promise.all([adminCostPerAccount(now), activeGrantHolders(now)]);
  return { trailing, holders };
}

/**
 * The Financial tab, over one read of the ledger and one of the grant holders.
 * `underwater` is the overview's, when it has already built the report from
 * the same `reads` for the accounts table (see `adminOverview`).
 */
export async function adminFinancial(
  now: Date = new Date(),
  reads?: SharedReads,
  underwater?: UnderwaterReport,
): Promise<AdminFinancial> {
  const { trailing, holders } = reads ?? (await sharedReads(now));
  const [plans, revenue, report] = await Promise.all([
    planPanel(now, trailing),
    revenueSummary(TRAILING_WINDOW_DAYS, trailing, now),
    underwater ?? underwaterReport(TRAILING_WINDOW_DAYS, trailing, holders, now),
  ]);
  return { plans, windowDays: TRAILING_WINDOW_DAYS, revenue, underwater: report };
}

/**
 * The Users tab: one read of the ledger and one of the grant holders, and never
 * Stripe's price sweep. The holders are read for the underwater report alone —
 * its paying ids are the *Costs more than it pays* filter, which therefore
 * lists **every** account Financial counted, however old (M36 part 3 review),
 * a page at a time.
 */
export async function adminUsers(
  now: Date = new Date(),
  view: AccountsQuery = { query: "", filter: "all", page: 0 },
): Promise<AdminUsers> {
  const { trailing, holders } = await sharedReads(now);
  const underwater = await underwaterReport(TRAILING_WINDOW_DAYS, trailing, holders, now);
  const [table, revenue] = await Promise.all([
    adminAccountsPage(
      view,
      now,
      trailing,
      underwater.paying.map((row) => row.userId),
    ),
    revenueSummary(TRAILING_WINDOW_DAYS, trailing, now),
  ]);
  return { table, windowDays: TRAILING_WINDOW_DAYS, revenue };
}

/**
 * Every panel of the operator console, computed over one read of the ledger.
 *
 * **The underwater report first, then everything else at once**, as
 * `adminUsers` does it: the accounts table needs only the report's paying ids,
 * and taking them off `adminFinancial`'s result held the table behind Stripe's
 * price sweep — a round trip per published version (M36 part 3 review).
 */
export async function adminOverview(now: Date = new Date()): Promise<AdminOverview> {
  const reads = await sharedReads(now);
  const underwater = await underwaterReport(TRAILING_WINDOW_DAYS, reads.trailing, reads.holders, now);
  const [financial, prices, accounts, spenders] = await Promise.all([
    adminFinancial(now, reads, underwater),
    priceConsistencyReport(),
    adminAccounts(
      100,
      now,
      reads.trailing,
      underwater.paying.map((row) => row.userId),
    ),
    adminTopSpenders(10, now, reads.trailing),
  ]);
  return { ...financial, prices, accounts, topSpenders: spenders };
}
