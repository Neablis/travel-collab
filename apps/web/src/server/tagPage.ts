import { cache, type ComponentProps } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { PlaceDaysList } from "@/components/playbooks/PlaceDaysList";
import { TAG_LABEL } from "@/lib/activityTags";
import { ActivityTagDescribed } from "@tc/contracts";
import { PLAYBOOKS_CARD_PATH } from "@/lib/playbooksPreview";
import { PLACE_PAGE_SIZE, placeIndexable, placePagePath, tagPath } from "@/lib/playbookUrls";
import { NOINDEX_FOLLOW, pageMetadata } from "@/lib/siteMetadata";
import { pageOf } from "./placePage";
import type { TagPage } from "./playbooks";
// Cached for a day, and cleared on publish (ADR-063).
import { publishedDaysPage, tagPageFor } from "./publicLibrary";

// The tag pages (M42 D10): `/playbooks/tag/<tag>`, and the same tag in one
// city's page, `/playbooks/city/<slug>/<tag>`. A city or country page over a
// tag instead of a place, so it is read, counted, paged and indexed the way
// `placePage.ts` does those, and drawn by the same list.

/** What a tag route hands its page: the `[tag]` segment, the city's `[slug]` on a city's, and `?page=`. */
export type TagRouteProps = {
  params: Promise<{ tag: string; slug?: string }>;
  searchParams: Promise<{ page?: string | string[] }>;
};

// Read once per request for the metadata and the page. A tag with no page
// (Lodging, Ticketed, a typo), a tag no day there is named by, and a page past
// the end are all a 404, answered without listing anything.
const load = cache(async (tag: string, citySlug: string | null, page: number) => {
  const parsed = ActivityTagDescribed.safeParse(tag);
  if (!parsed.success) return null;
  const tagPage = await tagPageFor(parsed.data, citySlug);
  if (tagPage === null || (page - 1) * PLACE_PAGE_SIZE >= tagPage.days) return null;
  const { days } = await publishedDaysPage(
    tagPage.city === null ? { tag: tagPage.tag } : { tag: tagPage.tag, cities: tagPage.city.cities },
    { limit: PLACE_PAGE_SIZE, offset: (page - 1) * PLACE_PAGE_SIZE },
  );
  return days.length === 0 ? null : { tagPage, days };
});

/** The days a tag page lists at `page`, as it lists them; none where it is a 404. For its assistant (M45 D9). */
export async function tagPageDays(tag: string, citySlug: string | null, page: number) {
  return (await load(tag, citySlug, page))?.days ?? [];
}

async function resolve({ params, searchParams }: TagRouteProps) {
  const [{ tag, slug }, { page: raw }] = await Promise.all([params, searchParams]);
  const page = pageOf(raw);
  return { page, data: await load(tag, slug ?? null, page) };
}

/** The page's words: "Tokyo nightlife playbooks", and how many days. */
function wordsFor({ tag, city, days }: TagPage): { heading: string; summary: string } {
  const label = TAG_LABEL[tag];
  const where = city === null ? "" : ` in ${city.name}`;
  return {
    heading: city === null ? `${label} playbooks` : `${city.name} ${label.toLowerCase()} playbooks`,
    summary:
      days === 1
        ? `1 ${label.toLowerCase()} day a traveler planned${where}.`
        : `${days} ${label.toLowerCase()} days other travelers planned${where}.`,
  };
}

const pathOf = ({ tag, city }: TagPage) => tagPath(tag, city?.slug ?? null);

/** Metadata for a tag page: its heading and count, its card, self-canonical per page. */
export async function tagMetadata(props: TagRouteProps): Promise<Metadata> {
  const { page, data } = await resolve(props);
  if (data === null) return {};
  const { tagPage } = data;
  const { heading, summary } = wordsFor(tagPage);
  return pageMetadata({
    title: page === 1 ? heading : `${heading}, page ${page}`,
    description: `${summary} Find one and drop it into your trip.`,
    // A city's card for a city's tag page, as its city page draws; the
    // Playbooks card for a tag across the library, which no one place names.
    image: {
      url:
        tagPage.city === null
          ? PLAYBOOKS_CARD_PATH
          : `/api/og/playbooks/city/${encodeURIComponent(tagPage.city.name)}`,
      alt: heading,
    },
    canonical: placePagePath(pathOf(tagPage), page),
    // The sitemap's predicate over the same count (M42 D10): a thin tag page
    // opens and passes its links on, and stays out of the index.
    ...(placeIndexable(tagPage) ? {} : { robots: NOINDEX_FOLLOW }),
  });
}

/** A tag page's list, or a 404 for a tag with no page there and a page past its end. */
export async function tagListing(props: TagRouteProps): Promise<ComponentProps<typeof PlaceDaysList>> {
  const { page, data } = await resolve(props);
  if (data === null) notFound();
  return { ...wordsFor(data.tagPage), path: pathOf(data.tagPage), days: data.days, total: data.tagPage.days, page };
}
