// **The account sheet's plan wire shape**, on the UI side of AGENTS.md's lint
// wall — the same arrangement `lib/adminOverview.ts` documents, and for the
// same reason: `components/account/**` is UI and may not import `@/server/*`.
//
// `accountPlan.wireShape.test.ts` pins these against the server's with a
// compile-time type-identity check, so a field that changes type or nullability
// fails to build rather than failing in a browser.
//
// **No price, no renewal date, no subscription state** — M20 never learns what
// a plan costs (link 7's split note). A field for one here is where the M21
// half would arrive.

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
}

export interface AccountPlanView {
  planVersionRef: string;
  entitlements: readonly string[];
  questions: AccountQuotaStanding;
  steps: AccountQuotaStanding;
  catalogue: AccountPlanChoice[];
  referralCode: string | null;
}
