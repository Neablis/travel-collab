import type { ConnectedApp } from "@tc/contracts";
import { auth } from "@/server/auth";
import { grantScopes, listGrants, type GrantRow } from "@/server/oauth/grants";
import { consentMarking } from "@/server/oauth/recognised";

// **Account → Connected apps is session-only, as `account/tokens` is** (M55
// D10). A connected app's own access token must not be able to read what else
// its owner has connected, or disconnect them; the route reads the session and
// never a bearer, and `exposure.ts` keeps `listGrants` off the public side.
//
// **Not gated on the entitlement**: a lapsed account must still see, and cut
// off, the apps it connected (the token list's rule).

function toConnectedApp(grant: GrantRow): ConnectedApp {
  return {
    grantId: grant.id,
    clientName: grant.clientName,
    redirectHost: new URL(grant.redirectUri).host,
    recognised: consentMarking(grant.redirectUri) === "recognised",
    scopes: grantScopes(grant),
    createdAt: grant.createdAt.toISOString(),
    lastUsedAt: grant.lastUsedAt?.toISOString() ?? null,
    expiresAt: grant.expiresAt.toISOString(),
    revokedAt: grant.revokedAt?.toISOString() ?? null,
    revokedReason: grant.revokedReason ?? null,
  };
}

export async function GET(_request: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (userId === undefined) return Response.json({ error: "unauthenticated" }, { status: 401 });
  return Response.json({ apps: (await listGrants(userId)).map(toConnectedApp) });
}
