import type { MetadataRoute } from "next";
import { deploymentOrigin } from "@/lib/deploymentOrigin";

// The same on every deployment. A preview is kept out of the index by the root
// layout's `noindex` (`siteRobots`), which a disallow here would hide: a
// disallowed URL is never fetched, so its robots meta is never read. For the
// same reason `/s/` and `/invite/` are NOT listed — they carry `noindex`, and
// naming the prefixes would advertise them.
/** `/robots.txt`: everything allowed except `/api/`, and where the sitemap is. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: "/api/" },
    sitemap: `${deploymentOrigin()}/sitemap.xml`,
  };
}
