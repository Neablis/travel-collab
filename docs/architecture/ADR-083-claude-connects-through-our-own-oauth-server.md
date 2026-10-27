# ADR-083: Claude connects through our own OAuth server, every API secret is an HMAC, and registration is open

**Status:** **Accepted — 2026-10-27.** Mitchell answered M55's eleven decisions at scoping; D7
(open registration), D8's hashing, D10 and D11 changed from the recommendation. Not built yet:
M55's parts 1–6 build it (`docs/plans/2026-10-27-M55-claude-connects-as-you.md`).
**Deciders:** Mitchell (product); Claude — drafted
Related: ADR-024, ADR-025, ADR-034 (sign-in), ADR-045 (entitlements), ADR-051 (idempotency keys),
ADR-081 (the guarded fetcher), M22 (the public API and tokens), M55
(`docs/milestones/M55-claude-connects-as-you.md`).

## Context

M22's public API takes one kind of bearer credential: a `tc_…` token minted in Account → Profile →
API tokens and pasted into whatever calls the API (`server/api-tokens/index.ts`,
`server/public-api/actor.ts`). Mitchell wants a daily Claude routine to research a destination
and publish a Playbook. A routine has nowhere safe to keep a pasted secret. Claude's answer is a
custom connector: a remote MCP server that signs the person in through OAuth 2.1 in their browser
(PKCE S256, dynamic client registration or a client metadata document, rotating refresh tokens).

Caesura has no authorization server. Auth.js signs people in with Google and cannot issue
tokens. The v1 wrapper, `route()` (`server/public-api/route.ts:437`), already holds every gate a
caller must pass, and calls `resolveActor` itself (`:478`).

API tokens are stored as `scrypt(secret, API_TOKEN_PEPPER)` with N=16384, about 37ms per verify
(`api-tokens/index.ts:103,152-154`), on the stated reason that a credential store should not argue
with a high-severity scanner finding. M22's own design argued for a fast keyed digest
(`docs/milestones/M22-public-api-and-tokens.md:552-559`), and the column comment still says
`sha256(secret)` (`server/db/schema.ts:250`). An OAuth server verifies a secret on every MCP call
and every refresh, and Claude's token calls must answer within 10 seconds.

## Decision

1. **A small authorization server of our own**, under `apps/web/src/server/oauth/`, with storage
   in our Postgres. Four tables in one migration (`0069`), each owned by `users.id` with **no
   foreign keys** (ADR-025):
   - `oauth_clients`: id, `client_name`, `redirect_uris text[]`, `kind` (`dcr` | `cimd`), the CIMD
     URL for a `cimd` client, `registered_ip_hash`, `created_at`, `first_used_at`.
   - `oauth_grants`: id, `owner_id`, `client_id`, `client_name` (a snapshot, so Connected apps
     can still name a grant after its client expires), `redirect_uri`, `scopes text[]`, `resource`, `created_at`,
     `last_used_at` (coarse, as `api_tokens`), `expires_at` (created + 365 days), `revoked_at`,
     `revoked_reason` (`owner` | `code-reuse` | `refresh-reuse`).
   - `oauth_codes`: `code_hash`, `grant_id`, `code_challenge`, `redirect_uri`, `expires_at`,
     `used_at`.
   - `oauth_tokens`: `token_hash`, `grant_id`, `kind` (`access` | `refresh`), `expires_at`,
     `rotated_at`, `revoked_at`.

   Nothing is swept. Expiry, revocation and the grant's own state are resolved on read, so a
   refused secret can always say why (the `api_tokens` and `entitlement_grants` rule). A hosted
   identity provider was refused (a vendor, a second user directory, a sign-in page that is not
   ours). `oauth4webapi` is a client library and does not supply authorization-server checks; the
   checks here are small and tested against each RFC's error codes. The MCP side uses
   `@modelcontextprotocol/sdk`.
2. **Every API secret is an HMAC, through one helper.** `server/secrets/keyedDigest.ts` exports
   `keyedDigest(secret)` = `HMAC-SHA256(K, secret)`, hex, and `digestsMatch(a, b)`
   (`timingSafeEqual`). `K` is derived from `API_TOKEN_PEPPER` with HKDF-SHA256 and a fixed
   label, so rotating the pepper still invalidates everything at once and no new secret variable
   is needed. API tokens, access tokens, refresh tokens and authorization codes all use it.
   **Why not scrypt:** the input is 32 random bytes, which no work factor makes more or less
   guessable; the 37ms is paid on every request for no gain, and on an OAuth path it would be paid
   again on every refresh. If a scanner raises the old finding again, it is dismissed citing this
   ADR.
3. **Every `tc_` token that exists today is revoked, not upgraded on use.** Migration `0069` adds
   `api_tokens.revoked_reason` and sets `revoked_at = now()`, `revoked_reason = 'storage-changed'`
   on every row whose `revoked_at` is null. The verify path then:
   - looks the secret up by its HMAC (every token minted after part 1);
   - **on a miss only**, looks for a row with the secret's stored 8-character `prefix` and
     `revoked_reason = 'storage-changed'`, and confirms it with one scrypt verify of that single
     row. A match answers `token-revoked` with *"This token was revoked when token storage changed
     on <date>. Mint a new one."* Anything else is `unknown`.
   - The legacy branch and the scrypt import are deleted once every such row's `expires_at` has
     passed (at most 365 days; recorded as a known issue with that date when part 1 merges).
   Upgrading on use was refused by Mitchell: it keeps scrypt on the hot path for a year and leaves
   tokens alive that were minted under the rule this replaces.
4. **Lifetimes.** Access tokens (`tco_`) live 1 hour. Refresh tokens (`tcr_`) rotate on every use
   and live 90 days from their last use, capped at the grant's 365 days. Codes (`tcc_`) live 1
   minute and are single-use. **A second use of a code revokes its grant** (OAuth 2.1 §4.1.3), and
   so does presenting a refresh token that was already rotated away (reuse detection). All
   secrets are opaque random 32 bytes with the prefix, never JWTs: a JWT cannot be revoked before
   it expires, and the v1 route reads Postgres on every request anyway.
5. **The endpoints.**
   - `GET /.well-known/oauth-protected-resource` and `/.well-known/oauth-protected-resource/api/mcp`
     (RFC 9728): `resource` = `<origin>/api/mcp`, exactly; `authorization_servers` = `[<origin>]`;
     `scopes_supported`; `bearer_methods_supported: ["header"]`.
   - `GET /.well-known/oauth-authorization-server` (RFC 8414): `issuer`, the four endpoints,
     `response_types_supported: ["code"]`, `grant_types_supported: ["authorization_code",
     "refresh_token"]`, `code_challenge_methods_supported: ["S256"]`,
     `token_endpoint_auth_methods_supported: ["none"]`,
     `client_id_metadata_document_supported: true`, `scopes_supported` with `offline_access`.
   - `POST /api/oauth/register` (RFC 7591, JSON), `POST /api/oauth/token` (form-encoded),
     `POST /api/oauth/revoke` (RFC 7009, always 200).
   - `/oauth/authorize`, a page (§6).
   The origin is the request's own, so a preview serves documents naming the preview. Each answers
   well inside Claude's 10-second budget: no external call except a CIMD fetch, which has its own
   5-second timeout.
6. **Registration is open, and the consent page carries the defence** (Mitchell, D7). Threat
   review:
   - **A look-alike client phishes consent.** Anyone can register `client_name: "Claude"` with
     their own redirect. The consent page therefore shows the name **as the client's own claim**
     (*"An app calling itself "Claude""*, marked *unverified*), and the **redirect host** in large
     type as the place the person is about to send access to. A client whose redirect is exactly
     `https://claude.ai/api/mcp/auth_callback`, or whose CIMD URL is exactly
     `https://claude.ai/oauth/claude-code-client-metadata`, is shown as **recognised: Claude**
     instead. The list of recognised clients is a constant in `server/oauth/recognised.ts`, not
     data. The default scopes exclude notebook writes, and nothing the connector can do deletes
     anything (D4), which bounds what a phished grant can do.
   - **Open redirect.** A redirect URI is matched **exactly** against the registered list, as a
     string, at authorize and at token exchange. The one exception is a loopback URI
     (`http://localhost` or `http://127.0.0.1`), whose port is ignored (RFC 8252 §7.3). No
     wildcards, no prefix match. An error before the redirect is proven (unknown client, mismatched
     redirect) is shown on our page and never redirected.
   - **No `http` except loopback, no fragments.** Registration refuses `http:` on any other host,
     any URI with a `#`, and any URI that does not parse. `invalid_redirect_uri`.
   - **Registration abuse.** DCR is rate-limited per client IP (`quota.ts`, keyed on a hash of the
     IP Vercel reports), and a DCR client with no grant 24 hours after it registered has expired:
     authorize refuses it (`invalid_client`), read from `first_used_at`, never deleted.
   - **CIMD is a server-side fetch of a stranger's URL.** It goes through ADR-081's guarded fetcher
     (`server/external/remoteImage/guard.ts`'s address checks; `https` only, no private
     addresses, manual redirects, a size cap, a timeout). The document's `client_id` must equal
     its URL, and its `redirect_uris` follow the same rules as DCR's.
   - **CSRF on the consent decision.** The consent page posts its decision with `fetch` to
     `POST /api/oauth/authorize` (same-origin `Origin` check, the session cookie is `SameSite=Lax`),
     which re-validates every parameter and answers `{ redirectTo }`; the page then assigns
     `window.location`. A native form POST that 302s to another origin is blocked by the CSP's
     `form-action 'self'` (`next.config.ts:118-123`), which stays.
   - **Signed out.** `/oauth/*` is outside the proxy matcher (`proxy.ts:241-250`), so the page
     itself redirects to `/signin?callbackUrl=<the full authorize URL>`. A free account sees the
     API-tokens upgrade prompt and cannot approve (D6).
   - Out of scope: client secrets, confidential clients, a developer portal, an app directory.
7. **The OAuth actor, and its audience.** `Actor` gains
   `{ userId, via: "oauth", grantId, clientName, scopes, tripIds: null }`. `resolveActor`
   recognises the `tco_` prefix and verifies it against `oauth_tokens` and its grant (live, not
   revoked, owner still entitled to `api.tokens`, resolved per request). **The token's audience is
   the MCP resource (RFC 8707)**, and because tools dispatch through v1's handlers, a `tco_` token
   would otherwise work on a direct `/api/v1` call. So the MCP route runs each dispatch inside an
   `AsyncLocalStorage` context (`server/oauth/dispatchContext.ts`), and `resolveActor` accepts a
   `tco_` token only inside it; anywhere else it answers 401. Every refusal of an OAuth credential
   carries `WWW-Authenticate: Bearer resource_metadata="<origin>/.well-known/oauth-protected-resource/api/mcp"`,
   with `error="invalid_token"` where RFC 6750 says so. The rate limit and the geocode allowance key
   on the grant id; `last_used_at` is touched on the grant.
8. **The MCP server is stateless.** `POST /api/mcp` only, streamable HTTP with JSON responses
   (`enableJsonResponse`), no `Mcp-Session-Id`, no resumable stream, because Vercel functions have
   no sticky routing. `GET` and `DELETE` answer 405. One server instance per request, built for the
   resolved actor. Each tool is a row in `server/mcp/tools.ts` naming its v1 `DeclaredHandler`; its
   input schema is `z.toJSONSchema(def.body ?? def.query, { target: "draft-2020-12", io: "input" })`
   merged with its path parameters; a call builds a synthetic `Request` with the same bearer and
   calls the handler. The v1 error envelope becomes a tool result with `isError: true` and the
   envelope's message; a credential refusal is an HTTP 401 on the MCP response itself, so Claude
   refreshes. `create_playbook`'s `Idempotency-Key` is `mcp-<grantId>-<sha256(canonicalJson(input))>`.
9. **The exposure ledger gains a status for a public route outside `v1/`:**
   `{ status: "front-door"; why: string; adapts?: "v1" }`. `mcp` is a front door that adapts
   `v1` (`adapts: "v1"`); `oauth/register`, `oauth/token`, `oauth/revoke` and `oauth/authorize`
   (the consent decision) are front doors that carry no data. `exposure.test.ts`'s check 3 also
   walks `server/mcp/**`, so a tool that imports what a `never` line reaches fails the same way a
   v1 route does. (`server/oauth/**` is not walked: it owns the grant functions those lines
   name.) `account/connected-apps` and its `[grantId]` child are `never`, as `account/tokens` is:
   a credential must not manage credentials.

## Consequences

- Every existing integration's token stops working the day part 1's migration runs. Mitchell
  accepted that; the refusal says what to do, and the API tokens list shows the reason.
- `v1` verification drops from ~37ms of CPU per request to under a microsecond.
- Anyone can create a client and show a person our consent page. The page, not an allowlist, is
  the control, which is why its wording and the recognised-client marking are gate items.
- A connector can do exactly what a token with the same scopes can, through the same handlers, and
  nothing a session can that a token cannot.
- One more credential kind in six places in the v1 wrapper (M55's risk list). The discriminated
  union makes a missed branch a type error in most of them; the plan lists each.
- `SYSTEM-DESIGN.md` §5.5 and §6 describe the API credential; they change when part 1 and part 3
  merge.

## Rejected

- **Upgrading `tc_` tokens to HMAC on first use.** Keeps scrypt on the hot path for up to a year.
- **Keeping scrypt for API tokens and HMAC for OAuth.** Two hashing rules for one kind of secret.
- **A redirect allowlist of Claude's callbacks only** (the original D7). It shuts out Claude
  products whose callbacks are not published, and every other MCP client.
- **JWT access tokens.** Cannot be revoked before they expire.
- **Calling `/api/v1` over HTTP from the MCP route.** Doubles latency and rate spend for no
  isolation gained.
- **Allowlisting Claude's egress range at the firewall.** Trusts a network, not a request.
