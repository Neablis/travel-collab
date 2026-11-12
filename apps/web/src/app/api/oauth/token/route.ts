import { clientIp } from "@/server/og/limit";
import { oauthError, oauthJson, preflight, handlerFailed } from "@/server/oauth/errors";
import { exchangeCode, refresh } from "@/server/oauth/tokens";

// **The token endpoint: `POST /api/oauth/token`** (RFC 6749 §3.2). Form-encoded
// only, as the RFC requires. A public client sends a `client_id`; a Personal
// Agent (`private_key_jwt`, Poppy 4.1) adds its `client_assertion`. Every check
// lives in `server/oauth/tokens.ts`; this reads the form.

/** Exchange a code or a refresh token for a new access and refresh token pair. */
export async function POST(request: Request) {
  try {
    return await exchange(request);
  } catch (error) {
    return handlerFailed("token", error);
  }
}

async function exchange(request: Request): Promise<Response> {
  const type = request.headers.get("content-type") ?? "";
  if (!type.toLowerCase().startsWith("application/x-www-form-urlencoded")) {
    return oauthError("invalid_request", "the body must be application/x-www-form-urlencoded");
  }
  const form = new URLSearchParams(await request.text());
  // RFC 6749 §3.2: a parameter must not appear twice.
  const names = [...form.keys()];
  if (new Set(names).size !== names.length) return oauthError("invalid_request", "a parameter is repeated");
  const field = (name: string) => form.get(name) ?? undefined;
  const credentials = {
    clientId: field("client_id"),
    clientAssertion: field("client_assertion"),
    clientAssertionType: field("client_assertion_type"),
    callerIp: clientIp(request),
  };

  const grantType = field("grant_type");
  if (grantType === undefined) return oauthError("invalid_request", "grant_type is required");
  const outcome =
    grantType === "authorization_code"
      ? await exchangeCode({
          code: field("code"),
          codeVerifier: field("code_verifier"),
          redirectUri: field("redirect_uri"),
          resource: field("resource"),
          ...credentials,
        })
      : grantType === "refresh_token"
        ? await refresh({ refreshToken: field("refresh_token"), resource: field("resource"), scope: field("scope"), ...credentials })
        : null;
  if (outcome === null) return oauthError("unsupported_grant_type", "only authorization_code and refresh_token");
  if (outcome.ok) return oauthJson(outcome.body);
  // RFC 6749 5.2: a failed client authentication is a 401.
  return oauthError(outcome.error, outcome.description, outcome.error === "invalid_client" ? 401 : 400);
}

export const OPTIONS = preflight;
