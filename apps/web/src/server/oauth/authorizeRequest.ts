import { API_SCOPES, ApiScope } from "@tc/contracts";
import { resolveClient, type ClientDeps, type OAuthClient } from "./clients";
import { mcpResource, OAUTH_SCOPES, oauthIssuer } from "./metadata";
import { isS256Challenge } from "./pkce";
import { consentMarking, type ConsentMarking } from "./recognised";
import { redirectMatches } from "./redirects";

// **An authorize request, checked in the order that keeps errors home**
// (ADR-083 §6, *Open redirect*; OAuth 2.1 §4.1.2.1).
//
// Until the client and its redirect are proven, an error is shown on our own
// page and never redirected: redirecting it would send the person, with our
// name on the request, to whatever URL the request named. Only after that does
// an error go back to the client, and every answer that goes back, error or
// code, carries `state` and `iss` (amendment A).

/** A request the consent page may show, and the consent decision re-checks. */
export interface AuthorizeRequest {
  client: OAuthClient;
  /** As presented, which for a loopback client may differ from the registered one in its port. */
  redirectUri: string;
  /** What the client asked for, as v1 scopes. `offline_access` is accepted and dropped: every grant can refresh. */
  scopes: ApiScope[];
  state: string | null;
  codeChallenge: string;
  resource: string;
  marking: ConsentMarking;
}

/** Shown on our page; never sent to the client. */
export interface ShownRefusal {
  error: "invalid_request" | "invalid_client" | "invalid_redirect_uri";
  description: string;
}

export type ParsedAuthorize = { request: AuthorizeRequest } | { show: ShownRefusal } | { redirectTo: string };

/** The query as Next hands it over: a repeated parameter arrives as an array. */
export type AuthorizeParams = Record<string, string | string[] | undefined>;

/**
 * The URL that answers the client: `params`, then `state` when it sent one and
 * `iss` always. The one way a redirect back is built, so none can leave
 * without them.
 */
export function redirectBack(redirectUri: string, state: string | null, params: Record<string, string>): string {
  const url = new URL(redirectUri);
  for (const [name, value] of Object.entries(params)) url.searchParams.append(name, value);
  if (state !== null) url.searchParams.append("state", state);
  url.searchParams.append("iss", oauthIssuer());
  return url.toString();
}

const show = (error: ShownRefusal["error"], description: string): ParsedAuthorize => ({ show: { error, description } });

export async function parseAuthorizeRequest(raw: AuthorizeParams, deps: ClientDeps = {}): Promise<ParsedAuthorize> {
  // RFC 6749 §3.1: a parameter sent twice is an invalid request, and until the
  // redirect is proven we cannot know which redirect_uri to believe.
  const repeated = Object.entries(raw).find(([, value]) => Array.isArray(value));
  if (repeated !== undefined) return show("invalid_request", `${repeated[0]} is repeated`);
  const param = (name: string): string | undefined => {
    const value = raw[name];
    return typeof value === "string" && value !== "" ? value : undefined;
  };

  // ── Before the redirect is proven: shown, never redirected ─────────────
  const clientId = param("client_id");
  if (clientId === undefined) return show("invalid_request", "client_id is missing");
  const resolved = await resolveClient(clientId, deps);
  if (!resolved.ok) {
    return resolved.reason === "invalid-metadata-document"
      ? show("invalid_client", "the app's metadata document could not be read or is not valid")
      : show("invalid_client", resolved.reason === "expired-client" ? "this app's registration has expired" : "unknown app");
  }
  const { client } = resolved;
  const redirectUri = param("redirect_uri");
  if (redirectUri === undefined) return show("invalid_request", "redirect_uri is missing");
  if (!client.redirectUris.some((registered) => redirectMatches(registered, redirectUri))) {
    return show("invalid_redirect_uri", "redirect_uri is not one this app registered");
  }

  // ── The redirect is proven: errors go back to the client ───────────────
  const state = param("state") ?? null;
  const back = (error: string, description: string): ParsedAuthorize => ({
    redirectTo: redirectBack(redirectUri, state, { error, error_description: description }),
  });
  if (param("response_type") !== "code") return back("unsupported_response_type", "response_type must be code");
  // Amendment I: no challenge, or any method but S256, is refused before a code exists.
  const codeChallenge = param("code_challenge");
  if (codeChallenge === undefined || !isS256Challenge(codeChallenge)) {
    return back("invalid_request", "an S256 code_challenge is required");
  }
  if (param("code_challenge_method") !== "S256") return back("invalid_request", "code_challenge_method must be S256");
  const requested = param("scope")?.split(" ").filter(Boolean);
  if (requested !== undefined && requested.some((scope) => !OAUTH_SCOPES.includes(scope))) {
    return back("invalid_scope", "a requested scope is not offered here");
  }
  const scopes =
    requested === undefined
      ? [...API_SCOPES]
      : requested.filter((scope): scope is ApiScope => ApiScope.safeParse(scope).success);
  if (scopes.length === 0) return back("invalid_scope", "no scope this server grants was requested");
  // Amendment C: the one audience here. Absent is taken as it, since an older
  // client sends none and there is no other resource it could mean.
  const resource = param("resource") ?? mcpResource();
  if (resource !== mcpResource()) return back("invalid_target", `the only resource here is ${mcpResource()}`);

  return {
    request: { client, redirectUri, scopes, state, codeChallenge, resource, marking: consentMarking(redirectUri) },
  };
}
