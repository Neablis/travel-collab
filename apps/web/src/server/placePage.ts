import { cache, type ComponentProps } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { PlaceDaysList } from "@/components/playbooks/PlaceDaysList";
import { PLACE_PAGE_SIZE, placeIndexable, placePagePath, placePath } from "@/lib/playbookUrls";
import { NOINDEX_FOLLOW, pageMetadata } from "@/lib/siteMetadata";
import type { PlacePage } from "./playbooks";
// Cached for a day, and cleared on publish (ADR-063).
import { placeFor, publishedDaysPage } from "./publicLibrary";

// The city and country pages (SEO pass, D6): one page over two kinds of place.
// Here rather than in either page file because a page file is not a module
// another file imports, and in `src/server` because it reads the database —
// the lint wall opens `(app)/playbooks/**/page.tsx` to `@/server/*`, not a
// helper beside them.

/** What a city or country route hands its page: the `[slug]` segment, and `?page=`. */
export type PlaceRouteProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ page?: string | string[] }>;
};

/** `?page=` as a whole number from 1; anything else is page one. */
function pageOf(raw: string | string[] | undefined): number {
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

async function resolve(kind: PlacePage["kind"], { params, searchParams }: PlaceRouteProps) {
  const [{ slug }, { page: raw }] = await Promise.all([params, searchParams]);
  const page = pageOf(raw);
  return { page, data: await load(kind, slug, page) };
}

/** Metadata for a city or country page: its name and count, its card, self-canonical per page. */
export async function placeMetadata(kind: PlacePage["kind"], props: PlaceRouteProps): Promise<Metadata> {
  const { page, data } = await resolve(kind, props);
  if (data === null) return {};
  const { place } = data;
  return pageMetadata({
    title: page === 1 ? `${place.name} playbooks` : `${place.name} playbooks, page ${page}`,
    description:
      place.days === 1
        ? `1 day a traveler planned in ${place.name}. Open it and drop it into your trip.`
        : `${place.days} days other travelers planned in ${place.name}. Find one and drop it into your trip.`,
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
  return { name: data.place.name, path: placePath(data.place), days: data.days, total: data.place.days, page };
}
