import type { MetadataRoute } from "next";
import { deploymentOrigin } from "@/lib/deploymentOrigin";

// The same on every deployment. A preview is kept out of the index by the root
// layout's `noindex` (`siteRobots`), which a disallow here would hide: a
// disallowed URL is never fetched, so its robots meta is never read. For the
// same reason `/s/` and `/invite/` are NOT listed — they carry `noindex`, and
// naming the prefixes would advertise them.
//
// `/api/og/playbooks` is the one exception under `/api/`: it is the og:image
// every public Playbooks page names, and a crawler that honours this file
// (Twitterbot does) would otherwise draw the link with no card (CodeRabbit,
// PR #295). The longer path wins, so the token-keyed invite and referral
// cards stay out.
/** `/robots.txt`: everything allowed except `/api/` (bar the public Playbooks cards), and where the sitemap is. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: ["/", "/api/og/playbooks"], disallow: "/api/" },
    sitemap: `${deploymentOrigin()}/sitemap.xml`,
  };
}
