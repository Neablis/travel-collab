// **One account, as the operator console's account page reads it** (M36 link 3).
//
// The Entitlements half of the page: what the account holds and why, every
// grant it has ever had, its plan history, and what the assistant ledger says
// it did over the trailing window. The other half — trips, edits, notebooks —
// is `server/admin/accountDetail.ts`, because this module does not know what a
// trip is (ADR-045 rule 5; `moduleBoundary.test.ts` and dependency-cruiser's
// `entitlements-knows-no-trips`).
//
// **The ledger half is counts and sizes only** (M36 D7). `ai_usage` and its two
// child tables hold no question, answer or trip — `usage.int.test.ts` pins
// that — so there is nothing here that could carry one, and the types below
// have no field one could be put in. `accountDetail.int.test.ts` asserts the
// returned shape for exactly that reason.
import { eq, inArray, sql } from "drizzle-orm";
import type { GrantSource } from "@tc/contracts";
import { db } from "@/server/db/client";
import { aiUsage, aiUsageSteps, aiUsageToolCalls, users } from "@/server/db/schema";
import { underwaterReport } from "@/server/billing/revenue";
import { subscriptionsOf } from "@/server/billing/subscriptions";
import { adminAccount, TRAILING_WINDOW_DAYS, trailingWindowStart, type AdminAccountRow } from "./admin";
import { allGrantsFor } from "./grants";
import { planVersionRefOf } from "./planVersions";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Which of the trailing window's days an instant falls on, oldest first —
 * `0` is 30 days ago, `TRAILING_WINDOW_DAYS - 1` is the last 24 hours, and
 * `null` is outside the window.
 *
 * **Trailing 24-hour buckets ending now, not calendar days.** The server does
 * not know the operator's time zone, and a calendar day in UTC would split an
 * evening in Sydney across two bars. A bucket that ends at the read is the
 * same window `trailingWindowStart` already uses for every 30-day number.
 */
export function windowDayOf(at: Date, now: Date): number | null {
  const ago = Math.floor((now.getTime() - at.getTime()) / DAY_MS);
  if (ago < 0 || ago >= TRAILING_WINDOW_DAYS) return null;
  return TRAILING_WINDOW_DAYS - 1 - ago;
}

/** Plan and grant state as one word. Ids say what the group means, never a plan id. */
export type AdminAccountState = "active" | "granted" | "pastDue" | "none";

/**
 * The header's state badge, decided from the table's own row by the table's
 * own rules (the filters `accountsMatching` in `admin.ts` writes in SQL):
 * Stripe's `past_due` first, then paying (`paysMicroUsd !== 0`, so an
 * unpriceable subscription still pays), then holding a grant, then nothing.
 */
export function accountState(row: AdminAccountRow): AdminAccountState {
  if (row.subscriptionState === "past_due") return "pastDue";
  if (row.paysMicroUsd !== 0) return "active";
  if (row.grants.length > 0) return "granted";
  return "none";
}

/**
 * One grant row, whatever became of it. **Revoked and expired rows are here
 * too** — nothing sweeps `entitlement_grants` (M20), and the history below is
 * built from them.
 */
export interface AdminAccountGrantRecord {
  id: string;
  source: GrantSource;
  planVersionRef: string;
  /** The operator's address (or id) when a person issued it; `null` for trial and referral. */
  grantedBy: string | null;
  createdAt: string;
  /** ISO, or `null` for permanent. */
  expiresAt: string | null;
  revokedAt: string | null;
  revokedBy: string | null;
  /** Not revoked and not expired, as at the read — a card with a Revoke button. */
  active: boolean;
}

/** One line of plan history: when, and what happened, as a sentence. */
export interface AdminAccountMoment {
  at: string;
  what: string;
}

/** The plan half of the account page. */
export interface AdminAccountPlan {
  account: AdminAccountRow;
  state: AdminAccountState;
  /**
   * In the paying-underwater set — the same `underwaterReport` rows Financial
   * counts and the table's *Costs more than it pays* filter shows.
   */
  underwater: boolean;
  joinedAt: string;
  /** Every grant row, newest first. */
  grants: AdminAccountGrantRecord[];
  /** Signed up, bought, cancelled, granted, ran out, revoked — newest first. */
  history: AdminAccountMoment[];
  /**
   * What the account holds with no grant at all: its held plan, or what a
   * lapsed subscription leaves it on — the resolver's `conferred`. Revoke's
   * confirm names it rather than assuming a plan.
   */
  fallsBackTo: string;
  /**
   * Does the account hold any `ai.*` right now. Read off the resolver's set,
   * never the plan id (ADR-045 rule 4): a grant of `plus` on a `free` account
   * offers the assistant, and a fourth plan would need no case here.
   */
  offersAssistant: boolean;
  /**
   * The daily request ceiling in force — the most generous among the held
   * plan and every active grant, as the quota applies it. `null` means no
   * contributing version names one, and the deployment default stands.
   */
  requestsPerDay: number | null;
}

/** A plan version reference as a person reads it: `plus@v2` → `plus v2`. */
const spoken = (ref: string) => ref.replace("@", " ");

/** The account's plan, grants and history, or `null` when there is no such account. */
export async function adminAccountPlan(
  userId: string,
  now: Date = new Date(),
): Promise<AdminAccountPlan | null> {
  const read = await adminAccount(userId, now);
  if (read === null) return null;
  const { row, resolved, cost } = read;
  const [joined, grants, subscriptions, underwater] = await Promise.all([
    db.select({ createdAt: users.createdAt }).from(users).where(eq(users.id, userId)).limit(1),
    allGrantsFor(userId),
    subscriptionsOf(userId),
    // The report's own rule over this account's own inputs, so membership is
    // decided exactly as Financial decides it — not a second opinion.
    underwaterReport(
      TRAILING_WINDOW_DAYS,
      cost === undefined ? [] : [cost],
      resolved.grants.map((grant) => ({ source: grant.source, userId })),
      now,
    ),
  ]);

  // Who issued and revoked, by address — an id is what the row stores and not
  // what an operator recognises.
  const actorIds = [
    ...new Set(grants.flatMap((grant) => [grant.grantedBy, grant.revokedBy]).filter((id) => id !== null)),
  ];
  const actors =
    actorIds.length === 0
      ? new Map<string, string>()
      : new Map(
          (
            await db.select({ id: users.id, email: users.email }).from(users).where(inArray(users.id, actorIds))
          ).map((actor) => [actor.id, actor.email ?? actor.id]),
        );
  const who = (id: string | null) => (id === null ? null : (actors.get(id) ?? id));

  const records: AdminAccountGrantRecord[] = grants
    .map((grant) => ({
      id: grant.id,
      source: grant.source,
      planVersionRef: `${grant.planId}@v${grant.planVersion}`,
      grantedBy: who(grant.grantedBy),
      createdAt: grant.createdAt.toISOString(),
      expiresAt: grant.expiresAt?.toISOString() ?? null,
      revokedAt: grant.revokedAt?.toISOString() ?? null,
      revokedBy: who(grant.revokedBy),
      active: grant.revokedAt === null && (grant.expiresAt === null || grant.expiresAt > now),
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  // `users.created_at` is a string-mode column, in Postgres's own format.
  const joinedAt = new Date(joined[0]?.createdAt ?? now).toISOString();
  const history: AdminAccountMoment[] = [{ at: joinedAt, what: "Signed up" }];
  for (const grant of records) {
    const plan = spoken(grant.planVersionRef);
    const by = grant.grantedBy === null ? "" : ` by ${grant.grantedBy}`;
    history.push({ at: grant.createdAt, what: `Granted ${plan} — ${grant.source}${by}` });
    if (grant.revokedAt !== null) {
      const revoker = grant.revokedBy === null ? "" : ` by ${grant.revokedBy}`;
      history.push({ at: grant.revokedAt, what: `Revoked the ${grant.source} grant of ${plan}${revoker}` });
    } else if (grant.expiresAt !== null && !grant.active) {
      history.push({ at: grant.expiresAt, what: `The ${grant.source} grant of ${plan} ran out` });
    }
  }
  // **From the account's subscription rows, not `billing_events`.** That table
  // is keyed by Stripe event and carries no account, so reading it per account
  // would mean parsing payloads. `updated_at` is when the newest Stripe event
  // was applied, which for a cancelled row is the cancellation.
  for (const subscription of subscriptions) {
    const plan = spoken(`${subscription.planId}@v${subscription.planVersion}`);
    history.push({ at: subscription.createdAt.toISOString(), what: `Bought ${plan}` });
    if (subscription.status === "canceled") {
      history.push({ at: subscription.updatedAt.toISOString(), what: `Cancelled ${plan}` });
    }
  }
  history.sort((a, b) => b.at.localeCompare(a.at));

  return {
    account: row,
    state: accountState(row),
    underwater: underwater.paying.some((entry) => entry.userId === userId),
    joinedAt,
    grants: records,
    history,
    fallsBackTo: planVersionRefOf(resolved.conferred),
    offersAssistant: [...resolved.entitlements].some((entitlement) => entitlement.startsWith("ai.")),
    requestsPerDay: resolved.ceilings.perUserRequestsPerDay,
  };
}

/** One assistant turn — what it cost, never what it said. */
export interface AdminAccountTurn {
  at: string;
  /** From `task_class`: a `question` answers, everything else proposes a change. */
  kind: "question" | "change";
  model: string;
  steps: number;
  toolCalls: number;
  /** The largest `tokens_in` of any step; `null` when no step reported one. */
  peakContext: number | null;
  latencyMs: number | null;
  /** `error` is failed; `abort` is the person stopping it, which is not a failure. */
  outcome: "answered" | "proposed" | "failed" | "stopped";
}

/** The assistant half of the account page — trailing window, counts and sizes. */
export interface AdminAccountAssistant {
  /** Does the account hold any `ai.*` right now — from the resolver, never the plan id. */
  offered: boolean;
  /** The effective daily request ceiling; `null` means no version names one. */
  requestsPerDay: number | null;
  questions: number;
  steps: number;
  /** Median tool calls a turn, turns with none counted as zero. `null` with no turns. */
  medianToolCalls: number | null;
  /** `tokens_in` per step, median and 95th percentile. `null` when nothing was measured. */
  contextMedian: number | null;
  contextP95: number | null;
  failed: number;
  /** Turns per day, oldest first, `TRAILING_WINDOW_DAYS` long. */
  perDay: number[];
  /** The four tools it called most, most first. */
  topTools: { tool: string; calls: number }[];
  /** The ten most recent turns, newest first. */
  recent: AdminAccountTurn[];
}

/** The middle value, or the lower of the two middles — `admin.ts`'s rule. */
function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)]!;
}

/**
 * One account's assistant use over the trailing window.
 *
 * Three reads, each bounded by this account and the window (`ai_usage_user_created`
 * leads with both): the turns themselves with their tool-call count and peak
 * context, the per-step context percentiles, and the top tools. Steps and tool
 * calls reach the account through their turn — they carry no user id.
 */
export async function adminAccountAssistant(
  plan: Pick<AdminAccountPlan, "account" | "offersAssistant" | "requestsPerDay">,
  now: Date = new Date(),
): Promise<AdminAccountAssistant> {
  const userId = plan.account.userId;
  const from = trailingWindowStart(now).toISOString();
  const mine = sql`${aiUsage.userId} = ${userId} and ${aiUsage.createdAt} >= ${from}`;
  const [turns, context, tools] = await Promise.all([
    db.execute<{
      created_at: Date | string;
      task_class: string;
      outcome: string;
      turn_model: string;
      steps: number;
      latency_ms: number | null;
      tool_calls: number;
      peak_context: number | null;
    }>(sql`
      select ${aiUsage.createdAt} as created_at, ${aiUsage.taskClass} as task_class,
             ${aiUsage.outcome} as outcome, ${aiUsage.turnModel} as turn_model,
             ${aiUsage.steps} as steps, ${aiUsage.latencyMs} as latency_ms,
             (select count(*)::int from ${aiUsageToolCalls} c where c.turn_id = ${aiUsage.id}) as tool_calls,
             (select max(s.tokens_in)::int from ${aiUsageSteps} s where s.turn_id = ${aiUsage.id}) as peak_context
        from ${aiUsage} where ${mine}
       order by ${aiUsage.createdAt} desc
    `),
    db.execute<{ p50: number | null; p95: number | null }>(sql`
      select percentile_disc(0.5) within group (order by s.tokens_in)::int as p50,
             percentile_disc(0.95) within group (order by s.tokens_in)::int as p95
        from ${aiUsageSteps} s join ${aiUsage} on ${aiUsage.id} = s.turn_id
       where ${mine} and s.tokens_in is not null
    `),
    db.execute<{ tool: string; calls: number }>(sql`
      select c.tool as tool, count(*)::int as calls
        from ${aiUsageToolCalls} c join ${aiUsage} on ${aiUsage.id} = c.turn_id
       where ${mine}
       group by c.tool order by calls desc, c.tool asc limit 4
    `),
  ]);

  const perDay = Array.from({ length: TRAILING_WINDOW_DAYS }, () => 0);
  let steps = 0;
  let failed = 0;
  const recent: AdminAccountTurn[] = [];
  for (const turn of turns.rows) {
    const at = new Date(turn.created_at);
    const day = windowDayOf(at, now);
    if (day !== null) perDay[day]! += 1;
    steps += turn.steps;
    if (turn.outcome === "error") failed += 1;
    if (recent.length < 10) {
      const kind = turn.task_class === "question" ? "question" : "change";
      recent.push({
        at: at.toISOString(),
        kind,
        model: turn.turn_model,
        steps: turn.steps,
        toolCalls: turn.tool_calls,
        peakContext: turn.peak_context,
        latencyMs: turn.latency_ms,
        outcome:
          turn.outcome === "error"
            ? "failed"
            : turn.outcome === "abort"
              ? "stopped"
              : kind === "question"
                ? "answered"
                : "proposed",
      });
    }
  }

  return {
    offered: plan.offersAssistant,
    requestsPerDay: plan.requestsPerDay,
    questions: turns.rows.length,
    steps,
    medianToolCalls: median(turns.rows.map((turn) => turn.tool_calls)),
    contextMedian: context.rows[0]?.p50 ?? null,
    contextP95: context.rows[0]?.p95 ?? null,
    failed,
    perDay,
    topTools: tools.rows.map((row) => ({ tool: row.tool, calls: row.calls })),
    recent,
  };
}
