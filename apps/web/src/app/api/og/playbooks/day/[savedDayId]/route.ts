import { LIBRARY_TAG, cacheTagHeader, dayTag } from "@/server/libraryCache";
import { PLAYBOOK_CACHE_CONTROL, renderCard } from "@/server/og/card";
import { playbookDayCopy } from "@/server/og/copy";
import { limitLinkPreview } from "@/server/og/limit";
import { dayCardFor } from "@/server/og/playbooks";

// Spec 2026-10-02 §2.7, on the invite route's terms: no session read, and
// every id gets a 200 and a card — a published day its own, anything else
// (private, moderated, deleted, unknown, not a uuid) the generic one, so the
// status cannot tell a stranger which ids are private days.
/** `GET /api/og/playbooks/day/:savedDayId` — a shared day's preview image, 1200×630 PNG. */
export async function GET(request: Request, { params }: { params: Promise<{ savedDayId: string }> }) {
  const refused = await limitLinkPreview(request);
  if (refused !== null) return refused;
  const { savedDayId } = await params;
  // Tagged whatever it drew: a private day's generic card has to go when the
  // day is published, as much as its own card when it is withdrawn.
  return renderCard(
    playbookDayCopy(await dayCardFor(savedDayId)),
    PLAYBOOK_CACHE_CONTROL,
    cacheTagHeader(dayTag(savedDayId), LIBRARY_TAG),
  );
}
