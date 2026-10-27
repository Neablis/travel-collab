import { oauthError, oauthJson, preflight } from "@/server/oauth/errors";
import { exchangeCode, refresh } from "@/server/oauth/tokens";

// **The token endpoint: `POST /api/oauth/token`** (RFC 6749 §3.2). Form-encoded
// only, as the RFC requires, and public clients only: a `client_id` and no
// secret. Every check lives in `server/oauth/tokens.ts`; this reads the form.

/** Exchange a code or a refresh token for a new access and refresh token pair. */
export async function POST(request: Request) {
  const type = request.headers.get("content-type") ?? "";
  if (!type.toLowerCase().startsWith("application/x-www-form-urlencoded")) {
    return oauthError("invalid_request", "the body must be application/x-www-form-urlencoded");
  }
  const form = new URLSearchParams(await request.text());
  // RFC 6749 §3.2: a parameter must not appear twice.
  const names = [...form.keys()];
  if (new Set(names).size !== names.length) return oauthError("invalid_request", "a parameter is repeated");
  const field = (name: string) => form.get(name) ?? undefined;

  const grantType = field("grant_type");
  if (grantType === undefined) return oauthError("invalid_request", "grant_type is required");
  const outcome =
    grantType === "authorization_code"
      ? await exchangeCode({
          code: field("code"),
          codeVerifier: field("code_verifier"),
          redirectUri: field("redirect_uri"),
          clientId: field("client_id"),
          resource: field("resource"),
        })
      : grantType === "refresh_token"
        ? await refresh({ refreshToken: field("refresh_token"), clientId: field("client_id"), resource: field("resource") })
        : null;
  if (outcome === null) return oauthError("unsupported_grant_type", "only authorization_code and refresh_token");
  return outcome.ok ? oauthJson(outcome.body) : oauthError(outcome.error, outcome.description);
}

export const OPTIONS = preflight;
