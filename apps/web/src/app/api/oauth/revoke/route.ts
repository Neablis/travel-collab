import { handlerFailed, oauthError, oauthJson, preflight } from "@/server/oauth/errors";
import { revokeSecret } from "@/server/oauth/tokens";

// **RFC 7009 revocation: `POST /api/oauth/revoke`.** Always 200, whatever was
// sent (§2.2): an unknown token is already not a token, and a different answer
// for one would tell a caller which secrets exist. The one refusal is a Personal
// Agent (`private_key_jwt`) naming itself without proving it (Poppy 4.6): 401.
// A throw (the store down) is the other exception: 500 `server_error`, not 200,
// since a revocation that did not happen must not be answered as done.

/** Revoke an access or refresh token; 200 whatever was sent, unless the handler throws (500). */
export async function POST(request: Request) {
  try {
    return await revoke(request);
  } catch (error) {
    return handlerFailed("revoke", error);
  }
}

async function revoke(request: Request): Promise<Response> {
  const form = new URLSearchParams(await request.text().catch(() => ""));
  const token = form.get("token");
  if (token !== null) {
    const outcome = await revokeSecret(token, new Date(), {
      clientId: form.get("client_id") ?? undefined,
      clientAssertion: form.get("client_assertion") ?? undefined,
      clientAssertionType: form.get("client_assertion_type") ?? undefined,
    });
    if (!outcome.ok) return oauthError(outcome.error, outcome.description, 401);
  }
  return oauthJson({});
}

export const OPTIONS = preflight;
