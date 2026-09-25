// **The revenue half of the unit economics** (M21 link 7).
//
// M20 link 9 built the cost ledger — `ai_usage`, tokens not dollars, one row
// per request. This is what it has to be compared against, and the comparison
// itself. **Both halves come from data this pair of milestones owns**: cost from
// `ai_usage`, revenue from `subscriptions`. Nothing here scrapes a log.
//
// **Micro-dollars all the way through, and never `Money`.** The console shows
// dollars derived at read time from tokens plus the dated rate table (M20 link
// 9), and `Money` in integer minor units rounds a $0.0006 request to zero —
// *"the third recurrence of the defect class, and a revenue screen is where it
// would look most like a real number"*. So revenue, which IS in whole cents, is
// converted UP into micro-dollars to meet cost rather than cost being rounded
// down to meet revenue. Formatting happens where a number is displayed.
//
// **Nothing here reads a plan as a rank.** A price is a number on a price list;
// what an account may do is `can()`. The only arithmetic is addition and a
// median.
//
// **Cost arrives as an argument; this module does not read the ledger.** The
// ledger is Entitlements' (`entitlements/usage.ts`), and ADR-047 decision 1 —
// as amended 2026-09-25 — lets Billing read exactly one thing of Entitlements,
// the plan catalog. So the caller that already holds both halves, the operator
// console in `entitlements/admin.ts`, reads the cost and hands it in. The
// active grant holders arrive the same way, for the same reason: the grant
// store is Entitlements' too (KI-2026-09-25-d).
import type { PlanId } from "@tc/contracts";
import { PLAN_VERSIONS, planVersionRefOf } from "@/server/entitlements/planVersions";
import { db } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { sql } from "drizzle-orm";
import { subscriptionsWithStatus, type SubscriptionRow } from "./subscriptions";
import { standingOf } from "./standing";

/**
 * What one account cost over the trailing window, in micro-dollars.
 *
 * The fields of Entitlements' `AccountCost` that this module reads, declared
 * here so Billing names no Entitlements type; `AccountCost` satisfies it
 * structurally. `unpriced` counts rows whose model has no published rate, so
 * `microUsd` understates whenever it is non-zero.
 */
export interface TrailingCost {
  userId: string;
  microUsd: number;
  unpriced: number;
}

/**
 * One active grant an account holds: which account, and the grant's source.
 *
 * Declared here so Billing names no Entitlements type; `activeGrantHolders` in
 * `entitlements/grants.ts` returns rows of this shape. An account holding two
 * grants is two rows.
 */
export interface GrantHolding {
  source: string;
  userId: string;
}

/** One cent is ten thousand micro-dollars. The only unit conversion here. */
export const MICRO_USD_PER_MINOR = 10_000;

/**
 * What one subscription is worth a month, in micro-dollars.
 *
 * **Read off the version the subscription PINS**, never off the live version —
 * that is *what you bought is what you get* (M21 link 2) showing up in the
 * revenue number. An account on `plus@v1` at $9 contributes $9 after `plus@v2`
 * is published at $12, because $9 is what it pays.
 *
 * `null` for a pinned version this deploy cannot resolve or that carries no
 * price. Not zero: a subscription we cannot price is a reporting gap, and
 * counting it as free would understate MRR silently — the same null-is-not-zero
 * rule the cost side follows for an unpriceable model.
 */
export function monthlyMicroUsd(row: SubscriptionRow): number | null {
  const ref = `${row.planId}@v${row.planVersion}`;
  const version = PLAN_VERSIONS.find((entry) => planVersionRefOf(entry) === ref);
  if (version === undefined || version.price === null) return null;
  return version.price.minor * MICRO_USD_PER_MINOR;
}

/** Everything the four-number strip reports. */
export interface RevenueSummary {
  /** Monthly recurring revenue from subscriptions conferring right now. */
  mrrMicroUsd: number;
  /**
   * The movement in it over the trailing window — what was added, what left.
   *
   * Two numbers rather than one net figure, because *"MRR is flat"* covers a
   * month that gained and lost the same amount and a month where nothing
   * happened, and those are different businesses.
   */
  addedMicroUsd: number;
  lostMicroUsd: number;
  /**
   * **ARPU reported twice and labelled** (link 7, and it is emphatic about it).
   * *"With founder, referral, trial and admin grants in the mix these differ a
   * lot, and a single unlabelled ARPU will be quoted as whichever is
   * convenient."*
   */
  arpuAllMicroUsd: number;
  arpuPayingMicroUsd: number;
  accounts: number;
  payingAccounts: number;
  /**
   * **Median margin per paying account over a TRAILING 30 DAYS, never
   * lifetime.** Cost is spiky; one heavy month is not a signal. Median rather
   * than mean for the reason the tier panel already gives: one account running
   * a batch job drags a mean far enough to make it useless.
   *
   * `null` when nobody is paying — which is every deployment until the first
   * subscription, and is not a zero.
   */
  medianMarginMicroUsd: number | null;
  /** Subscriptions whose pinned version this deploy cannot price. */
  unpricedSubscriptions: number;
  /**
   * Paying accounts left OUT of the median because their trailing cost has
   * unpriceable rows in it. Reported rather than folded in: a margin computed
   * from a partial cost is overstated, and silently dropping the account would
   * make the median look more complete than it is.
   */
  payersWithUnknownCost: number;
  windowDays: number;
}

/** One account that costs more than it pays, and why. */
export interface UnderwaterAccount {
  userId: string;
  /** What it pays a month, in micro-dollars. Zero for a grant-funded account. */
  paysMicroUsd: number;
  /** What it cost over the trailing window. */
  costMicroUsd: number;
  /** `pays - cost`, negative by definition for everything in this list. */
  marginMicroUsd: number;
}

/**
 * **The underwater list, segmented by WHY** — link 7's hardest requirement.
 *
 * *"An account on a founder, trial, referral or admin grant is underwater by
 * construction — that is a decision already taken, not a finding, and if the
 * list is not segmented those accounts will dominate it and make it useless.
 * The alert-worthy row is a paying account whose trailing marginal cost exceeds
 * what it pays."*
 *
 * So the two halves are not two filters over one list. They are different
 * questions: `paying` is a list of rows that each need a decision, and
 * `grantFunded` is a **count per source** that is set aside — deliberately not
 * enumerated, because enumerating it invites reading it as the same kind of
 * finding.
 */
export interface UnderwaterReport {
  paying: UnderwaterAccount[];
  grantFunded: { source: string; accounts: number; costMicroUsd: number }[];
  windowDays: number;
}

/**
 * **Is this account's trailing cost fully known?**
 *
 * `costPerAccount` reports `unpriced` — rows whose model has no published rate
 * — separately from `microUsd`, precisely so the two are not confused. A margin
 * computed from a partial cost is overstated, and an underwater account with
 * unpriceable usage can disappear from the report that exists to find it.
 *
 * So an account with any unpriced row is excluded from margin statistics rather
 * than being counted at a number we know is too low. That is the same
 * null-is-not-zero rule the cost side already follows, applied one level up —
 * and the same rule `costByPlan` follows for the tier medians. CodeRabbit,
 * PR #177.
 */
function costIsComplete(cost: TrailingCost | undefined): boolean {
  return cost === undefined || cost.unpriced === 0;
}

/** The middle value, or the lower of the two middles. `null` when empty. */
function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)]!;
}

/** Every subscription that is conferring its plan at this instant. */
async function conferringNow(now: Date): Promise<SubscriptionRow[]> {
  const rows = await subscriptionsWithStatus(["active", "trialing", "past_due"]);
  // **`past_due` inside its window still pays**, and past it does not. The
  // grace window is the same derivation the resolver uses; a revenue number
  // that counted a lapsed account would be counting money nobody is sending.
  return rows.filter((row) => standingOf(row, now).conferring);
}

/**
 * The four numbers, and the two counts they are per.
 *
 * `windowDays` is passed in rather than read from a constant here, so the
 * console's trailing window has one definition (`TRAILING_WINDOW_DAYS`) and
 * this module does not grow a second. `costs` must be every account's cost over
 * that same window ending at `now` — nothing here can check that, so the one
 * production caller derives both from `TRAILING_WINDOW_DAYS`.
 */
export async function revenueSummary(
  windowDays: number,
  costs: readonly TrailingCost[],
  now: Date = new Date(),
): Promise<RevenueSummary> {
  const since = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);
  const [live, everything, accountRows] = await Promise.all([
    conferringNow(now),
    subscriptionsWithStatus([
      "active",
      "trialing",
      "past_due",
      "canceled",
      "unpaid",
      "incomplete_expired",
      "paused",
    ]),
    db.select({ count: sql<number>`count(*)::int` }).from(users),
  ]);

  let mrr = 0;
  let unpriced = 0;
  const payingUsers = new Set<string>();
  const paysByUser = new Map<string, number>();
  for (const row of live) {
    const worth = monthlyMicroUsd(row);
    if (worth === null) {
      unpriced += 1;
      continue;
    }
    // **A $0 subscription is not a paying account.** Nothing sells one today,
    // and if something ever does, counting it as a payer would move ARPU
    // without moving a penny.
    if (worth === 0) continue;
    mrr += worth;
    payingUsers.add(row.userId);
    paysByUser.set(row.userId, (paysByUser.get(row.userId) ?? 0) + worth);
  }

  // **Movement, from the rows' own dates rather than from a stored history.**
  // `added` is what started inside the window and is conferring now; `lost` is
  // what stopped inside it. Both are approximations of a question a proper
  // events table would answer exactly, and the approximation is named here
  // rather than dressed up: a subscription that started AND ended inside the
  // window appears in both, which is correct for "what moved" and wrong for
  // "what is the net" — so no net is reported.
  let added = 0;
  let lost = 0;
  for (const row of everything) {
    const worth = monthlyMicroUsd(row);
    if (worth === null || worth === 0) continue;
    if (row.createdAt >= since && standingOf(row, now).conferring) added += worth;
    if (!standingOf(row, now).conferring && row.updatedAt >= since) lost += worth;
  }

  const costByUser = new Map(costs.map((cost) => [cost.userId, cost]));
  const margins: number[] = [];
  let unknownCost = 0;
  for (const [userId, pays] of paysByUser) {
    const cost = costByUser.get(userId);
    // An account whose cost is only partly priceable contributes no margin.
    // Including it would report a number we know is too generous.
    if (!costIsComplete(cost)) {
      unknownCost += 1;
      continue;
    }
    margins.push(pays - (cost?.microUsd ?? 0));
  }

  const accounts = accountRows[0]?.count ?? 0;
  return {
    mrrMicroUsd: mrr,
    addedMicroUsd: added,
    lostMicroUsd: lost,
    // **Integer division, floored, and both are micro-dollars** — dividing
    // money by a head count is where a float would start printing
    // `29.999999999999996` on a console that is meant to be read at a glance.
    arpuAllMicroUsd: accounts === 0 ? 0 : Math.floor(mrr / accounts),
    arpuPayingMicroUsd: payingUsers.size === 0 ? 0 : Math.floor(mrr / payingUsers.size),
    accounts,
    payingAccounts: payingUsers.size,
    medianMarginMicroUsd: median(margins),
    unpricedSubscriptions: unpriced,
    /** Payers whose trailing cost could not be fully priced, so they are out of the median. */
    payersWithUnknownCost: unknownCost,
    windowDays,
  };
}

/**
 * **Who costs more than they pay, and which of the two kinds they are.**
 *
 * Grant-funded accounts are counted by source and set aside; paying accounts
 * that are underwater are listed, because each of those is a row that needs a
 * decision. `costs` is the trailing window's, as for `revenueSummary`.
 * `grants` must be every grant active at `now`; the one production caller reads
 * them with `activeGrantHolders(now)`.
 */
export async function underwaterReport(
  windowDays: number,
  costs: readonly TrailingCost[],
  grants: readonly GrantHolding[],
  now: Date = new Date(),
): Promise<UnderwaterReport> {
  const live = await conferringNow(now);

  const paysByUser = new Map<string, number>();
  for (const row of live) {
    const worth = monthlyMicroUsd(row);
    if (worth !== null && worth > 0) {
      paysByUser.set(row.userId, (paysByUser.get(row.userId) ?? 0) + worth);
    }
  }
  const costOf = (cost: TrailingCost) => cost.microUsd;

  const paying: UnderwaterAccount[] = [];
  const grantedBySource = new Map<string, Set<string>>();
  for (const row of grants) {
    const set = grantedBySource.get(row.source) ?? new Set<string>();
    set.add(row.userId);
    grantedBySource.set(row.source, set);
  }
  const anyGrant = new Set([...grantedBySource.values()].flatMap((set) => [...set]));

  for (const cost of costs) {
    const pays = paysByUser.get(cost.userId) ?? 0;
    const spent = costOf(cost);
    // **An account whose cost is only partly priceable is not judged here.**
    // `microUsd` understates it, so "costs more than it pays" cannot be
    // answered — and answering it anyway would put a real underwater account
    // on the safe side of the line.
    if (!costIsComplete(cost)) continue;
    if (spent <= pays) continue;
    // **A paying account that also holds a grant is still a paying account.**
    // It is underwater on the money it actually sends, which is the question
    // this list asks — being comped as well does not make its bill a decision
    // somebody already took.
    if (pays > 0) {
      paying.push({
        userId: cost.userId,
        paysMicroUsd: pays,
        costMicroUsd: spent,
        marginMicroUsd: pays - spent,
      });
    } else if (!anyGrant.has(cost.userId)) {
      // Neither paying nor granted, and spending money: a free account using
      // the assistant it is not entitled to would be a gate defect, so this is
      // reported as its own source rather than silently dropped.
      const set = grantedBySource.get("none") ?? new Set<string>();
      set.add(cost.userId);
      grantedBySource.set("none", set);
    }
  }

  const costByUser = new Map(costs.map((cost) => [cost.userId, cost.microUsd]));
  const completeByUser = new Map(costs.map((cost) => [cost.userId, cost.unpriced === 0]));
  const grantFunded = [...grantedBySource.entries()]
    .map(([source, holders]) => {
      const underwater = [...holders].filter(
        (userId) =>
          // **Disjoint from `paying` by construction.** A grant holder who also
          // PAYS belongs in the list above — their bill is a decision that
          // needs looking at — and counting them here too would double-count
          // them and blunt the very segmentation this report exists for.
          // CodeRabbit, PR #177.
          (paysByUser.get(userId) ?? 0) === 0 &&
          (completeByUser.get(userId) ?? true) &&
          (costByUser.get(userId) ?? 0) > 0,
      );
      let costMicroUsd = 0;
      for (const userId of underwater) costMicroUsd += costByUser.get(userId) ?? 0;
      return { source, accounts: underwater.length, costMicroUsd };
    })
    .filter((row) => row.accounts > 0);

  return {
    paying: paying.sort((a, b) => a.marginMicroUsd - b.marginMicroUsd),
    grantFunded,
    windowDays,
  };
}

/** MRR and median margin for one plan — the per-tier panel's M21 half. */
export interface PlanRevenueRow {
  planId: PlanId;
  mrrMicroUsd: number;
  medianMarginMicroUsd: number | null;
}

/**
 * **The half of the tier panel this link owns.**
 *
 * M20 built accounts-per-tier, version history and hold counts; MRR and median
 * margin per tier are this link's. Split down the middle exactly as the
 * milestone says, which is why this returns two fields and not a whole row.
 * `costs` is the trailing window's, as for `revenueSummary`.
 */
export async function revenueByPlan(
  costs: readonly TrailingCost[],
  now: Date = new Date(),
): Promise<PlanRevenueRow[]> {
  const live = await conferringNow(now);
  const costByUser = new Map(costs.map((cost) => [cost.userId, cost.microUsd]));

  const byPlan = new Map<PlanId, { mrr: number; margins: number[] }>();
  for (const row of live) {
    const worth = monthlyMicroUsd(row);
    if (worth === null || worth === 0) continue;
    const bucket = byPlan.get(row.planId) ?? { mrr: 0, margins: [] };
    bucket.mrr += worth;
    bucket.margins.push(worth - (costByUser.get(row.userId) ?? 0));
    byPlan.set(row.planId, bucket);
  }

  // Every plan the file publishes, including the ones nobody pays for — a
  // panel whose rows appear and vanish with the data makes "nobody is on
  // premium" and "premium is not a plan" indistinguishable.
  const planIds = [...new Set(PLAN_VERSIONS.map((entry) => entry.planId))];
  return planIds.map((planId) => {
    const bucket = byPlan.get(planId);
    return {
      planId,
      mrrMicroUsd: bucket?.mrr ?? 0,
      medianMarginMicroUsd: bucket === undefined ? null : median(bucket.margins),
    };
  });
}
