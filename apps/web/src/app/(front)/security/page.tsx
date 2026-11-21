import { JsonLd } from "@/components/JsonLd";
import { SECURITY_FAQ, SecurityScreen } from "@/components/front/SecurityScreen";
import { deploymentOrigin } from "@/lib/deploymentOrigin";
import { faqPageJsonLd, webPageJsonLd } from "@/lib/jsonLd";
import { pageMetadata } from "@/lib/siteMetadata";

// M63 static-copy PROPOSAL: the build drafts the words and Mitchell approves
// them at the gate. `absolute`, because the working title leads with the brand
// and the layout's "%s — Caesura" template would push it past 60 characters.
const TITLE = "Security at Caesura: your account, your data, your AI";
const DESCRIPTION =
  "How you sign in to Caesura, what an AI tool can do for you, how to take access back, and how to report a vulnerability.";

export const metadata = pageMetadata({
  title: { absolute: TITLE },
  description: DESCRIPTION,
  canonical: "/security",
  image: { url: "/security/opengraph-image.png", alt: "Security at Caesura. Your account, your data, your AI." },
});

// Public on purpose and static, like `/ai`: outside `proxy.ts`'s matcher,
// nothing per request, so a crawler, a CDN and a signed-out visitor all get
// the same page.
/** `/security`: what protects a Caesura account, in plain words. */
export default function SecurityPage() {
  const origin = deploymentOrigin();
  return (
    <>
      <JsonLd
        data={[
          webPageJsonLd({ origin, path: "/security", name: TITLE, description: DESCRIPTION }),
          faqPageJsonLd(SECURITY_FAQ),
        ]}
      />
      <SecurityScreen />
    </>
  );
}
