import type { ActivityTagDescribed } from "@tc/contracts";
import { TAG_LABEL } from "./activityTags";
import { countryCityPath, placePath, tagPath } from "./playbookUrls";

// The SEO lattice's navigation, as pure data: which pages sit one dimension
// above and below a page, so a crawler — and the homepage — can walk the
// lattice without the sitemap. Pure, so the server listing functions can call
// it over the cached readers they already hold; the shapes below are
// structural, so no import from `server/` is needed to pass a `TagPage` or a
// `CountryCityPage` in.
//
// Labels repeat the pages' own headings (`server/tagPage.ts`'s `wordsFor`,
// `server/placePage.ts`'s place headings): link text that disagrees with the
// page it names is a lie a crawler reads, so if a heading changes, change
// its label here too.

/** One link up or down the lattice: the target page's heading, and its path. */
export type LatticeLink = { label: string; href: string };

/** The lattice around one page: its parents (one dimension dropped) and its refinements (one added). */
export type LatticeNav = { parents: LatticeLink[]; children: LatticeLink[] };

/** A lattice node's dimensions, as the listing functions already hold them. */
export type LatticeNode = {
  country?: { slug: string; name: string; countries: string[] } | null;
  city?: { slug: string; name: string; cities: string[] } | null;
  tag?: ActivityTagDescribed | null;
};

/** The lattice data a node's children are drawn from: every tag page and country×city pair with a day on it. */
export type LatticeData = {
  tags: readonly {
    tag: ActivityTagDescribed;
    city: { slug: string; name: string } | null;
    country: { slug: string; name: string } | null;
    days: number;
  }[];
  countryCities: readonly {
    country: { slug: string; name: string };
    city: { slug: string; name: string };
    days: number;
  }[];
};

/** How many refinement links one page shows: the sitemap is the complete traversal, this is the way in. */
const MAX_CHILDREN = 12;

/** A refinement candidate, ordered days-descending, then slug-ascending, then country-ascending on a slug tie, before the cap. */
type Child = { slug: string; tiebreak?: string; days: number; label: string; href: string };

const placeLabel = (name: string): string => `${name} playbooks`;

const tagLabel = (
  tag: ActivityTagDescribed,
  city: { name: string } | null,
  country: { name: string } | null,
): string => {
  const label = TAG_LABEL[tag];
  if (city === null) return country === null ? `${label} playbooks` : `${label} playbooks in ${country.name}`;
  return country === null
    ? `${city.name} ${label.toLowerCase()} playbooks`
    : `${city.name} ${label.toLowerCase()} playbooks in ${country.name}`;
};

const countryCityLabel = (city: { name: string }, country: { name: string }): string =>
  `${city.name} playbooks in ${country.name}`;

const tagChild = (page: LatticeData["tags"][number], slug: string): Child => ({
  slug,
  days: page.days,
  label: tagLabel(page.tag, page.city, page.country),
  href: tagPath(page.tag, page.city?.slug ?? null, page.country?.slug ?? null),
});

const countryCityChild = (page: LatticeData["countryCities"][number]): Child => ({
  slug: page.city.slug,
  // Two country×city children of one city share the city slug, so a days
  // tie needs the country slug: without it the order falls back to the
  // readers' insertion order, which no ORDER BY pins down.
  tiebreak: page.country.slug,
  days: page.days,
  label: countryCityLabel(page.city, page.country),
  href: countryCityPath(page.country.slug, page.city.slug),
});

/** Days descending, then the slug ascending, then the country ascending on a slug tie: the order is the page's, not the reader's locale or input order. */
function byDaysThenSlug(a: Child, b: Child): number {
  return (
    b.days - a.days ||
    (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0) ||
    ((a.tiebreak ?? "") < (b.tiebreak ?? "") ? -1 : (a.tiebreak ?? "") > (b.tiebreak ?? "") ? 1 : 0)
  );
}

/**
 * The lattice around `node`: parents by dropping one dimension — a parent
 * always exists when its child does, since the same day is counted under
 * both — and refinements by adding one, only where a day matches, capped.
 */
export function latticeNav(node: LatticeNode, lattice: LatticeData): LatticeNav {
  const country = node.country ?? null;
  const city = node.city ?? null;
  const tag = node.tag ?? null;
  const parents: LatticeLink[] = [];
  let children: Child[] = [];

  if (country !== null && city !== null && tag !== null) {
    parents.push(
      { label: countryCityLabel(city, country), href: countryCityPath(country.slug, city.slug) },
      { label: tagLabel(tag, null, country), href: tagPath(tag, null, country.slug) },
      { label: tagLabel(tag, city, null), href: tagPath(tag, city.slug) },
    );
  } else if (country !== null && city !== null) {
    parents.push(
      { label: placeLabel(country.name), href: placePath({ kind: "country", slug: country.slug }) },
      { label: placeLabel(city.name), href: placePath({ kind: "city", slug: city.slug }) },
    );
    children = lattice.tags
      .filter((page) => page.country?.slug === country.slug && page.city?.slug === city.slug)
      .map((page) => tagChild(page, page.tag));
  } else if (country !== null && tag !== null) {
    parents.push(
      { label: placeLabel(country.name), href: placePath({ kind: "country", slug: country.slug }) },
      { label: tagLabel(tag, null, null), href: tagPath(tag) },
    );
    children = lattice.tags
      .filter((page) => page.country?.slug === country.slug && page.tag === tag && page.city !== null)
      .map((page) => tagChild(page, page.city!.slug));
  } else if (city !== null && tag !== null) {
    parents.push(
      { label: placeLabel(city.name), href: placePath({ kind: "city", slug: city.slug }) },
      { label: tagLabel(tag, null, null), href: tagPath(tag) },
    );
    children = lattice.tags
      .filter((page) => page.city?.slug === city.slug && page.tag === tag && page.country !== null)
      .map((page) => tagChild(page, page.country!.slug));
  } else if (country !== null) {
    children = [
      ...lattice.tags
        .filter((page) => page.country?.slug === country.slug && page.city === null)
        .map((page) => tagChild(page, page.tag)),
      ...lattice.countryCities
        .filter((page) => page.country.slug === country.slug)
        .map((page) => countryCityChild(page)),
    ];
  } else if (city !== null) {
    children = [
      ...lattice.tags
        .filter((page) => page.city?.slug === city.slug && page.country === null)
        .map((page) => tagChild(page, page.tag)),
      // And the countries the city sits in: a city page is where a name
      // that exists in two countries (Cambridge, Springfield) disambiguates,
      // so its country×city pages are refinements exactly like its tags.
      ...lattice.countryCities
        .filter((page) => page.city.slug === city.slug)
        .map((page) => countryCityChild(page)),
    ];
  } else if (tag !== null) {
    children = [
      ...lattice.tags
        .filter((page) => page.tag === tag && page.country !== null && page.city === null)
        .map((page) => tagChild(page, page.country!.slug)),
      ...lattice.tags
        .filter((page) => page.tag === tag && page.city !== null && page.country === null)
        .map((page) => tagChild(page, page.city!.slug)),
    ];
  }

  return {
    parents,
    children: children
      .sort(byDaysThenSlug)
      .slice(0, MAX_CHILDREN)
      .map(({ label, href }) => ({ label, href })),
  };
}
