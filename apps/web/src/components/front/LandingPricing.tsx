import type { Ref } from "react";
import Link from "next/link";
import { planPitch, planPrice } from "@/components/plans/PlanComparison";
import { PHONE_TOUCH, buttonVariants } from "@/components/ui/button";
import { Heading } from "@/components/ui/heading";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/cn";
import { LANDING_PLANS } from "@/lib/landingPlans";

/**
 * The front door's pricing: a card per plan with its name, its price from the
 * snapshot of the live plan file, and one line of what it is for.
 *
 * **A summary, not `/plans`' comparison table** (Mitchell, 2026-10-11,
 * overriding M42 D3's reuse of it): *"the specifics are for the actual payment
 * page and the tracking for your tier or to compare"*. The specifics are one
 * link away. Every word on a card comes from `PlanComparison.tsx`, which is
 * where `/plans` gets its own, so the two pages cannot describe a plan
 * differently.
 *
 * Shared by the desktop landing and the phone front door. The cards stack
 * below `md` and sit side by side above it, so nothing scrolls sideways.
 */
export function LandingPricing({ id, ref }: { id?: string; ref?: Ref<HTMLElement> }) {
  return (
    <section id={id} ref={ref} aria-label="Pricing" className="flex flex-col gap-4">
      <Heading level={2}>Pricing</Heading>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3" data-testid="plan-summary">
        {LANDING_PLANS.map((choice) => (
          <div key={choice.planId} className="flex flex-col gap-1.5 rounded-lg border border-hairline bg-surface p-4">
            <Text as="span" className="font-semibold text-ink">
              {choice.planId}
            </Text>
            <Text as="span" className="text-lg font-semibold text-ink">
              {planPrice(choice)}
            </Text>
            <Text as="span" variant="secondary">
              {planPitch(choice)}
            </Text>
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
