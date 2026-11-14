// The JSON answers of the token, registration and revocation endpoints.
//
// `no-store` on every one (RFC 6749 §5.1): a token response cached by anything
// between here and the client is a token handed to the next reader of the cache.
//
// CORS is open on these endpoints and the metadata, because a browser-based
// client (the MCP Inspector) calls them from its own origin. None of them reads
// a cookie, so an open origin grants nothing a direct request could not.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, MCP-Protocol-Version",
} as const;

/** A JSON answer, uncacheable and readable from any origin. */
export function oauthJson(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...CORS } });
}

/** RFC 6749 §5.2's error body: `{ error, error_description }`. */
export function oauthError(code: string, description: string, status = 400): Response {
  return oauthJson({ error: code, error_description: description }, status);
}

/** The answer to a CORS preflight. */
export function preflight(): Response {
  return new Response(null, { status: 204, headers: CORS });
}

/** Metadata: public, and safe to cache briefly, since it only changes with a deploy. */
export function metadataJson(body: unknown): Response {
  return Response.json(body, { headers: { "Cache-Control": "public, max-age=300", ...CORS } });
}

/**
 * The answer when a handler throws: `500 server_error` in RFC 6749 §5.2's JSON
 * shape, never the platform's bare 500 with an empty body, so a client can tell
 * "the server broke" from "my request was wrong" (`invalid_client_metadata`,
 * `invalid_request`). The same answer `/api/v1` and `/api/mcp` give a throw.
 *
 * **No `Retry-After`, and not a 503, on purpose.** A throw is usually not
 * transient (a pending migration, a missing secret, a bug). A retry is safe
 * since KI-2026-11-12-a (the token endpoint spends a code or refresh token in
 * the transaction that stores the new pair), just rarely useful. 503 stays for
 * the quota store being down.
 * Found on production, 2026-11-11 (KI-2026-11-11-a): migration 0075 was
 * pending, every OAuth query threw, and clients got an empty 500.
 */
export function handlerFailed(endpoint: string, error: unknown): Response {
  console.error(`oauth ${endpoint} threw`, { error });
  return oauthError("server_error", "the server could not complete this request", 500);
}
