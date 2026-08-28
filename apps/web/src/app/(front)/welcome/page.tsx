import { LandingScreen } from "@/components/front/LandingScreen";
import { SITE_DESCRIPTION, pageMetadata } from "@/lib/siteMetadata";

// `absolute`: the landing page leads with the brand, so the layout's
// "%s — Caesura" template would double it.
export const metadata = pageMetadata({
  title: { absolute: "Caesura — plan the trip together" },
  description: SITE_DESCRIPTION,
});

export default function WelcomePage() {
  return <LandingScreen />;
}
