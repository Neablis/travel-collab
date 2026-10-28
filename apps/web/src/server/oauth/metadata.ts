import { API_SCOPES } from "@tc/contracts";
import { deploymentOrigin } from "@/lib/deploymentOrigin";

// **What this authorization server says about itself** (ADR-083 §5): RFC 9728's
// protected-resource document and RFC 8414's authorization-server document.
//
// **The issuer and the resource come from configuration, never the request
// (amendment B).** A `Host` header is the requester's to choose; built from it,
// a forged one would make us publish, and later accept tokens for, an issuer of
// the requester's choosing. Nothing here takes a request.

/**
 * Every scope a client may ask for: the v1 scopes the connector's tools carry,
 * and `offline_access`, which some clients send to ask for a refresh token.
 * Every grant gets one regardless, so it is accepted and never stored.
 */
export const OAUTH_SCOPES: readonly string[] = [...API_SCOPES, "offline_access"];

/** The issuer every authorization response's `iss` and the metadata name. */
export function oauthIssuer(): string {
  return deploymentOrigin();
}

/** The RFC 8707 audience of every grant: the MCP endpoint, exactly. */
export function mcpResource(): string {
  return `${deploymentOrigin()}/api/mcp`;
}

/** RFC 9728: where a client learns which server issues tokens for `/api/mcp`. */
export function protectedResourceMetadata() {
  return {
    resource: mcpResource(),
    authorization_servers: [oauthIssuer()],
    scopes_supported: OAUTH_SCOPES,
    bearer_methods_supported: ["header"],
  };
}

/** RFC 8414: the endpoints and the only methods this server takes. */
export function authorizationServerMetadata() {
  const issuer = oauthIssuer();
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/api/oauth/token`,
    registration_endpoint: `${issuer}/api/oauth/register`,
    revocation_endpoint: `${issuer}/api/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    // S256 alone: `plain` would hand the verifier to anyone who saw the request.
    code_challenge_methods_supported: ["S256"],
    // Public clients only; there is no secret to authenticate with.
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    // Amendment E: a client's metadata document is the first way in, DCR the fallback.
    client_id_metadata_document_supported: true,
    // Amendment A: every redirect back carries `iss`.
    authorization_response_iss_parameter_supported: true,
    scopes_supported: OAUTH_SCOPES,
  };
}
