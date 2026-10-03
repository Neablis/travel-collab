import type { MetadataRoute } from "next";
import { deploymentOrigin } from "@/lib/deploymentOrigin";
import { dayPath, placeIndexable, placePath } from "@/lib/playbookUrls";
import { publishedPlaces, sitemapDays } from "@/server/playbooks";

// Read per request, not at build: the build has no database in CI, and a day
// published an hour ago should be in the next fetch. A crawler asks for this
// file a few times a day.
export const dynamic = "force-dynamic";

/** The public routes with no data behind their URL. Profiles and the board are `noindex` (D4) and stay out. */
const STATIC_PATHS = ["/", "/playbooks", "/demo", "/developers", "/developers/reference"];

// One file: production holds 155 published days and 318 cities (2026-10-02)
// against a limit of 50,000 URLs. Past that this needs `generateSitemaps`.
/**
 * `/sitemap.xml`: the static public routes, every published, unmoderated,
 * undeleted day, and every city and country page that is indexed.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = deploymentOrigin();
  const [days, places] = await Promise.all([sitemapDays(), publishedPlaces()]);
  return [
    ...STATIC_PATHS.map((path) => ({ url: `${origin}${path}` })),
    ...days.map((day) => ({
      url: `${origin}${dayPath(day)}`,
      ...(day.publishedAt === null ? {} : { lastModified: day.publishedAt }),
    })),
    // The page's own robots predicate: a thin place page is `noindex`, and
    // listing it here would contradict that.
    ...places.filter(placeIndexable).map((place) => ({ url: `${origin}${placePath(place)}` })),
  ];
}
