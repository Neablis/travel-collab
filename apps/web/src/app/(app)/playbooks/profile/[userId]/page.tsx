import { ProfileScreen } from "@/components/playbooks/ProfileScreen";
import { backTarget } from "@/components/playbooks/backLink";
import { linkPreviewMetadata } from "@/lib/linkPreview";
import { playbooksPageMetadata } from "@/lib/playbooksPreview";
import { NOINDEX_FOLLOW } from "@/lib/siteMetadata";

// The profile's own preview card (spec 2026-10-02 §2.7): the name the page
// shows and its numbers, or the Playbooks card for someone with nothing
// shared. Decoded as the page body decodes it, so both name the same id.
/**
 * Metadata for `/playbooks/profile/<id>`: the profile's card, or the Playbooks
 * card if its lookup fails, with a query-free canonical and `noindex, follow`.
 * Decodes the ID before encoding it as one path segment.
 * @throws {URIError} If the ID has malformed URI encoding or an unpaired UTF-16 surrogate.
 */
export async function generateMetadata({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  const id = encodeURIComponent(decodeURIComponent(userId));
  const meta = await linkPreviewMetadata(`/api/og/playbooks/profile/${id}`, playbooksPageMetadata("A traveler's playbooks"));
  return { ...meta, robots: NOINDEX_FOLLOW, alternates: { canonical: `/playbooks/profile/${id}` } };
}

// A public profile (M11b link 8). Reachable three ways — from a shared day,
// from the board and from Discover — so the back link is contextual.
export default async function PublicProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ userId: string }>;
  searchParams: Promise<{ from?: string; day?: string }>;
}) {
  const [{ userId }, { from, day }] = await Promise.all([params, searchParams]);
  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <ProfileScreen userId={decodeURIComponent(userId)} back={backTarget({ from, day })} />
    </main>
  );
}
