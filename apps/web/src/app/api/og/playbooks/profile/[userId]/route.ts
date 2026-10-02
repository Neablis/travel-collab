import { PLAYBOOK_CACHE_CONTROL, renderCard } from "@/server/og/card";
import { playbookProfileCopy } from "@/server/og/copy";
import { limitLinkPreview } from "@/server/og/limit";
import { profileCardFor, segment } from "@/server/og/playbooks";

// Spec 2026-10-02 §2.7. Someone who has shared a playbook gets their public
// name and numbers; any other id gets the generic card and a 200, so the route
// does not answer "does this account exist" (`publicAuthor`'s rule).
/** `GET /api/og/playbooks/profile/:userId` — a public profile's preview image, 1200×630 PNG. */
export async function GET(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  const refused = await limitLinkPreview(request);
  if (refused !== null) return refused;
  const { userId } = await params;
  return renderCard(playbookProfileCopy(await profileCardFor(segment(userId))), PLAYBOOK_CACHE_CONTROL);
}
