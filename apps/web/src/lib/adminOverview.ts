// **The operator console's wire shape** (M20 link 7), on the UI side of
// AGENTS.md's lint wall.
//
// Declared here rather than imported from `@/server/entitlements/admin`
// because `src/app/admin/page.tsx` is UI and may not reach into `@/server/*`.
// It is a structural mirror, and `admin.console.test.ts` pins the two together
// with a **compile-time type-identity check** — not a comparison of field
// names, which was the first version and passed when a field changed type,
// became nullable or changed nested shape (CodeRabbit, PR #174).
//
// **These types are EXACT, not loose.** They were `string` where the server has
// `PlanId`, and `readonly string[]` where it has `readonly Entitlement[]` —
// which is the drift that check exists to refuse. `@tc/contracts` is importable
// from UI (the wall covers `@/server/*` and `@tc/domain`, not contracts), so
// there is no reason to widen anything.
//
// **The revenue half landed with M21 link 7.** MRR, ARPU twice and labelled,
// the trailing-30-day median margin, and the underwater report segmented by
// grant source are all below. What M20's version of this comment was protecting
// was the SPLIT, not the silence: the console shipped without them because they
// need a subscription to exist, and `admin.console.test.ts` held that line until
// the milestone that builds one arrived. It has.
//
// **Every number here is an integer count of micro-dollars.** Never `Money`,
// which in minor units rounds a $0.0006 request to zero — the defect class M20
// link 9 names, and a revenue screen is where it would look most like a real
// number. Formatting happens where a number is displayed.
import type { Entitlement, PlanId } from "@tc/contracts";

/**
 * Mirrors `EntitlementCeilings` (`@/server/assistant/entitlements`).
 *
 * `maxTier`'s union is written out rather than imported: `ModelTier` lives in
 * the assistant kernel, behind the wall. Three literals are a smaller cost than
 * a `string` that lets a typo through, and the identity check is what keeps
 * this copy honest.
 */
export interface AdminCeilingsView {
  perUserRequestsPerDay: number | null;
  perUserStepsPerDay: number | null;
  maxTier: "cheap" | "mid" | "strong" | null;
}

/**
 * Mirrors `PlanPrice` (`@/server/entitlements/planVersions`) — M21 link 2.
 *
 * `null` on the version above means *not sold for money*, which is a different
 * fact from a zero amount. The distinction is the plan file's and is preserved
 * across the wall rather than flattened here.
 */
export interface AdminPlanPriceView {
  minor: number;
  currency: "usd";
  stripePriceId: string | null;
}

/** Mirrors `PlanVersion` (`@/server/entitlements/planVersions`). */
export interface AdminPlanVersionView {
  planId: PlanId;
  version: number;
  entitlements: readonly Entitlement[];
  ceilings: AdminCeilingsView;
  price: AdminPlanPriceView | null;
  displayOrder: number;
  publishedAt: string;
  enabled: boolean;
}

/** Mirrors `PlanPanelRow`. */
export interface AdminPlanPanelRow {
  planId: PlanId;
  versions: readonly AdminPlanVersionView[];
  live: AdminPlanVersionView;
  accounts: number;
  /** Holders per published version — the design's "204 hold". */
  holdsByVersion: Readonly<Record<number, number>>;
  /** Median trailing cost of holders who used the assistant; `null` if none. */
  medianMicroUsd: number | null;
  /** M21 link 7 — what this tier brings in a month, in micro-dollars. */
  mrrMicroUsd: number;
  /** M21 link 7 — median (pays − costs) among this tier's payers; `null` if none. */
  medianMarginMicroUsd: number | null;
}

/** Mirrors `GrantSourceRow`. */
export interface AdminGrantSourceRow {
  source: string;
  accounts: number;
  microUsd: number;
}

/** Mirrors `AdminGrantRow`. */
export interface AdminGrantRow {
  id: string;
  source: string;
  planVersionRef: string;
  expiresAt: string | null;
}

/** Mirrors `AdminAccountRow`. */
export interface AdminAccountRow {
  userId: string;
  email: string | null;
  planVersionRef: string;
  isAdmin: boolean;
  grantSources: readonly string[];
  grants: readonly AdminGrantRow[];
  entitlements: readonly string[];
  requests: number;
  microUsd: number;
  unpriced: number;
  /**
   * M21 link 7 — what this account pays a month, in micro-dollars.
   *
   * `null` means **conferring but unpriceable**: it has a live subscription
   * pinned to a version this deploy cannot price. Deliberately not `0`, which
   * would read as "pays nothing" and would suppress the underwater chip on
   * exactly the account whose bill nobody can account for.
   */
  paysMicroUsd: number | null;
  /** Stripe's own word, `"lapsed"`, or `null` for an account that never paid. */
  subscriptionState: string | null;
}

/** Mirrors `AccountCost` (`@/server/entitlements/usage`). */
export interface AdminAccountCost {
  userId: string;
  requests: number;
  microUsd: number;
  unpriced: number;
}

/** Mirrors `RevenueSummary` (`@/server/billing/revenue`) — the four numbers. */
export interface AdminRevenueView {
  mrrMicroUsd: number;
  /** The movement, as two numbers — "MRR is flat" hides a month that churned. */
  addedMicroUsd: number;
  lostMicroUsd: number;
  /**
   * **Twice, and labelled.** With founder, referral, trial and admin grants in
   * the mix these differ a lot, and a single unlabelled ARPU will be quoted as
   * whichever is convenient.
   */
  arpuAllMicroUsd: number;
  arpuPayingMicroUsd: number;
  accounts: number;
  payingAccounts: number;
  /** Trailing 30 days, never lifetime. `null` when nobody is paying. */
  medianMarginMicroUsd: number | null;
  unpricedSubscriptions: number;
  /** Payers left out of the median because their trailing cost is incomplete. */
  payersWithUnknownCost: number;
  windowDays: number;
}

/** Mirrors `UnderwaterAccount`. */
export interface AdminUnderwaterAccount {
  userId: string;
  paysMicroUsd: number;
  costMicroUsd: number;
  marginMicroUsd: number;
}

/**
 * Mirrors `UnderwaterReport` — **segmented in the layout, not just in the
 * query** (M21 link 7).
 *
 * `paying` is a list of rows that each need a decision. `grantFunded` is a
 * count per source that is set aside and deliberately NOT enumerated: a comped
 * account is underwater by construction, that is a decision already taken, and
 * listing them beside the others invites reading them as the same kind of
 * finding.
 */
export interface AdminUnderwaterView {
  paying: AdminUnderwaterAccount[];
  grantFunded: { source: string; accounts: number; costMicroUsd: number }[];
  windowDays: number;
}

/**
 * Mirrors `PriceCheckRow` (`@/server/billing/prices`) — one published version,
 * the plan file's price beside Stripe's. `minor` here is the plan file's own
 * cents, not a micro-dollar count: it is what the version says it charges.
 */
export interface AdminPriceCheckRow {
  ref: string;
  committed: { minor: number; currency: string } | null;
  stripe: { id: string; minor: number | null; currency: string } | null;
  verdict: "ok" | "missing" | "mismatch" | "unpriced";
}

/**
 * Mirrors `PriceConsistencyReport` — M21 link 2's gate box, as the console
 * reads it (KI-2026-09-16-c). Not an array, so "never asked" cannot look like
 * "nothing disagrees".
 */
export type AdminPriceConsistencyView =
  | { status: "checked"; rows: AdminPriceCheckRow[] }
  | { status: "unconfigured" }
  | { status: "unavailable"; reason: string };

export interface AdminOverview {
  plans: AdminPlanPanelRow[];
  grantSources: AdminGrantSourceRow[];
  accounts: AdminAccountRow[];
  topSpenders: AdminAccountCost[];
  windowDays: number;
  revenue: AdminRevenueView;
  underwater: AdminUnderwaterView;
  prices: AdminPriceConsistencyView;
}
