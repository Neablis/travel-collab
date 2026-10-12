import type { MetadataRoute } from "next";
import { DEMO_TRIPS, demoPath } from "@/lib/demoTrip";
import { deploymentOrigin } from "@/lib/deploymentOrigin";
import { dayPath, placeIndexable, placePath, tagPath } from "@/lib/playbookUrls";
import { publishedPlaces, publishedTagPages, sitemapDays } from "@/server/publicLibrary";

// Read per request, not at build: the build has no database in CI. The reads
// are cached for a day and cleared by a publish or an unpublish (ADR-063), so
// a day published an hour ago is still in the next fetch. A crawler asks for
// this file a few times a day.
export const dynamic = "force-dynamic";

/**
 * The public routes with no database behind their URL, each demo trip among
 * them (M42 D1). Profiles and the board are `noindex` (D4) and stay out.
 */
const STATIC_PATHS = [
  "/",
  "/playbooks",
  "/demo",
  ...DEMO_TRIPS.map(({ slug }) => demoPath(slug)),
  "/developers",
  "/developers/reference",
];

// One file: production holds 155 published days and 318 cities (2026-10-02)
// against a limit of 50,000 URLs. Past that this needs `generateSitemaps`.
/**
 * `/sitemap.xml`: the static public routes, every published, unmoderated,
 * undeleted day, and every city, country and tag page that is indexed.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = deploymentOrigin();
  const [days, places, tags] = await Promise.all([sitemapDays(), publishedPlaces(), publishedTagPages()]);
  return [
    ...STATIC_PATHS.map((path) => ({ url: `${origin}${path}` })),
    ...days.map((day) => ({
      url: `${origin}${dayPath(day)}`,
      ...(day.publishedAt === null ? {} : { lastModified: day.publishedAt }),
    })),
    // The page's own robots predicate: a thin place page is `noindex`, and
    // listing it here would contradict that.
    ...places.filter(placeIndexable).map((place) => ({ url: `${origin}${placePath(place)}` })),
    // The same predicate over the same count, for the tag pages' robots tag (M42 D10).
    ...tags
      .filter(placeIndexable)
      .map((page) => ({ url: `${origin}${tagPath(page.tag, page.city?.slug ?? null)}` })),
  ];
}
