import type { ReactNode, Ref } from "react";
import { PlanComparison } from "@/components/plans/PlanComparison";
import { Heading } from "@/components/ui/heading";
import { LANDING_PLANS } from "@/lib/landingPlans";

/**
 * The front door's pricing: `/plans`' own comparison table over the snapshot
 * of the live plan file, and no words of its own (M42 D3).
 *
 * Shared by the desktop landing and the phone front door; `children` is where
 * each puts the call to action that suits where the section sits on its page.
 */
export function LandingPricing({ id, ref, children }: { id?: string; ref?: Ref<HTMLElement>; children?: ReactNode }) {
  return (
    <section id={id} ref={ref} aria-label="Pricing" className="flex flex-col gap-4">
      <Heading level={2}>Pricing</Heading>
      <PlanComparison catalogue={LANDING_PLANS} />
      {children}
    </section>
  );
}
