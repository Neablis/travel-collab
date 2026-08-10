"use client";

import type { VariantProps } from "class-variance-authority";
import { Button, type buttonVariants } from "@/components/ui/button";
import { Preview } from "@/components/ui/preview";

// Handoff §1 "Next-trip hero" (secondary Share, next to "Open plan") and §2
// trip header action cluster (ghost Share) both need the same inert Share
// control — one component, `variant` set per call site. Self-wrapped in its
// own <Preview id="share-button"> (Task 3's seam) so neither NextTripHero
// nor TripHeader has to repeat the wrap at two different call sites.
// Deliberately no onClick: producing/copying a real share link is M11's job.
export function ShareButton({
  variant = "ghost",
}: {
  variant?: VariantProps<typeof buttonVariants>["variant"];
}) {
  return (
    <Preview id="share-button">
      <Button type="button" variant={variant}>
        Share
      </Button>
    </Preview>
  );
}
