import { cache } from "react";
import { notFound, permanentRedirect } from "next/navigation";
import { SharedDayScreen } from "@/components/playbooks/SharedDayScreen";
import { backTarget } from "@/components/playbooks/backLink";
import { DAY_FALLBACK_TITLE, dayDescription, dayIndexable, playbooksPageMetadata } from "@/lib/playbooksPreview";
import { dayPath, daySegment, parseDaySegment } from "@/lib/playbookUrls";
import { NOINDEX, pageMetadata } from "@/lib/siteMetadata";
import { auth } from "@/server/auth";
import { CITIES_SHOWN } from "@/server/og/playbooks";
import { sharedDayView } from "@/server/sharedDayView";

type Params = { params: Promise<{ savedDayId: string }> };

// Read once per request: `generateMetadata` and the page both need the day.
// Read as whoever is asking, so an author still opens their own private day.
// Only the id is taken from the segment; the slug in it is never trusted, and
// a segment with no id in it is the same miss as an id nobody may read.
const loadDay = cache(async (segment: string) => {
  const { id } = parseDaySegment(segment);
  if (id === null) return null;
  const session = await auth();
  return sharedDayView(id, session?.user?.id ?? null);
});

/** Metadata for a shared day: its name and first city, its summary or facts line, its own card. */
export async function generateMetadata({ params }: Params) {
  const view = await loadDay((await params).savedDayId);
  // The page below answers 404 for this; the fallback only fills the <head>,
  // with the one generic card every miss gets.
  if (view === null) return playbooksPageMetadata(DAY_FALLBACK_TITLE);
  const { day, author } = view;
  return pageMetadata({
    // D3: the tab says the day and where. The card keeps the bare name
    // (spec §1): its facts line already names the cities.
    title: day.cities[0] === undefined ? day.name : `${day.name} · ${day.cities[0]}`,
    cardTitle: day.name,
    description: dayDescription(day.summary, {
      cities: day.cities.slice(0, CITIES_SHOWN),
      dayCount: day.dayCount,
      stopCount: day.stops.length,
      author: author.displayName,
      rating: null,
      reviewCount: 0,
    }),
    image: { url: `/api/og/playbooks/day/${day.savedDayId}`, alt: day.name },
    canonical: dayPath(day),
    // An author's private day, or one an operator hid, renders for them and
    // stays out of every index.
    ...(dayIndexable(view) ? {} : { robots: NOINDEX }),
  });
}

// A shared day (M11b link 6), rendered on the server (SEO pass, D5) so the
// HTML holds the day. Reachable from Discover and from a public profile, so
// the way back is contextual — see `backLink.ts`.
//
// **The order below is load-bearing.** The read comes first and a miss is a
// 404; only a day this reader may open is ever redirected. A redirect issued
// before the read would answer differently for a private day than for an
// unknown one, which is the distinction ADR-061 forbids. The target is built
// from the day that was read, never from the segment that was asked for.
/** `/playbooks/day/<slug>-<id>`: the day, a 404, or a 308 to its current URL. */
export default async function SharedDayPage({
  params,
  searchParams,
}: Params & { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ savedDayId: segment }, query] = await Promise.all([params, searchParams]);
  const view = await loadDay(segment);
  if (view === null) notFound();

  // The whole segment against the canonical one, so a missing slug, an old
  // name, a doubled hyphen and an upper-cased id all end at one URL.
  if (segment !== daySegment(view.day)) {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      for (const one of Array.isArray(value) ? value : value === undefined ? [] : [value]) search.append(key, one);
    }
    const qs = search.toString();
    permanentRedirect(`${dayPath(view.day)}${qs === "" ? "" : `?${qs}`}`);
  }

  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  const back = backTarget({ from: first(query.from), profile: first(query.profile) });
  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <SharedDayScreen savedDayId={view.day.savedDayId} backHref={back.href} backLabel={back.label} initial={view} />
    </main>
  );
}
