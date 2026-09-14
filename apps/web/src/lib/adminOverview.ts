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
// **The split, as it stands mid-M21.** MRR, ARPU and margin need a subscription
// to exist and are M21 link 7's; no field for one is here yet, and
// `admin.console.test.ts` still refuses their vocabulary. What DID arrive is
// `AdminPlanPriceView` below — M21 link 2 puts a price on the plan-version
// record itself, and this file mirrors that record field for field under a
// compile-time identity check, so the price crosses the wall the moment it is
// published rather than when a screen wants it.
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
}

/** Mirrors `AccountCost` (`@/server/entitlements/usage`). */
export interface AdminAccountCost {
  userId: string;
  requests: number;
  microUsd: number;
  unpriced: number;
}

export interface AdminOverview {
  plans: AdminPlanPanelRow[];
  grantSources: AdminGrantSourceRow[];
  accounts: AdminAccountRow[];
  topSpenders: AdminAccountCost[];
  windowDays: number;
}
