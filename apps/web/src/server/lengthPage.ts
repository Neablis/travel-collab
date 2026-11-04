import { cache, type ComponentProps } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { PlaceDaysList } from "@/components/playbooks/PlaceDaysList";
import type { BreadcrumbCrumb } from "@/lib/jsonLd";
import { tagPageCrumbs } from "@/lib/jsonLd";
import { latticeNav } from "@/lib/latticeNav";
import { PLAYBOOKS_CARD_PATH, lengthDescription, lengthTitle, LENGTH_PAGE_TRIPS, type SeoDay } from "@/lib/playbooksPreview";
import {
  PLACE_PAGE_SIZE,
  countryCityPath,
  lengthBandOfSlug,
  lengthPath,
  placeIndexable,
  placePagePath,
  placePath,
} from "@/lib/playbookUrls";
import { NOINDEX_FOLLOW, pageMetadata } from "@/lib/siteMetadata";
import { pageOf } from "./placePage";
import type { LengthPage } from "./playbooks";
// Cached for a day, and cleared on publish (ADR-063).
import {
  lengthPageFor,
  publishedCountryCityPages,
  publishedDaysPage,
  publishedLengthPages,
  publishedTagPages,
} from "./publicLibrary";

// The length pages: one band of Discover's length filter (1 / 2-3 / 4-6 / 7+
// days, `LengthBand`), across the library, in one city, one country, or one
// city inside its country: `/playbooks/length/<band>`,
// `/playbooks/city/<slug>/length/<band>`, `/playbooks/country/<slug>/length/<band>`
// and `/playbooks/country/<slug>/city/<city>/length/<band>`. Read, counted,
// paged and indexed as the tag pages are, and drawn by the same list (ADR-087).

/** What a length route hands its page: the `[band]` segment, the city's and country's slugs where its scope has them, and `?page=`. */
export type LengthRouteProps = {
  params: Promise<{ band: string; slug?: string; citySlug?: string }>;
  searchParams: Promise<{ page?: string | string[] }>;
};

/** Which place segments a length route's `slug` is: a city page's, or a country page's (whose city, if any, is `citySlug`). */
export type LengthScope = "library" | "city" | "country";

// Read once per request for the metadata and the page. A segment that names
// no band, a band no day there falls in, and a page past the end are all a
// 404, answered without listing anything.
const load = cache(async (bandSlug: string, citySlug: string | null, countrySlug: string | null, page: number) => {
  const band = lengthBandOfSlug(bandSlug);
  if (band === null) return null;
  const lengthPage = await lengthPageFor(band, citySlug, countrySlug);
  if (lengthPage === null || (page - 1) * PLACE_PAGE_SIZE >= lengthPage.days) return null;
  // As on the tag pages: the places are ORed by the predicate, so a
  // country×city page adds its city spellings as the AND half (`citiesWithin`).
  const filter =
    lengthPage.city === null
      ? lengthPage.country === null
        ? { length: band }
        : { length: band, countries: lengthPage.country.countries }
      : lengthPage.country === null
        ? { length: band, cities: lengthPage.city.cities }
        : { length: band, countries: lengthPage.country.countries, citiesWithin: lengthPage.city.cities };
  const { days } = await publishedDaysPage(filter, { limit: PLACE_PAGE_SIZE, offset: (page - 1) * PLACE_PAGE_SIZE });
  return days.length === 0 ? null : { lengthPage, days };
});

async function resolve(scope: LengthScope, { params, searchParams }: LengthRouteProps) {
  const [{ band, slug, citySlug }, { page: raw }] = await Promise.all([params, searchParams]);
  const page = pageOf(raw);
  const city = scope === "city" ? (slug ?? null) : scope === "country" ? (citySlug ?? null) : null;
  const country = scope === "country" ? (slug ?? null) : null;
  return { page, data: await load(band, city, country, page) };
}

const pathOf = ({ band, city, country }: LengthPage) => lengthPath(band, city?.slug ?? null, country?.slug ?? null);

/**
 * The page's words: its title base ("4-6 day trips in Kyoto, Japan"), its
 * description over the page's own days, and its crumb trail, as `tagPage.ts`
 * builds them, the last crumb this page at its own URL.
 */
function wordsFor(
  lengthPage: LengthPage,
  days: readonly SeoDay[],
  page: number,
): { heading: string; summary: string; crumbs: BreadcrumbCrumb[] } {
  const { band, city, country } = lengthPage;
  const crumbs = tagPageCrumbs(
    LENGTH_PAGE_TRIPS[band],
    city === null
      ? null
      : {
          name: city.name,
          path: country !== null ? countryCityPath(country.slug, city.slug) : placePath({ kind: "city", slug: city.slug }),
        },
    country === null ? null : { name: country.name, path: placePath({ kind: "country", slug: country.slug }) },
    pathOf(lengthPage),
    page,
  );
  return {
    heading: lengthTitle(band, city?.name ?? null, country?.name ?? null),
    summary: lengthDescription(band, city?.name ?? null, country?.name ?? null, lengthPage.days, days),
    crumbs,
  };
}

/** Metadata for a length page: its heading and description, its card, self-canonical per page. */
function metadataFor(lengthPage: LengthPage, days: readonly SeoDay[], page: number): Metadata {
  const { heading, summary } = wordsFor(lengthPage, days, page);
  return pageMetadata({
    title: page === 1 ? heading : `${heading}, page ${page}`,
    description: summary,
    // The place's card where the page has a place, as the tag pages draw it.
    image: {
      url:
        lengthPage.city !== null
          ? `/api/og/playbooks/city/${encodeURIComponent(lengthPage.city.name)}`
          : lengthPage.country !== null
            ? `/api/og/playbooks/country/${lengthPage.country.countries[0]}`
            : PLAYBOOKS_CARD_PATH,
      alt: heading,
    },
    canonical: placePagePath(pathOf(lengthPage), page),
    // The sitemap's predicate over the same count: a thin length page opens
    // and passes its links on, and stays out of the index.
    ...(placeIndexable(lengthPage) ? {} : { robots: NOINDEX_FOLLOW }),
  });
}

/** Metadata for a length page at `scope`. */
export async function lengthMetadata(scope: LengthScope, props: LengthRouteProps): Promise<Metadata> {
  const { page, data } = await resolve(scope, props);
  if (data === null) return {};
  return metadataFor(data.lengthPage, data.days, page);
}

/** A length page's list at `scope`, or a 404 for a band with no page there and a page past its end. */
export async function lengthListing(
  scope: LengthScope,
  props: LengthRouteProps,
): Promise<ComponentProps<typeof PlaceDaysList>> {
  const { page, data } = await resolve(scope, props);
  if (data === null) notFound();
  const [tags, countryCities, lengths] = await Promise.all([
    publishedTagPages(),
    publishedCountryCityPages(),
    publishedLengthPages(),
  ]);
  const { band, city, country } = data.lengthPage;
  return {
    ...wordsFor(data.lengthPage, data.days, page),
    path: pathOf(data.lengthPage),
    days: data.days,
    total: data.lengthPage.days,
    page,
    nav: latticeNav({ country, city, length: band }, { tags, countryCities, lengths }),
  };
}
