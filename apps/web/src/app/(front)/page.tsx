import { JsonLd } from "@/components/JsonLd";
import { LandingScreen } from "@/components/front/LandingScreen";
import { deploymentOrigin } from "@/lib/deploymentOrigin";
import { organizationJsonLd, webSiteJsonLd } from "@/lib/jsonLd";
import { SITE_DESCRIPTION, pageMetadata } from "@/lib/siteMetadata";

// `absolute`: the landing page leads with the brand, so the layout's
// "%s — Caesura" template would double it.
export const metadata = pageMetadata({
  title: { absolute: "Caesura — plan the trip together" },
  description: SITE_DESCRIPTION,
  canonical: "/",
});

// ADR-078: this page is static — no `cookies()`, no `headers()`, nothing
// per request — so a CDN, a browser and the back-forward cache can all keep
// it. A signed-in visitor is sent on to Home by the root layout's inline
// script (`LEAVE_LANDING_IF_SIGNED_IN`), never by a server check here.
/** `/`: the landing page and the indexed homepage, the same for every visitor. */
export default function LandingPage() {
  const origin = deploymentOrigin();
  return (
    <>
      <JsonLd data={[organizationJsonLd(origin), webSiteJsonLd(origin)]} />
      <LandingScreen />
    </>
  );
}
