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
  /**
   * **What a lapse would actually take**, computed by the resolver rather than
   * inferred by the screen (CodeRabbit, PR #177).
   *
   * The account sheet needs this to say what a past-due window closing would
   * cost, and what a closed one already did. It could reach neither answer from
   * the sets it already had: the effective entitlements include what grants
   * supply, so reading them names losses that never happen, and the held plan's
   * own list is blind to grants, so it names a loss that does not occur for any
   * account whose founder grant covers the same thing — which on this
   * deployment is most of them.
   *
   * `entitlementsLostIfSubscriptionStops` is the difference of the two unions.
   * It is a LIST rather than the one boolean the sheet happens to need today,
   * because the next sentence that has to name a loss should not need another
   * wire change to do it.
   */
  losesOnLapse: readonly string[];

  available: boolean;
}

export interface AccountPlanView {
  planVersionRef: string;
  /** What that version confers now — differs from the above only after a lapse. */
  conferredVersionRef: string;
  entitlements: readonly string[];
  /**
   * **Every active grant's pinned version**, as `"<planId>@v<n>"` refs.
   *
   * Mirrors the server field of the same name. What it is FOR is the one thing
   * neither tier field above can say: that this account holds `plus` (or
   * `free`) and can nonetheless use `premium`, because an operator comped it or
   * a founder grant predates the migration. `entitlements` carries the union of
   * capabilities, but a list of capability strings is not a tier a person
   * recognises.
   *
   * Unordered. `effectiveTierRef` below is the only thing that picks one, and
   * it is rendering — see its comment for why that matters.
   */
  grantedVersionRefs: readonly string[];
  questions: AccountQuotaStanding;
  steps: AccountQuotaStanding;
  catalogue: AccountPlanChoice[];
  referralCode: string | null;
  canRefer: boolean;
  billing: AccountBillingView;
}

/**
 * **The most capable tier this account can actually use right now** — the held
 * (well, conferred) version, or a grant's, whichever sits higher.
 *
 * **This is RENDERING, and that is the only reason it may exist.** ADR-045
 * rule 4 forbids any authorisation path from ordering plans, and
 * `planVersions.noExtension.test.ts` sweeps for it. Nothing here gates
 * anything: `entitlements` remains the authority for every capability question,
 * and this decides one label.
 *
 * **The ladder is `catalogue`'s own order, not a number.** `accountPlan.ts`
 * builds it in the plan file's declaration order, and
 * `planVersions.noExtension.test.ts` pins that order to agree with the
 * presentation ladder the plan file declares — so reading the array's index is
 * the same answer without this module naming that field. Naming it, even to say
 * it is unused, is what puts a file on that test's allowlist: the sweep greps
 * raw source, comments included. `accountPlan.ts` on the server takes declaration
 * order for the same reason. Within one plan a later `version` wins, which is
 * ordinary monotonic versioning rather than an ordering over plans.
 *
 * A ref whose plan is absent from `catalogue` (a disabled plan, e.g. `studio`)
 * loses to every ref that is present, and falls back to the conferred version
 * rather than naming a tier the chooser does not offer.
 */
export function effectiveTierRef(plan: AccountPlanView): string {
  const ladder = plan.catalogue.map((choice) => choice.planId);
  const rankOf = (ref: string): [number, number] => {
    const [planId, version] = ref.split("@v");
    return [ladder.indexOf(planId ?? ""), Number(version ?? 0)];
  };
  let best = plan.conferredVersionRef;
  let bestRank = rankOf(best);
  for (const ref of plan.grantedVersionRefs) {
    const rank = rankOf(ref);
    // A plan the chooser does not offer never wins the label.
    if (rank[0] < 0) continue;
    if (rank[0] > bestRank[0] || (rank[0] === bestRank[0] && rank[1] > bestRank[1])) {
      best = ref;
      bestRank = rank;
    }
  }
  return best;
}
