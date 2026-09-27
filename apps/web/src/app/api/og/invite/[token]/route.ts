import { renderCard } from "@/server/og/card";
import { inviteCopy } from "@/server/og/copy";
import { inviteCardFor } from "@/server/og/invite";

// Spec 2026-09-27 §2. Public, with no session read at all: the caller is a
// chat app's unfurler. Every token gets a 200 and a card — a pending invite
// the personal one, anything else the generic one — because an unfurler draws
// nothing for an error, and the status would tell a stranger nothing the card
// does not.
//
// Not rate-limited, matching `GET /api/invites/:token`, which returns strictly
// more for the same token: the token is 256 bits (`mintToken`), so there is
// nothing to enumerate.
/** `GET /api/og/invite/:token` — the invite link's preview image, 1200×630 PNG. */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return renderCard(inviteCopy(await inviteCardFor(token)));
}
