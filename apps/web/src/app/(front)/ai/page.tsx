import { JsonLd } from "@/components/JsonLd";
import { AI_FAQ, AiScreen } from "@/components/front/AiScreen";
import { deploymentOrigin } from "@/lib/deploymentOrigin";
import { faqPageJsonLd, webPageJsonLd } from "@/lib/jsonLd";
import { pageMetadata } from "@/lib/siteMetadata";

// M63 static-copy PROPOSAL: the build drafts the words and Mitchell approves
// them at the gate. `absolute`, because the working title leads with the brand
// and the layout's "%s — Caesura" template would push it past 60 characters.
const TITLE = "Caesura: the AI trip planner for Claude and Gemini";
const DESCRIPTION =
  "Ask Claude, Gemini or another AI tool to plan in Caesura for you. You choose what it may do, and you can disconnect it any time.";

export const metadata = pageMetadata({
  title: { absolute: TITLE },
  description: DESCRIPTION,
  canonical: "/ai",
  // A fixed path under public/, not the file convention: in the (front) group Next
  // serves the convention's image at a hashed URL, and the unhashed one this tag
  // named was a 404.
  image: { url: "/og/ai.png", alt: "Caesura works with your AI. Claude, Gemini and agents." },
});

// Public on purpose and static, like `/developers`: outside `proxy.ts`'s
// matcher, nothing per request, so a crawler, a CDN and a signed-out visitor
// all get the same page.
/** `/ai`: what an AI tool can do in Caesura, in plain words. */
export default function AiPage() {
  const origin = deploymentOrigin();
  return (
    <>
      <JsonLd
        data={[
          webPageJsonLd({ origin, path: "/ai", name: TITLE, description: DESCRIPTION }),
          faqPageJsonLd(AI_FAQ),
        ]}
      />
      <AiScreen />
    </>
  );
}
