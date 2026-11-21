import { DevelopersScreen } from "@/components/front/DevelopersScreen";
import { JsonLd } from "@/components/JsonLd";
import { TOOL_SCOPES } from "@/app/api/mcp/tools";
import { deploymentOrigin } from "@/lib/deploymentOrigin";
import { webPageJsonLd } from "@/lib/jsonLd";
import { pageMetadata } from "@/lib/siteMetadata";

// Public on purpose: `/developers` is outside `proxy.ts`'s matcher, so a
// signed-out visitor, and the agent they are setting up, read it without an
// account. `/llms.txt` and the api-catalog's `service-doc` both lead here.
// M53 static-copy PROPOSAL (decision 5): the build proposes the words and
// Mitchell approves them before merge, so this is a proposal, not approved
// copy. The canonical (with its matching og:url) is new here: the page had
// neither, which the M53 audit flagged.
const TITLE = "Build on Caesura: the trip planning API";
const DESCRIPTION =
  "The Caesura API, from your first token to your first trip: sign up, make an API token, and read the OpenAPI reference.";

export const metadata = pageMetadata({
  title: TITLE,
  description: DESCRIPTION,
  canonical: "/developers",
});

/** `/developers`: the onboarding path to an API token, for a person or their agent. */
export default function DevelopersPage() {
  return (
    <>
      <JsonLd data={webPageJsonLd({ origin: deploymentOrigin(), path: "/developers", name: TITLE, description: DESCRIPTION })} />
      <DevelopersScreen tools={TOOL_SCOPES} />
    </>
  );
}
