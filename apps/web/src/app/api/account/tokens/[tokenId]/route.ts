import { auth } from "@/server/auth";
import { revokeToken } from "@/server/api-tokens";

// Revoking is session-only for the same reason minting is — see the parent
// route. A token that could revoke tokens could lock its owner out of their own
// account's credentials.

export async function DELETE(_request: Request, { params }: { params: Promise<{ tokenId: string }> }) {
  const session = await auth();
  const userId = session?.user?.id;
  if (userId === undefined) return Response.json({ error: "unauthenticated" }, { status: 401 });

  const { tokenId } = await params;
  // **Not gated on the entitlement**, deliberately: a lapsed account must still
  // be able to revoke. Taking away someone's ability to switch off a live
  // credential because they stopped paying is indefensible.
  const revoked = await revokeToken(userId, tokenId);
  if (!revoked.ok) return Response.json({ error: "not-found" }, { status: 404 });
  // Already-revoked answers ok rather than 404 — `revokeShare`'s rule, so a
  // double-click cannot produce a scary error.
  return Response.json({ token: revoked.token });
}
