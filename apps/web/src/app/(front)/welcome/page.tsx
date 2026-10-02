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

export default function WelcomePage() {
  const origin = deploymentOrigin();
  return (
    <>
      <JsonLd data={[organizationJsonLd(origin), webSiteJsonLd(origin)]} />
      <LandingScreen />
    </>
  );
}
