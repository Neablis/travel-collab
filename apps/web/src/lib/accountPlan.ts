// **The account sheet's plan wire shape**, on the UI side of AGENTS.md's lint
// wall — the same arrangement `lib/adminOverview.ts` documents, and for the
// same reason: `components/account/**` is UI and may not import `@/server/*`.
//
// `accountPlan.wireShape.test.ts` pins these against the server's with a
// compile-time type-identity check, so a field that changes type or nullability
// fails to build rather than failing in a browser.
//
// **The M21 half arrived here**, exactly where M20's version of this comment
// said it would: a price on each choice, and a `billing` record carrying the
// state, the renewal date and the two dates the past-due copy names.

/** One policy's standing: what is used today, and the cap that version sold. */
export interface AccountQuotaStanding {
  used: number;
  limit: number;
}

/** One plan as the chooser shows it. */
export interface AccountPlanChoice {
  planId: string;
  version: number;
  entitlements: readonly string[];
  perUserRequestsPerDay: number | null;
  perUserStepsPerDay: number | null;
  held: boolean;
  /**
   * Integer minor units, or `null` for a plan that is not sold.
   *
   * **Presentation only.** The comparison table on `plans` is the one place
   * these sit beside each other, and the only comparison on that page is the
   * one the reader makes — nothing in code may read $19 > $9 as `premium` ⊇
   * `plus` (M21's *Prerequisites*).
   */
  priceMinor: number | null;
  currency: string | null;
}

/** Mirrors `PlanState` (`@/server/entitlements/accountPlan`). */
export type AccountPlanState = "none" | "trial" | "active" | "cancelling" | "past-due" | "lapsed";

/** Mirrors `PlanBillingView`. */
export interface AccountBillingView {
  state: AccountPlanState;
  renewsAt: string | null;
  pastDueSince: string | null;
  graceEndsAt: string | null;
  /** ISO. When a free week ends — the only end date a trial has. */
  trialEndsAt: string | null;
  available: boolean;
}

export interface AccountPlanView {
  planVersionRef: string;
  /** What that version confers now — differs from the above only after a lapse. */
  conferredVersionRef: string;
  entitlements: readonly string[];
  questions: AccountQuotaStanding;
  steps: AccountQuotaStanding;
  catalogue: AccountPlanChoice[];
  referralCode: string | null;
  canRefer: boolean;
  billing: AccountBillingView;
}
