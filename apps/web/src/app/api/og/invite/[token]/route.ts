import { INVITE_CACHE_CONTROL, renderCard } from "@/server/og/card";
import { inviteCopy } from "@/server/og/copy";
import { inviteCardFor } from "@/server/og/invite";
import { limitLinkPreview } from "@/server/og/limit";

// Spec 2026-09-27 §2. Public, with no session read at all: the caller is a
// chat app's unfurler. Every token gets a 200 and a card — a pending invite
// the personal one, anything else the generic one — because an unfurler draws
// nothing for an error, and the status would tell a stranger nothing the card
// does not. Rate-limited per IP and cached at the edge: `server/og/limit.ts`
// and `server/og/card.tsx` say how the two fit together.
/** `GET /api/og/invite/:token` — the invite link's preview image, 1200×630 PNG. */
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const refused = await limitLinkPreview(request);
  if (refused !== null) return refused;
  const { token } = await params;
  return renderCard(inviteCopy(await inviteCardFor(token)), INVITE_CACHE_CONTROL);
}
