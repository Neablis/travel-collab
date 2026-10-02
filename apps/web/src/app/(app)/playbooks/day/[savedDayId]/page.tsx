import { SharedDayScreen } from "@/components/playbooks/SharedDayScreen";
import { backTarget } from "@/components/playbooks/backLink";
import { linkPreviewMetadata } from "@/lib/linkPreview";
import { playbooksPageMetadata } from "@/lib/playbooksPreview";

// The day's own preview card (spec 2026-10-02 §2.7): its name, cities and the
// author's public name ("Dana R.") when it is published, the Playbooks card
// otherwise. The route decides which. The link is the clean one; `?from=`
// changes nothing.
/** Metadata for `/playbooks/day/<id>`: the day's card, or the Playbooks card if its lookup fails. */
export async function generateMetadata({ params }: { params: Promise<{ savedDayId: string }> }) {
  const { savedDayId } = await params;
  return linkPreviewMetadata(
    `/api/og/playbooks/day/${encodeURIComponent(savedDayId)}`,
    playbooksPageMetadata("A playbook"),
  );
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
