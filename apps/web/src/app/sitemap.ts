import type { MetadataRoute } from "next";
import { deploymentOrigin } from "@/lib/deploymentOrigin";
import { dayPath } from "@/lib/playbookUrls";
import { sitemapDays } from "@/server/playbooks";

// Read per request, not at build: the build has no database in CI, and a day
// published an hour ago should be in the next fetch. A crawler asks for this
// file a few times a day.
export const dynamic = "force-dynamic";

/** The public routes with no data behind their URL. Profiles and the board are `noindex` (D4) and stay out. */
const STATIC_PATHS = ["/", "/playbooks", "/demo", "/developers", "/developers/reference"];

// One file: production holds 155 published days (2026-10-02) against a limit
// of 50,000 URLs. Past that this needs `generateSitemaps`.
/** `/sitemap.xml`: the static public routes and every published, unmoderated, undeleted day. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = deploymentOrigin();
  const days = await sitemapDays();
  return [
    ...STATIC_PATHS.map((path) => ({ url: `${origin}${path}` })),
    ...days.map((day) => ({
      url: `${origin}${dayPath(day)}`,
      ...(day.publishedAt === null ? {} : { lastModified: day.publishedAt }),
    })),
  ];
}
