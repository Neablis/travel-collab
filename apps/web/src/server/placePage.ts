import { cache, type ComponentProps } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { PlaceDaysList } from "@/components/playbooks/PlaceDaysList";
import { PLACE_PAGE_SIZE, countryCityPath, placeIndexable, placePagePath, placePath } from "@/lib/playbookUrls";
import type { BreadcrumbCrumb } from "@/lib/jsonLd";
import { latticeNav } from "@/lib/latticeNav";
import {
  cityDescription,
  countryCityDescription,
  countryCityTitle,
  countryDescription,
  placeTitle,
} from "@/lib/playbooksPreview";
import { NOINDEX_FOLLOW, pageMetadata } from "@/lib/siteMetadata";
import type { PlacePage } from "./playbooks";
// Cached for a day, and cleared on publish (ADR-063).
import { countryCityFor, placeFor, publishedCountryCityPages, publishedDaysPage, publishedTagPages } from "./publicLibrary";

// The city and country pages (SEO pass, D6): one page over two kinds of place.
// Here rather than in either page file because a page file is not a module
// another file imports, and in `src/server` because it reads the database —
// the lint wall opens `app/playbooks/**/page.tsx` to `@/server/*`, not a
// helper beside them.

/** What a city or country route hands its page: the `[slug]` segment, and `?page=`. */
export type PlaceRouteProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ page?: string | string[] }>;
};

/** `?page=` as a whole number from 1; anything else is page one. */
export function pageOf(raw: string | string[] | undefined): number {
  const n = Number(Array.isArray(raw) ? raw[0] : raw);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

// Read once per request for the metadata and the page. A page past the end is
// as missing as a place nobody published in, and is answered without asking
// the database: `?page=1e21` is a whole number whose offset no bigint holds.
const load = cache(async (kind: PlacePage["kind"], slug: string, page: number) => {
  const place = await placeFor(kind, slug);
  if (place === null || (page - 1) * PLACE_PAGE_SIZE >= place.days) return null;
  const { days } = await publishedDaysPage(kind === "city" ? { cities: place.cities } : { countries: place.countries }, {
    limit: PLACE_PAGE_SIZE,
    offset: (page - 1) * PLACE_PAGE_SIZE,
  });
  return days.length === 0 ? null : { place, days };
});

/** The days a city or country page lists at `page`, as it lists them; none where it is a 404. For its assistant (M45 D9). */
export async function placePageDays(kind: PlacePage["kind"], slug: string, page: number) {
  return (await load(kind, slug, page))?.days ?? [];
}

async function resolve(kind: PlacePage["kind"], { params, searchParams }: PlaceRouteProps) {
  const [{ slug }, { page: raw }] = await Promise.all([params, searchParams]);
  const page = pageOf(raw);
  return { page, data: await load(kind, slug, page) };
}

/** Metadata for a city or country page: its title and description, its card, self-canonical per page. */
export async function placeMetadata(kind: PlacePage["kind"], props: PlaceRouteProps): Promise<Metadata> {
  const { page, data } = await resolve(kind, props);
  if (data === null) return {};
  const { place } = data;
  // The description is the page's own list summary, so the meta description
  // and the sentence under the heading never tell a search engine two things.
  const title = placeTitle(place.name);
  return pageMetadata({
    title: page === 1 ? title : `${title}, page ${page}`,
    description:
      place.kind === "city"
        ? cityDescription(place.name, place.days, data.days)
        : countryDescription(place.name, place.days, data.days),
    // The card each kind draws. The city card matches a stored spelling
    // exactly, which `name` is; the country card is keyed by ISO code.
    image: {
      url:
        place.kind === "city"
          ? `/api/og/playbooks/city/${encodeURIComponent(place.name)}`
          : `/api/og/playbooks/country/${place.countries[0]}`,
      alt: `${place.name} playbooks`,
    },
    canonical: placePagePath(placePath(place), page),
    // `placeIndexable` over `place.days`, the count the sitemap asks it about:
    // a thin page opens and passes its links on, and stays out of the index.
    ...(placeIndexable(place) ? {} : { robots: NOINDEX_FOLLOW }),
  });
}

/** A city or country page's list, or a 404 for a place nobody published in and a page past its end. */
export async function placeListing(
  kind: PlacePage["kind"],
  props: PlaceRouteProps,
): Promise<ComponentProps<typeof PlaceDaysList>> {
  const { page, data } = await resolve(kind, props);
  if (data === null) notFound();
  const { name, days: total } = data.place;
  const [tags, countryCities] = await Promise.all([publishedTagPages(), publishedCountryCityPages()]);
  const path = placePath(data.place);
  // The last crumb is this page at its own URL: on `?page=N` the trail
  // ends at page N, as the page's canonical does, not at page one.
  const crumbs: BreadcrumbCrumb[] = [
    { name: "Playbooks", path: "/playbooks" },
    { name, path: placePagePath(path, page) },
  ];
  return {
    heading: placeTitle(name),
    summary: kind === "city" ? cityDescription(name, total, data.days) : countryDescription(name, total, data.days),
    path,
    crumbs,
    days: data.days,
    total,
    page,
    nav: latticeNav(kind === "city" ? { city: data.place } : { country: data.place }, { tags, countryCities }),
  };
}

// The country×city page: one city's days inside one country — the city page
// over the country's days, in the same shape as the place pages above, so it
// is counted, paged and indexed the way they are, and drawn by the same list.

/** What a country×city route hands its page: the country's `[slug]`, the city's `[citySlug]`, and `?page=`. */
export type CountryCityRouteProps = {
  params: Promise<{ slug: string; citySlug: string }>;
  searchParams: Promise<{ page?: string | string[] }>;
};

// Read once per request for the metadata and the page. A pair no published
// day matches, and a page past its end, are a 404.
const countryCityLoad = cache(async (countrySlug: string, citySlug: string, page: number) => {
  const pair = await countryCityFor(countrySlug, citySlug);
  if (pair === null || (page - 1) * PLACE_PAGE_SIZE >= pair.days) return null;
  const { days } = await publishedDaysPage(
    { countries: pair.country.countries, citiesWithin: pair.city.cities },
    { limit: PLACE_PAGE_SIZE, offset: (page - 1) * PLACE_PAGE_SIZE },
  );
  return days.length === 0 ? null : { pair, days };
});

async function resolveCountryCity({ params, searchParams }: CountryCityRouteProps) {
  const [{ slug, citySlug }, { page: raw }] = await Promise.all([params, searchParams]);
  const page = pageOf(raw);
  return { page, data: await countryCityLoad(slug, citySlug, page) };
}

/** Metadata for a country×city page: its title and description, its card, self-canonical per page. */
export async function countryCityMetadata(props: CountryCityRouteProps): Promise<Metadata> {
  const { page, data } = await resolveCountryCity(props);
  if (data === null) return {};
  const { pair } = data;
  const heading = countryCityTitle(pair.city.name, pair.country.name);
  return pageMetadata({
    title: page === 1 ? heading : `${heading}, page ${page}`,
    description: countryCityDescription(pair.city.name, pair.days, data.days),
    // The city card, as its city page draws: the pair is one city's days.
    image: {
      url: `/api/og/playbooks/city/${encodeURIComponent(pair.city.name)}`,
      alt: heading,
    },
    canonical: placePagePath(countryCityPath(pair.country.slug, pair.city.slug), page),
    // The sitemap's predicate over the same count: a thin pair page opens
    // and passes its links on, and stays out of the index.
    ...(placeIndexable(pair) ? {} : { robots: NOINDEX_FOLLOW }),
  });
}

/** A country×city page's list, or a 404 for a pair nobody published in and a page past its end. */
export async function countryCityListing(props: CountryCityRouteProps): Promise<ComponentProps<typeof PlaceDaysList>> {
  const { page, data } = await resolveCountryCity(props);
  if (data === null) notFound();
  const { pair } = data;
  const [tags, countryCities] = await Promise.all([publishedTagPages(), publishedCountryCityPages()]);
  const path = countryCityPath(pair.country.slug, pair.city.slug);
  // The last crumb is this page at its own URL, as on the place pages.
  const crumbs: BreadcrumbCrumb[] = [
    { name: "Playbooks", path: "/playbooks" },
    { name: pair.country.name, path: placePath({ kind: "country", slug: pair.country.slug }) },
    { name: pair.city.name, path: placePagePath(path, page) },
  ];
  return {
    heading: countryCityTitle(pair.city.name, pair.country.name),
    summary: countryCityDescription(pair.city.name, pair.days, data.days),
    path,
    crumbs,
    days: data.days,
    total: pair.days,
    page,
    nav: latticeNav({ country: pair.country, city: pair.city }, { tags, countryCities }),
  };
}
