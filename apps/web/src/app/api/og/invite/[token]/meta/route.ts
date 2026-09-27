import { CARD_CACHE_CONTROL } from "@/server/og/card";
import { inviteCopy } from "@/server/og/copy";
import { inviteCardFor } from "@/server/og/invite";

// The og:title and og:description beside the image, for `/invite/[token]`'s
// `generateMetadata`. A page file cannot import `@/server` (the lint wall), so
// it fetches this instead — "UI calls the API", spec 2026-09-27 §2.2. Same
// lookup and same copy module as the image, so the two cannot disagree.
/** `GET /api/og/invite/:token/meta` — `{ title, description }` for the invite link's preview. */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { title, description } = inviteCopy(await inviteCardFor(token));
  return Response.json({ title, description }, { headers: { "Cache-Control": CARD_CACHE_CONTROL } });
}
