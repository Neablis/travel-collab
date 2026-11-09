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
/**
 * Paths a crawler is asked to leave alone besides `/api/`. Each is a page that
 * is rendered per request and is never indexed, so a crawl of it bought
 * nothing and cost Active CPU (2026-11-06, the free team past 270% of its
 * hours): profiles and the board are `noindex` and out of the sitemap (M42
 * D4), and a URL carrying `from=` is a back link's copy of a page whose own
 * URL is in the sitemap. `*` is honoured by Google and Bing (RFC 9309 leaves
 * it to them).
 */
export const CRAWL_SKIPPED = ["/playbooks/profile/", "/playbooks/board", "/*?*from="] as const;

// Read per request, like the sitemap: a static robots.txt is written by `next
// build`, and a build that was not given PUBLIC_ORIGIN froze
// `Sitemap: http://localhost:3001/sitemap.xml` into production (Coolify,
// 2026-11-09). The running server always has it. A crawler asks for this file a
// few times a day, so rendering it costs nothing worth caching.
export const dynamic = "force-dynamic";

/** `/robots.txt`: everything allowed except `/api/` (bar the public Playbooks cards) and `CRAWL_SKIPPED`, and where the sitemap is. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: ["/", "/api/og/playbooks"], disallow: ["/api/", ...CRAWL_SKIPPED] },
    sitemap: `${deploymentOrigin()}/sitemap.xml`,
  };
}
