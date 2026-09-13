// **The operator console's wire shape** (M20 link 7), on the UI side of
// AGENTS.md's lint wall.
//
// Declared here rather than imported from `@/server/entitlements/admin`
// because `src/app/admin/page.tsx` is UI and may not reach into `@/server/*`.
// It is a structural mirror, and `admin.console.test.ts` asserts the two
// agree — the same trade `apiClient.ts` makes for the two refusal codes it
// duplicates as literals.
//
// **No revenue field, and that is the split.** MRR, ARPU and margin all need a
// subscription to exist and are M21 link 7's. A field for one here is where the
// strip would arrive.

export interface AdminPlanVersionView {
  planId: string;
  version: number;
  entitlements: readonly string[];
  ceilings: {
    perUserRequestsPerDay: number | null;
    perUserStepsPerDay: number | null;
    maxTier: string | null;
  };
  displayOrder: number;
  publishedAt: string;
  enabled: boolean;
}

export interface AdminPlanPanelRow {
  planId: string;
  versions: readonly AdminPlanVersionView[];
  live: AdminPlanVersionView;
  accounts: number;
}

export interface AdminAccountRow {
  userId: string;
  email: string | null;
  planVersionRef: string;
  isAdmin: boolean;
  grantSources: readonly string[];
  entitlements: readonly string[];
  requests: number;
  microUsd: number;
  unpriced: number;
}

export interface AdminAccountCost {
  userId: string;
  requests: number;
  microUsd: number;
  unpriced: number;
}

export interface AdminOverview {
  plans: AdminPlanPanelRow[];
  grantSources: Record<string, number>;
  accounts: AdminAccountRow[];
  topSpenders: AdminAccountCost[];
  windowDays: number;
}
