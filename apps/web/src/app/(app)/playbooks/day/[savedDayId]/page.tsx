import { SharedDayScreen } from "@/components/playbooks/SharedDayScreen";
import { backTarget } from "@/components/playbooks/backLink";
import { linkPreviewMetadata } from "@/lib/linkPreview";
import { DAY_FALLBACK_TITLE, dayTabTitle, playbooksPageMetadata } from "@/lib/playbooksPreview";

// The day's own preview card (spec 2026-10-02 §2.7): its name, cities and the
// author's public name ("Dana R.") when it is published, the Playbooks card
// otherwise. The route decides which. The link is the clean one; `?from=`
// changes nothing.
/**
 * Metadata for `/playbooks/day/<id>` with a query-free canonical and the day's
 * name as the tab title, or "A playbook" for a generic or failed card lookup.
 * Failed lookups use the Playbooks card.
 * @throws {URIError} If the ID contains an unpaired UTF-16 surrogate.
 */
export async function generateMetadata({ params }: { params: Promise<{ savedDayId: string }> }) {
  const { savedDayId } = await params;
  const id = encodeURIComponent(savedDayId);
  const meta = await linkPreviewMetadata(`/api/og/playbooks/day/${id}`, playbooksPageMetadata(DAY_FALLBACK_TITLE));
  // D3: the tab says the day's name. `?from=`, `?day=` and `?profile=` are not
  // part of the canonical, which is the clean path.
  return { ...meta, title: dayTabTitle(meta.openGraph?.title), alternates: { canonical: `/playbooks/day/${id}` } };
}

// A shared day (M11b link 6). Reachable from Discover and from a public
// profile, so the way back is contextual — see `backLink.ts` for why it rides
// the query string rather than browser history.
export default async function SharedDayPage({
  params,
  searchParams,
}: {
  params: Promise<{ savedDayId: string }>;
  searchParams: Promise<{ from?: string; profile?: string }>;
}) {
  const [{ savedDayId }, { from, profile }] = await Promise.all([params, searchParams]);
  const back = backTarget({ from, profile });
  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <SharedDayScreen savedDayId={savedDayId} backHref={back.href} backLabel={back.label} />
    </main>
  );
}
