import { dayPath, placePagePath } from "./playbookUrls";
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
  /**
   * The breadcrumb's country crumb, when the day's first city sits in exactly
   * one country in the published lattice: the country → city → day chain.
   * Absent when the city is in no country page or in several, and the trail
   * then runs Playbooks → city → day as before, rather than guessing.
   */
  country?: { name: string; path: string };
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
    ...(input.country === undefined ? [] : [input.country]),
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

/**
 * One crumb of a page's visible trail: its name, and the page's own path —
 * page-aware on a paginated page, so the trail ends where the visitor is,
 * not where page one is. The trail a list page shows and the BreadcrumbList
 * it emits are the same array, so a crawler never reads crumbs the visitor
 * cannot see. The shape matches `dayJsonLd`'s crumbs, so a list page's
 * trail and a day page's trail read as one lattice.
 */
export type BreadcrumbCrumb = {
  name: string;
  path: string;
};

/**
 * A page's BreadcrumbList, from its visible trail: each crumb at its
 * position, its item the absolute URL of the crumb's page. The last crumb is
 * the page itself, so its item is the page's own URL even though the trail
 * renders it as plain text.
 */
export function breadcrumbJsonLd(crumbs: readonly BreadcrumbCrumb[], origin: string): JsonLdNode {
  return {
    "@context": CONTEXT,
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((crumb, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: crumb.name,
      item: `${origin}${crumb.path}`,
    })),
  };
}

/**
 * A city or country page's crumb trail: Playbooks, then the place itself at
 * its own URL, page-aware so a `?page=N` trail ends at page N as the page's
 * canonical does. A city aggregates days from every country it appears in,
 * so it has no single country ancestor and none is claimed.
 */
export function placePageCrumbs(place: BreadcrumbCrumb, page: number): BreadcrumbCrumb[] {
  return [
    { name: "Playbooks", path: "/playbooks" },
    { name: place.name, path: placePagePath(place.path, page) },
  ];
}

/**
 * A country×city page's crumb trail: Playbooks, through its country page,
 * to the pair itself at its own URL, page-aware as on the place pages. The
 * country crumb is the country page, not a paged one: the pair is one city's
 * days inside it, and the country page is the ancestor, not the current page.
 */
export function countryCityPageCrumbs(
  country: BreadcrumbCrumb,
  city: BreadcrumbCrumb,
  page: number,
): BreadcrumbCrumb[] {
  return [
    { name: "Playbooks", path: "/playbooks" },
    country,
    { name: city.name, path: placePagePath(city.path, page) },
  ];
}

/**
 * A tag page's crumb trail: Playbooks, through the country and city pages
 * that scope it when it has them, to the tag's label at its own URL,
 * page-aware as on the place pages. The city crumb is the page the tag is
 * scoped to — the city page, or the country×city page when a country scopes
 * it too — so the trail walks the lattice the route walks. The tag crumb
 * carries the label, never the raw key, as the heading does.
 */
export function tagPageCrumbs(
  label: string,
  city: BreadcrumbCrumb | null,
  country: BreadcrumbCrumb | null,
  path: string,
  page: number,
): BreadcrumbCrumb[] {
  return [
    { name: "Playbooks", path: "/playbooks" },
    ...(country === null ? [] : [country]),
    ...(city === null ? [] : [city]),
    { name: label, path: placePagePath(path, page) },
  ];
}

/**
 * A page's linked pages as an `ItemList` of links, the summary-page shape
 * `placeItemListJsonLd` uses for days, for a page whose list is not days:
 * `/demo`'s example trips, each by its name at its own URL. Positions count
 * from 1 on the page, as the list on that page does.
 */
export function linkItemListJsonLd(items: readonly BreadcrumbCrumb[], origin: string): JsonLdNode {
  return {
    "@context": CONTEXT,
    "@type": "ItemList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      url: `${origin}${item.path}`,
      name: item.name,
    })),
  };
}

/**
 * A city or country page's days as an `ItemList` of links, the summary-page
 * shape Google reads a list from: each `ListItem` carries only a `url` (the
 * day's canonical one) and a `name`, since the day describes itself there.
 * Positions count from 1 on every page, as the list on that page does.
 */
export function placeItemListJsonLd(days: readonly { savedDayId: string; name: string }[], origin: string): JsonLdNode {
  return {
    "@context": CONTEXT,
    "@type": "ItemList",
    itemListElement: days.map((day, i) => ({
      "@type": "ListItem",
      position: i + 1,
      url: `${origin}${dayPath(day)}`,
      name: day.name,
    })),
  };
}

/** JSON for a `<script>` body: `<` is escaped, so a day named `</script>` cannot end the element. */
export function serializeJsonLd(data: JsonLdNode | JsonLdNode[]): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
