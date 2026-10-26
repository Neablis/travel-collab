import { DevelopersScreen } from "@/components/front/DevelopersScreen";
import { pageMetadata } from "@/lib/siteMetadata";

// Public on purpose: `/developers` is outside `proxy.ts`'s matcher, so a
// signed-out visitor, and the agent they are setting up, read it without an
// account. `/llms.txt` and the api-catalog's `service-doc` both lead here.
// M53 static-copy PROPOSAL (decision 5): the build proposes the words and
// Mitchell approves them before merge, so this is a proposal, not approved
// copy. The canonical (with its matching og:url) is new here: the page had
// neither, which the M53 audit flagged.
export const metadata = pageMetadata({
  title: "Build on Caesura: the trip planning API",
  description:
    "The Caesura API, from your first token to your first trip: sign up, make an API token, and read the OpenAPI reference.",
  canonical: "/developers",
});

/** `/developers`: the onboarding path to an API token, for a person or their agent. */
export default function DevelopersPage() {
  return <DevelopersScreen />;
}
