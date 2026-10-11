import { DemoPicker } from "@/components/demo/DemoPicker";
import { DEMO_TRIP_CARDS } from "@/lib/demoTripCards";
import { pageMetadata } from "@/lib/siteMetadata";

export const metadata = pageMetadata({
  title: "Example trips",
  description: "Look around real trips on Caesura: every day, stop, cost and map, read-only and with no account.",
  canonical: "/demo",
});

// Under `(front)`, not `(app)`: this is a page for people who have no account,
// so it draws the front door's chrome rather than the signed-in shell. It is
// also deliberately absent from `middleware.ts`'s matcher, and so is every
// `/demo/<slug>` below it — matching them would bounce every visitor to
// /signin, which is precisely what they exist to avoid.
/** `/demo`: the picker of example trips, from the committed cards. */
export default function DemoPickerPage() {
  return <DemoPicker cards={DEMO_TRIP_CARDS} />;
}
