import { SITE_DESCRIPTION, SITE_NAME } from "./siteMetadata";

// Structured data for the pages a search engine indexes (SEO pass, Part 4).
// Pure builders; the server component serialises the result into a
// `<script type="application/ld+json">`. Kept small on purpose: Google has no
// rich result for an itinerary, and the breadcrumb is the part likely to show.

const CONTEXT = "https://schema.org";

/** One JSON-LD object. */
export type JsonLdNode = Record<string, unknown>;

/** What a day's structured data is built from. Every string is one the page already shows. */
export type DayJsonLdInput = {
  origin: string;
  /** The day's canonical path. */
  path: string;
  name: string;
  description: string;
  /** The author's public name as the server resolved it (`publicAuthor().displayName`). */
  author: string;
  /** Stop titles, in order. */
  stops: readonly string[];
  /** The breadcrumb's middle crumb, when the day's first city has a page. */
  city?: { name: string; path: string };
};

/** The landing's `Organization`. */
export function organizationJsonLd(origin: string): JsonLdNode {
  return { "@context": CONTEXT, "@type": "Organization", name: SITE_NAME, url: origin, logo: `${origin}/icon.svg` };
}

/** The landing's `WebSite`. */
export function webSiteJsonLd(origin: string): JsonLdNode {
  return { "@context": CONTEXT, "@type": "WebSite", name: SITE_NAME, url: origin, description: SITE_DESCRIPTION };
}

/**
 * A shared day as a `TouristTrip` whose itinerary lists its stops, and the
 * `BreadcrumbList` above it.
 *
 * The author is `provider`: schema.org's `Trip` has no `author`. There is no
 * `aggregateRating` either: its domain is CreativeWork, Event, Organization,
 * Place, Product and Service, so a validator rejects it on a `Trip`, and Google
 * shows no review stars for one.
 */
export function dayJsonLd(input: DayJsonLdInput): JsonLdNode[] {
  const url = `${input.origin}${input.path}`;
  const trip: JsonLdNode = {
    "@context": CONTEXT,
    "@type": "TouristTrip",
    name: input.name,
    description: input.description,
    url,
    provider: { "@type": "Person", name: input.author },
    itinerary: {
      "@type": "ItemList",
      itemListElement: input.stops.map((name, i) => ({
        "@type": "ListItem",
        position: i + 1,
        item: { "@type": "TouristAttraction", name },
      })),
    },
  };
  const crumbs = [
    { name: "Playbooks", path: "/playbooks" },
    ...(input.city === undefined ? [] : [input.city]),
    { name: input.name, path: input.path },
  ];
  const breadcrumb: JsonLdNode = {
    "@context": CONTEXT,
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((crumb, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: crumb.name,
      item: `${input.origin}${crumb.path}`,
    })),
  };
  return [trip, breadcrumb];
}

/** JSON for a `<script>` body: `<` is escaped, so a day named `</script>` cannot end the element. */
export function serializeJsonLd(data: JsonLdNode | JsonLdNode[]): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
