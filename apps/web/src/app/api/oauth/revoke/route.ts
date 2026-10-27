import { oauthJson, preflight } from "@/server/oauth/errors";
import { revokeSecret } from "@/server/oauth/tokens";

// **RFC 7009 revocation: `POST /api/oauth/revoke`.** Always 200, whatever was
// sent (§2.2): an unknown token is already not a token, and a different answer
// for one would tell a caller which secrets exist.

/** Revoke an access or refresh token; 200 whatever was sent. */
export async function POST(request: Request) {
  const token = new URLSearchParams(await request.text().catch(() => "")).get("token");
  if (token !== null) await revokeSecret(token);
  return oauthJson({});
}

export const OPTIONS = preflight;
