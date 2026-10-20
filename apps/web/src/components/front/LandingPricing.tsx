import type { Ref } from "react";
import Link from "next/link";
import { planPrice } from "@/components/plans/PlanComparison";
import { PHONE_TOUCH, buttonVariants } from "@/components/ui/button";
import { Heading } from "@/components/ui/heading";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/cn";
import type { AccountPlanChoice } from "@/lib/accountPlan";
import { LANDING_PLANS } from "@/lib/landingPlans";

/**
 * A plan on the ladder, and the plan it is a step up from: the largest other
 * plan whose entitlements it holds, or null when it holds none.
 */
export type LadderStep = { choice: AccountPlanChoice; base: AccountPlanChoice | null };

/**
 * **The step below each plan, from the entitlement sets** (M51 decision 6). A
 * plan is a set, not a rank (M20), so "Everything in Plus" is true only while
 * Premium holds all of Plus, and the line is worked out per pair, never read
 * off the price or the order the plans arrive in: a plan that stops nesting
 * gets the step it still has (`planVersions.noExtension.test.ts`'s warning).
 */
export function ladder(plans: readonly AccountPlanChoice[]): LadderStep[] {
  const holds = (outer: AccountPlanChoice, inner: AccountPlanChoice) =>
    inner.entitlements.every((entitlement) => outer.entitlements.includes(entitlement));
  return plans.map((choice) => {
    const contained = plans.filter((other) => other !== choice && holds(choice, other) && !holds(other, choice));
    const base = contained.reduce<AccountPlanChoice | null>(
      (best, other) => (best === null || other.entitlements.length > best.entitlements.length ? other : best),
      null,
    );
    return { choice, base };
  });
}

// What a step adds, in decision 6's words, by the entitlement that grants it.
const ADDS: [entitlement: string, words: string][] = [
  ["ai.ask", "your personal AI trip assistant"],
  ["trip.collaborators", "bring the whole crew in; only you need it"],
];

/** Decision 6's line for the plan that holds no other: no "free" in it, which only the plan's name may say (SPEC §14). */
const FIRST_STEP = "Every trip you want, as many days as you like — and share any of it with a link.";

/** What `choice` grants that `base` does not, in words; "more" for a grant nobody has written words for. */
function adds(choice: AccountPlanChoice, base: AccountPlanChoice): string {
  const extra = choice.entitlements.filter((entitlement) => !base.entitlements.includes(entitlement));
  const words = ADDS.filter(([entitlement]) => extra.includes(entitlement)).map(([, said]) => said);
  return words.length === 0 ? "more" : words.join(", and ");
}

/**
 * The front door's pricing: a card per plan with its name, its price from the
 * snapshot of the live plan file, and its step on the ladder: *"Everything in
 * Free, and…"* (M51 decision 6). Not pedantic: the specifics are `/plans`'
 * comparison table, one link away (Mitchell, 2026-10-11: *"the specifics are
 * for the actual payment page"*).
 *
 * Shared by the desktop landing and the phone front door. The cards stack
 * below `md` and sit side by side above it, so nothing scrolls sideways. The
 * plan's name is its own element, so the copy rule's exemption for it
 * (SPEC §17.1) covers the name inside a step's line too.
 */
export function LandingPricing({ id, ref }: { id?: string; ref?: Ref<HTMLElement> }) {
  return (
    <section id={id} ref={ref} aria-label="Pricing" className="flex flex-col gap-4">
      <Heading level={2}>Pricing</Heading>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3" data-testid="plan-summary">
        {ladder(LANDING_PLANS).map(({ choice, base }) => (
          <div key={choice.planId} className="flex flex-col gap-1.5 rounded-lg border border-hairline bg-surface p-4">
            <Text as="span" className="font-semibold text-ink capitalize">
              {choice.planId}
            </Text>
            <Text as="span" className="text-lg font-semibold text-ink">
              {planPrice(choice)}
            </Text>
            {base === null ? (
              <Text as="span" variant="secondary">
                {FIRST_STEP}
              </Text>
            ) : (
              <Text as="span" variant="secondary" data-testid="plan-step">
                Everything in <span className="capitalize">{base.planId}</span>, and {adds(choice, base)}.
              </Text>
            )}
          </div>
        ))}
      </div>
      {/* `/plans` is a signed-in route: opened signed out it cannot load a
          plan and says so. Through sign-in, as the proxy sends every other
          signed-out visitor to an account route. */}
      <Link
        href={`/signin?callbackUrl=${encodeURIComponent("/plans")}`}
        className={cn(buttonVariants({ variant: "secondary", size: "sm" }), PHONE_TOUCH, "self-start no-underline")}
      >
        Compare plans
      </Link>
    </section>
  );
}
