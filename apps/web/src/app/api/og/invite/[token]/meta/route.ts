import { LinkPreviewMeta } from "@tc/contracts";
import { INVITE_CACHE_CONTROL } from "@/server/og/card";
import { inviteCopy } from "@/server/og/copy";
import { inviteCardFor } from "@/server/og/invite";
import { limitLinkPreview } from "@/server/og/limit";

// The og:title and og:description beside the image, for `/invite/[token]`'s
// `generateMetadata`. A page file cannot import `@/server` (the lint wall), so
// it fetches this instead — "UI calls the API", spec 2026-09-27 §2.2. Same
// lookup and same copy module as the image, so the two cannot disagree. A 429
// here costs the page its personal card, not its render: it falls back.
/** `GET /api/og/invite/:token/meta` — `LinkPreviewMeta` for the invite link's preview. */
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const refused = await limitLinkPreview(request);
  if (refused !== null) return refused;
  const { token } = await params;
  const { title, description } = inviteCopy(await inviteCardFor(token));
  return Response.json(LinkPreviewMeta.parse({ title, description }), {
    headers: { "Cache-Control": INVITE_CACHE_CONTROL },
  });
}
