import { auth } from "@/server/auth";
import { revokeGrant } from "@/server/oauth/grants";

// Disconnect: session-only for the parent route's reason, and not gated on the
// entitlement, so a lapsed account can still cut an app off. Revoking the grant
// stops its refresh and access tokens on their next read (ADR-083 §1).

/** Disconnects one of the signed-in person's apps: 204, or 404 for a grant that is not theirs. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ grantId: string }> }) {
  const session = await auth();
  const userId = session?.user?.id;
  if (userId === undefined) return Response.json({ error: "unauthenticated" }, { status: 401 });

  const { grantId } = await params;
  // `revokeGrant` knows only this owner's grants, so a stranger's id reads as
  // none. Already disconnected answers as the first time did: a double-click
  // must not produce a scary error.
  if (!(await revokeGrant(userId, grantId, "owner"))) return Response.json({ error: "not-found" }, { status: 404 });
  return new Response(null, { status: 204 });
}
