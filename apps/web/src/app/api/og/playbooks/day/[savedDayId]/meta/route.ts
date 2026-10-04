import { LinkPreviewMeta } from "@tc/contracts";
import { LIBRARY_TAG, cacheTagHeader, dayTag } from "@/server/libraryCache";
import { PLAYBOOK_CACHE_CONTROL } from "@/server/og/card";
import { playbookDayCopy } from "@/server/og/copy";
import { limitLinkPreview } from "@/server/og/limit";
import { dayCardFor } from "@/server/og/playbooks";

// The og:title and og:description beside the day's image, for its page's
// `generateMetadata` (the invite `meta` route's reason). Same lookup, same
// copy, so the picture and the words cannot disagree.
/** `GET /api/og/playbooks/day/:savedDayId/meta` — `LinkPreviewMeta` for a shared day's preview. */
export async function GET(request: Request, { params }: { params: Promise<{ savedDayId: string }> }) {
  const refused = await limitLinkPreview(request);
  if (refused !== null) return refused;
  const { savedDayId } = await params;
  const { title, description } = playbookDayCopy(await dayCardFor(savedDayId));
  return Response.json(LinkPreviewMeta.parse({ title, description }), {
    headers: { "Cache-Control": PLAYBOOK_CACHE_CONTROL, ...cacheTagHeader(dayTag(savedDayId), LIBRARY_TAG) },
  });
}
