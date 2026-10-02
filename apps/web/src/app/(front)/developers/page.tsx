import { DevelopersScreen } from "@/components/front/DevelopersScreen";
import { pageMetadata } from "@/lib/siteMetadata";

// Public on purpose: `/developers` is outside `proxy.ts`'s matcher, so a
// signed-out visitor, and the agent they are setting up, read it without an
// account. `/llms.txt` and the api-catalog's `service-doc` both lead here.
export const metadata = pageMetadata({
  title: "Developers",
  description:
    "The Caesura API: how to get invited, make an API token, and find the OpenAPI reference.",
});

/** `/developers`: the onboarding path to an API token, for a person or their agent. */
export default function DevelopersPage() {
  return <DevelopersScreen />;
}
