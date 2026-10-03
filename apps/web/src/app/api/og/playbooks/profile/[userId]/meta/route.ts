import { LinkPreviewMeta } from "@tc/contracts";
import { authorTag, cacheTagHeader } from "@/server/libraryCache";
import { PLAYBOOK_CACHE_CONTROL } from "@/server/og/card";
import { playbookProfileCopy } from "@/server/og/copy";
import { limitLinkPreview } from "@/server/og/limit";
import { profileCardFor, segment } from "@/server/og/playbooks";

// For the profile page's `generateMetadata`: the image route's lookup and copy.
/** `GET /api/og/playbooks/profile/:userId/meta` — `LinkPreviewMeta` for a public profile's preview. */
export async function GET(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  const refused = await limitLinkPreview(request);
  if (refused !== null) return refused;
  const userId = segment((await params).userId);
  const { title, description } = playbookProfileCopy(await profileCardFor(userId));
  return Response.json(LinkPreviewMeta.parse({ title, description }), {
    headers: { "Cache-Control": PLAYBOOK_CACHE_CONTROL, ...cacheTagHeader(authorTag(userId)) },
  });
}
