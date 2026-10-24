import { cache, type ComponentProps } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { PlaceDaysList } from "@/components/playbooks/PlaceDaysList";
import { TAG_LABEL } from "@/lib/activityTags";
import { ActivityTagDescribed } from "@tc/contracts";
import type { BreadcrumbCrumb } from "@/lib/jsonLd";
import { PLAYBOOKS_CARD_PATH, tagDescription, tagTitle, type SeoDay } from "@/lib/playbooksPreview";
import { PLACE_PAGE_SIZE, countryCityPath, placeIndexable, placePagePath, placePath, tagPath } from "@/lib/playbookUrls";
import { latticeNav } from "@/lib/latticeNav";
import { NOINDEX_FOLLOW, pageMetadata } from "@/lib/siteMetadata";
import { pageOf } from "./placePage";
import type { TagPage } from "./playbooks";
// Cached for a day, and cleared on publish (ADR-063).
import { publishedCountryCityPages, publishedDaysPage, publishedTagPages, tagPageFor } from "./publicLibrary";

// The tag pages (M42 D10): `/playbooks/tag/<tag>`, and the same tag in one
// city's page, `/playbooks/city/<slug>/<tag>` — and now the country forms:
// `/playbooks/country/<slug>/tag/<tag>`, and a city inside its country,
// `/playbooks/country/<slug>/city/<city>/tag/<tag>`. A city or country page over a
// tag instead of a place, so it is read, counted, paged and indexed the way
// `placePage.ts` does those, and drawn by the same list.

/** What a tag route hands its page: the `[tag]` segment, the city's `[slug]` on a city's, and `?page=`. */
export type TagRouteProps = {
  params: Promise<{ tag: string; slug?: string }>;
  searchParams: Promise<{ page?: string | string[] }>;
};

/** What a country-scoped tag route hands its page: the country's `[slug]`, the `[tag]`, the city's `[citySlug]` on a country×city's, and `?page=`. */
export type CountryTagRouteProps = {
  params: Promise<{ slug: string; tag: string; citySlug?: string }>;
  searchParams: Promise<{ page?: string | string[] }>;
};

// Read once per request for the metadata and the page. A tag with no page
// (Lodging, Ticketed, a typo), a tag no day there is named by, and a page past
// the end are all a 404, answered without listing anything.
const load = cache(async (tag: string, citySlug: string | null, countrySlug: string | null, page: number) => {
  const parsed = ActivityTagDescribed.safeParse(tag);
  if (!parsed.success) return null;
  const tagPage = await tagPageFor(parsed.data, citySlug, countrySlug);
  if (tagPage === null || (page - 1) * PLACE_PAGE_SIZE >= tagPage.days) return null;
  // The tag is ANDed by `keeps`; the places are ORed by the predicate, so a
  // country×city page adds its city spellings as the AND half (`citiesWithin`).
  const filter =
    tagPage.city === null
      ? tagPage.country === null
        ? { tag: tagPage.tag }
        : { tag: tagPage.tag, countries: tagPage.country.countries }
      : tagPage.country === null
        ? { tag: tagPage.tag, cities: tagPage.city.cities }
        : { tag: tagPage.tag, countries: tagPage.country.countries, citiesWithin: tagPage.city.cities };
  const { days } = await publishedDaysPage(filter, { limit: PLACE_PAGE_SIZE, offset: (page - 1) * PLACE_PAGE_SIZE });
  return days.length === 0 ? null : { tagPage, days };
});

/** The days a tag page lists at `page`, as it lists them; none where it is a 404. For its assistant (M45 D9). */
export async function tagPageDays(tag: string, citySlug: string | null, page: number) {
  return (await load(tag, citySlug, null, page))?.days ?? [];
}

async function resolve({ params, searchParams }: TagRouteProps) {
  const [{ tag, slug }, { page: raw }] = await Promise.all([params, searchParams]);
  const page = pageOf(raw);
  return { page, data: await load(tag, slug ?? null, null, page) };
}

async function resolveCountry({ params, searchParams }: CountryTagRouteProps) {
  const [{ tag, slug, citySlug }, { page: raw }] = await Promise.all([params, searchParams]);
  const page = pageOf(raw);
  return { page, data: await load(tag, citySlug ?? null, slug, page) };
}

/**
 * The page's words: its title base ("Food days worth borrowing", "Food days
 * in Italy", "Food days in Rome, Italy"), its description over the page's
 * own days, and its crumb trail. The description is the list summary, so the
 * meta description and the sentence under the heading never tell a search
 * engine two things. The last crumb is this page at its own URL, page-aware
 * like the place pages' crumbs.
 */
function wordsFor(
  tagPage: TagPage,
  days: readonly SeoDay[],
  page: number,
): { heading: string; summary: string; crumbs: BreadcrumbCrumb[] } {
  const label = TAG_LABEL[tagPage.tag];
  const cityPage = tagPage.city;
  const countryPage = tagPage.country;
  const path = pathOf(tagPage);
  const crumbs: BreadcrumbCrumb[] = [{ name: "Playbooks", path: "/playbooks" }];
  if (countryPage !== null) crumbs.push({ name: countryPage.name, path: placePath({ kind: "country", slug: countryPage.slug }) });
  if (cityPage !== null)
    crumbs.push({
      name: cityPage.name,
      path:
        countryPage !== null
          ? countryCityPath(countryPage.slug, cityPage.slug)
          : placePath({ kind: "city", slug: cityPage.slug }),
    });
  crumbs.push({ name: label, path: placePagePath(path, page) });
  return {
    heading: tagTitle(label, cityPage?.name ?? null, countryPage?.name ?? null),
    summary: tagDescription(label, cityPage?.name ?? null, countryPage?.name ?? null, tagPage.days, days),
    crumbs,
  };
}

const pathOf = ({ tag, city, country }: TagPage) => tagPath(tag, city?.slug ?? null, country?.slug ?? null);

/** Metadata for a tag page: its heading and description, its card, self-canonical per page. */
function metadataFor(tagPage: TagPage, days: readonly SeoDay[], page: number): Metadata {
  const { heading, summary } = wordsFor(tagPage, days, page);
  return pageMetadata({
    title: page === 1 ? heading : `${heading}, page ${page}`,
    description: summary,
    // A city's card for a city's tag page, as its city page draws; a
    // country's card for a country's, as its country page draws; the
    // Playbooks card for a tag across the library, which no one place names.
    image: {
      url:
        tagPage.city !== null
          ? `/api/og/playbooks/city/${encodeURIComponent(tagPage.city.name)}`
          : tagPage.country !== null
            ? `/api/og/playbooks/country/${tagPage.country.countries[0]}`
            : PLAYBOOKS_CARD_PATH,
      alt: heading,
    },
    canonical: placePagePath(pathOf(tagPage), page),
    // The sitemap's predicate over the same count (M42 D10): a thin tag page
    // opens and passes its links on, and stays out of the index.
    ...(placeIndexable(tagPage) ? {} : { robots: NOINDEX_FOLLOW }),
  });
}

/** Metadata for a tag page: its heading and description, its card, self-canonical per page. */
export async function tagMetadata(props: TagRouteProps): Promise<Metadata> {
  const { page, data } = await resolve(props);
  if (data === null) return {};
  return metadataFor(data.tagPage, data.days, page);
}

/** Metadata for a country-scoped tag page: the same, over its country, or its country×city. */
export async function countryTagMetadata(props: CountryTagRouteProps): Promise<Metadata> {
  const { page, data } = await resolveCountry(props);
  if (data === null) return {};
  return metadataFor(data.tagPage, data.days, page);
}

/** A tag page's list, or a 404 for a tag with no page there and a page past its end. */
export async function tagListing(props: TagRouteProps): Promise<ComponentProps<typeof PlaceDaysList>> {
  const { page, data } = await resolve(props);
  if (data === null) notFound();
  const [tags, countryCities] = await Promise.all([publishedTagPages(), publishedCountryCityPages()]);
  return {
    ...wordsFor(data.tagPage, data.days, page),
    path: pathOf(data.tagPage),
    days: data.days,
    total: data.tagPage.days,
    page,
    nav: latticeNav({ city: data.tagPage.city, tag: data.tagPage.tag }, { tags, countryCities }),
  };
}

/** A country-scoped tag page's list, or a 404 for a tag with no page there and a page past its end. */
export async function countryTagListing(props: CountryTagRouteProps): Promise<ComponentProps<typeof PlaceDaysList>> {
  const { page, data } = await resolveCountry(props);
  if (data === null) notFound();
  const [tags, countryCities] = await Promise.all([publishedTagPages(), publishedCountryCityPages()]);
  return {
    ...wordsFor(data.tagPage, data.days, page),
    path: pathOf(data.tagPage),
    days: data.days,
    total: data.tagPage.days,
    page,
    nav: latticeNav(
      { country: data.tagPage.country, city: data.tagPage.city, tag: data.tagPage.tag },
      { tags, countryCities },
    ),
  };
}
