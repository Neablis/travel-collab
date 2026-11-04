import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Heading } from "@/components/ui/heading";
import { Text } from "@/components/ui/text";
import { NEW_TRIP_PATH } from "@/lib/homePath";
import { cn } from "@/lib/cn";

// `ref` is a source, not a person (ADR-079, ADR-088 §7): a publisher's own
// referral code would tie the page to a name. `callbackUrl` is where sign-up
// lands, New trip, so the visitor starts a trip of their own and is never put
// in the one they were reading.
const SIGNUP_HREF = `/signup?ref=public-notebook&callbackUrl=${encodeURIComponent(NEW_TRIP_PATH)}`;

/**
 * The band at the foot of every page a stranger can read (`/n/`, `/s/`,
 * `/demo/<slug>`): one invitation, one way in, and nothing that joins the trip
 * above it (M58 decision 7). Words await Mitchell's approval on the preview.
 */
export function PublicCta() {
  return (
    <section aria-labelledby="public-cta-heading" className="mt-10 flex flex-col items-start gap-3 rounded-md bg-moss px-7 py-8">
      <Heading level={2} id="public-cta-heading">
        Plan your own trip with Caesura
      </Heading>
      <Text variant="secondary">Lay out the days, drop in the stops, and plan it with the people you are going with.</Text>
      <Link href={SIGNUP_HREF} className={cn(buttonVariants({ variant: "primary" }), "no-underline")}>
        Start planning — free
      </Link>
    </section>
  );
}
