import { InvitePreview } from "@tc/contracts";
import { auth } from "@/server/auth";
import { previewInvite } from "@/server/access/invites";

const STATUS: Record<string, number> = { "not-found": 404, gone: 410, forbidden: 403, invalid: 400 };

// The one Access read a non-member may perform. Still requires a session: the
// accept screen is behind `middleware.ts`'s matcher, so an unauthenticated
// visitor is sent to /signin?callbackUrl=/invite/<token> and lands back here.
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }
  const { token } = await params;
  const result = await previewInvite(token, session.user.id);
  if (!result.ok) {
    return Response.json({ error: result.error.message }, { status: STATUS[result.error.code] ?? 400 });
  }
  return Response.json({ invite: InvitePreview.parse(result.value) });
}
