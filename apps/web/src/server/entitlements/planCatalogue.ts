// **Every enabled plan as a chooser shows it**, from the committed plan file
// and nothing else.
//
// Its own module, apart from `accountPlan.ts`, so that something with no
// database can read it: the landing page's pricing section is a generated
// snapshot of this (`scripts/landing-plans.ts`), and `accountPlan.ts` imports
// the resolver and the quota counters, which reach the database client on
// load. One definition of the catalogue, two surfaces reading it — the account
// sheet and `/plans` per request, the front door at build time.
import type { PlanChoice } from "./accountPlan";
import { livePlanVersion, PLAN_VERSIONS, type PlanVersion } from "./planVersions";

function choiceOf(version: PlanVersion, heldPlanId: string | null): PlanChoice {
  return {
    planId: version.planId,
    version: version.version,
    entitlements: version.entitlements,
    perUserRequestsPerDay: version.ceilings.perUserRequestsPerDay,
    perUserStepsPerDay: version.ceilings.perUserStepsPerDay,
    held: version.planId === heldPlanId,
    priceMinor: version.price?.minor ?? null,
    currency: version.price?.currency ?? null,
  };
}

/**
 * Each plan's live version, enabled ones only, with `held` marking
 * `heldPlanId`'s — `null` for a reader who holds nothing, such as a visitor.
 *
 * **In the plan file's own declaration order, and the presentation ladder is
 * deliberately not read here.**
 *
 * `planVersions.noExtension.test.ts` allows that sort field to be named only
 * by the plan file itself and by RENDERING — *"a GATE joining this list is the
 * failure this test exists to catch"*. The account sheet's caller resolves
 * entitlements, so it is exactly the kind of module that rule is pointed at,
 * even though ordering a chooser is a presentation use. It caught the first
 * version of this line in CI, and then caught the comment explaining the fix:
 * that check greps RAW source, so merely spelling the field's name here — even
 * to say it is not used — puts this file back on the list.
 *
 * Declaration order answers the same question without touching the ladder, and
 * the two are pinned to agree by an assertion inside that same (allowlisted)
 * test, so a future edit that reorders the plans without moving their sort
 * values fails loudly instead of quietly reordering a chooser.
 */
export function planCatalogue(heldPlanId: string | null): PlanChoice[] {
  return [...new Set(PLAN_VERSIONS.map((entry) => entry.planId))]
    .map((planId) => livePlanVersion(planId))
    .filter((version) => version.enabled)
    .map((version) => choiceOf(version, heldPlanId));
}
