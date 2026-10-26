import { DemoPicker } from "@/components/demo/DemoPicker";
import { JsonLd } from "@/components/JsonLd";
import { DEMO_TRIP_CARDS } from "@/lib/demoTripCards";
import { demoPath } from "@/lib/demoTrip";
import { deploymentOrigin } from "@/lib/deploymentOrigin";
import { linkItemListJsonLd } from "@/lib/jsonLd";
import { pageMetadata } from "@/lib/siteMetadata";

// M53 static-copy PROPOSAL (decision 5): the build proposes the words and
// Mitchell approves them before merge, so this is a proposal, not approved copy.
export const metadata = pageMetadata({
  title: "Example trips to look around before you plan",
  description: "Look around real trips before you plan yours: every day, stop, cost and map, read-only, no account needed.",
  canonical: "/demo",
});

// Under `(front)`, not `(app)`: this is a page for people who have no account,
// so it draws the front door's chrome rather than the signed-in shell. It is
// also deliberately absent from `middleware.ts`'s matcher, and so is every
// `/demo/<slug>` below it — matching them would bounce every visitor to
// /signin, which is precisely what they exist to avoid.
/** `/demo`: the picker of example trips, from the committed cards. */
export default function DemoPickerPage() {
  return (
    <>
      {/* The trips the picker lists, as structured data: the picker's whole
          list, in the order the cards draw it. */}
      <JsonLd
        data={linkItemListJsonLd(
          DEMO_TRIP_CARDS.map((card) => ({ name: card.name, path: demoPath(card.slug) })),
          deploymentOrigin(),
        )}
      />
      <DemoPicker cards={DEMO_TRIP_CARDS} />
    </>
  );
}
