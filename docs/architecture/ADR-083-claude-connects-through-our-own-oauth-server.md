# ADR-083: Claude connects through our own OAuth server, every API secret is an HMAC, and registration is open

**Status:** **Accepted — 2026-10-27.** Mitchell answered M55's eleven decisions at scoping; D7
(open registration), D8's hashing, D10 and D11 changed from the recommendation. Not built yet:
M55's parts 1–5 build it (`docs/plans/2026-10-27-M55-claude-connects-as-you.md`).
**Amended 2026-10-27**, the same day, after Mitchell asked for an independent check of the
cryptography and the OAuth design against primary sources (*Independent review, 2026-10-27*,
below). He approved every change it proposed. Each change is marked in place with its letter
(P1-a to P1-c for part 1, A to L for the authorization server and the MCP server) and its source.
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
(PKCE S256, a client metadata document or dynamic client registration, rotating refresh tokens).
MCP's 2026-07-28 revision deprecates dynamic client registration in favour of Client ID Metadata
Documents: a client tries a pre-registered id, then a CIMD, then DCR (amendment E).

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
   foreign keys** (ADR-025). Every table that holds a digest also holds the `key_version` it was
   made under (§2, amendment P1-a), and so does `api_tokens`:
   - `oauth_clients`: id, `client_name`, `redirect_uris text[]`, `kind` (`cimd` | `dcr`), the CIMD
     URL for a `cimd` client, `registered_ip_hash`, `created_at`, `first_used_at`.
   - `oauth_grants`: id, `owner_id`, `client_id`, `client_name` (a snapshot, so Connected apps
     can still name a grant after its client expires), `redirect_uri`, `scopes text[]`, `resource`, `created_at`,
     `last_used_at` (coarse, as `api_tokens`), `expires_at` (created + 365 days), `revoked_at`,
     `revoked_reason` (`owner` | `code-reuse` | `refresh-reuse`).
   - `oauth_codes`: `code_hash`, `key_version`, `grant_id`, `code_challenge` (**not null**:
     amendment I), `redirect_uri`, `resource`, `expires_at`, `used_at`.
   - `oauth_tokens`: `token_hash`, `key_version`, `grant_id`, `kind` (`access` | `refresh`),
     `expires_at`, `rotated_at`, `revoked_at`.

   Nothing is swept. Expiry, revocation and the grant's own state are resolved on read, so a
   refused secret can always say why (the `api_tokens` and `entitlement_grants` rule). A hosted
   identity provider was refused (a vendor, a second user directory, a sign-in page that is not
   ours). `oauth4webapi` is a client library and does not supply authorization-server checks; the
   checks here are small and tested against each RFC's error codes. The MCP side uses
   `@modelcontextprotocol/sdk`.
2. **Every API secret is an HMAC, through one helper.** `server/secrets/keyedDigest.ts` exports
   `keyedDigest(secret)` = `HMAC-SHA256(K, secret)`, hex, and `digestsMatch(a, b)`
   (`timingSafeEqual`). `K` is derived from the pepper with HKDF-SHA256 and a fixed `info` label
   (`"caesura api secret digest v1"`), which binds the derived key to this one use (RFC 5869 §3;
   the review found this sound). API tokens, access tokens, refresh tokens and authorization codes
   all use it.
   - **The pepper is versioned (amendment P1-a).** A digest that records no key version makes a
     pepper rotation a mass logout. So `API_TOKEN_PEPPER` is the current key and
     `API_TOKEN_PEPPER_PREVIOUS` an optional previous one; every row stores the `key_version` it
     was minted under; a secret is minted under the current key and looked up under the current
     key, then the previous one (GitLab's `sha256_candidates`, `lib/gitlab/crypto_helper.rb`). A
     rotation moves the old value to `_PREVIOUS`; dropping `_PREVIOUS` once no live row carries its
     version finishes it. Rotating with no `_PREVIOUS` still logs everyone out, which is the
     emergency path.
   - **A short pepper is refused (amendment P1-b).** `pepper()` refuses a value under 32 bytes, not
     only an empty one, with `ApiTokenPepperTooShortError` (an empty one still throws `ApiTokenPepperMissingError`).
   - **Why a fast keyed hash, not scrypt.** NIST SP 800-63B §5.1.2.2: look-up secrets with at least
     112 bits of entropy *"SHALL be hashed with an approved one-way function"*; the slow,
     salted, memory-hard rule is for memorised secrets, which these are not. OWASP's Password
     Storage cheat sheet scopes its slow hashes to passwords the same way, and GitLab stores its
     tokens as a keyed SHA-256 (`token_digest`). The input is 32 random bytes (256 bits), which no
     work factor makes more or less guessable; scrypt's 37ms would be paid on every request and
     again on every refresh for no gain.
   - **The CodeQL alert is a known false positive.** `js/insufficient-password-hash` decides what
     is a password by the variable's name: `SensitiveDataHeuristics.qll` matches `oauth` and
     `api.?(key|tok)`, so it flags `keyedDigest`'s callers whatever they hash. It is dismissed as a
     false positive in code scanning, citing this item, every time it is raised.
3. **Every `tc_` token that exists today is revoked, not upgraded on use.** Migration `0069` adds
   `api_tokens.revoked_reason` and sets `revoked_at = now()`, `revoked_reason = 'storage-changed'`
   on every row whose `revoked_at` is null. The verify path then:
   - looks the secret up by its HMAC (every token minted after part 1);
   - **on a miss only**, looks for a row with the secret's stored 8-character `prefix` and
     `revoked_reason = 'storage-changed'`, and confirms it with one scrypt verify per candidate pepper (two while `API_TOKEN_PEPPER_PREVIOUS` is set) of that single
     row, read with `LIMIT 1` and verified with the async `scrypt`, never `scryptSync`
     (amendment P1-c: the prefix is shown in the UI, so a known prefix would otherwise let anyone
     block the event loop ~37ms per matching row before any rate limit applies). A match answers
     `token-revoked` with *"This token was revoked when token storage changed
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
   - **Single use is one atomic statement (amendment D).** A code is redeemed by
     `UPDATE oauth_codes SET used_at = now() WHERE code_hash = $1 AND used_at IS NULL RETURNING …`,
     and a refresh token is rotated by the same shape on `rotated_at`. No row back means it was
     already used, which takes the reuse path and revokes the grant. A read-then-write would let
     two parallel requests both succeed; the review named these races the most error-prone part of
     a hand-rolled server.
   - **Rotation can strand a client (amendment K).** If the token response carrying the new
     refresh token is lost, the client's next refresh presents the rotated-away one, which revokes
     the grant. There is no grace window: an occasional re-consent is the expected cost.
5. **The endpoints.**
   - `GET /.well-known/oauth-protected-resource` and `/.well-known/oauth-protected-resource/api/mcp`
     (RFC 9728): `resource` = `<origin>/api/mcp`, exactly; `authorization_servers` = `[<origin>]`;
     `scopes_supported`; `bearer_methods_supported: ["header"]`.
   - `GET /.well-known/oauth-authorization-server` (RFC 8414): `issuer`, the four endpoints,
     `response_types_supported: ["code"]`, `grant_types_supported: ["authorization_code",
     "refresh_token"]`, `code_challenge_methods_supported: ["S256"]`,
     `token_endpoint_auth_methods_supported: ["none"]`,
     `client_id_metadata_document_supported: true` (amendment E),
     `authorization_response_iss_parameter_supported: true` (amendment A), `scopes_supported` with
     `offline_access`.
   - `POST /api/oauth/register` (RFC 7591, JSON), `POST /api/oauth/token` (form-encoded),
     `POST /api/oauth/revoke` (RFC 7009, always 200).
   - `/oauth/authorize`, a page (§6).
   - **`iss` on every authorization response (amendment A).** Every redirect back to the client,
     a code or an error, carries `iss=<issuer>` (OAuth 2.1 §4.1.2, REQUIRED; MCP 2026-07-28,
     SHOULD), so a client talking to two servers cannot be handed one's code as the other's.
   - **The issuer and the resource come from configuration, never the `Host` header (amendment
     B).** Both are built from `deploymentOrigin()` (`web/lib/deploymentOrigin.ts`): the production
     domain in production, the branch alias on a preview. *This replaces "the origin is the
     request's own"*: a request with a forged `Host` must not be able to make us publish, or accept
     tokens for, an issuer of its choosing.
   - **`resource` is pinned (amendment C).** At authorize and at the token endpoint, a `resource`
     other than `mcpResource()` is refused with `invalid_target` (RFC 8707 §2), and the grant
     stores the one it was given.
   Each answers well inside Claude's 10-second budget: no external call except a CIMD fetch, which
   has its own 5-second timeout.
6. **Registration is open, CIMD first and DCR as the fallback, and the consent page carries the
   defence** (Mitchell, D7; amendment E). **CIMD is the primary path:** a `client_id` that is an
   `https` URL is a client metadata document, fetched at authorize (MCP 2026-07-28 deprecates DCR
   and puts CIMD ahead of it in the client's order). **Open DCR stays as the fallback**, to any
   HTTPS redirect, because Mitchell wants any website to be able to connect and older clients only
   register. Threat review:
   - **A look-alike client phishes consent.** Anyone can register `client_name: "Claude"` with
     their own redirect, or point a CIMD at a document of their own. The consent page therefore
     shows the name **as the client's own claim** (*"An app calling itself "Claude""*, marked
     *unverified*), the **redirect host** in large type as the place the person is about to send
     access to (MCP: *"MUST clearly display the redirect URI hostname"*), and, for a CIMD client,
     the **`client_id` host** as well (amendment G; the CIMD draft §6: *"SHOULD display the
     hostname of the client_id"*). **Only a redirect that is exactly
     `https://claude.ai/api/mcp/auth_callback` is shown as recognised: Claude** (amendment F). The
     list is a constant in `server/oauth/recognised.ts`, not data. The default scopes exclude
     notebook writes, and nothing the connector can do deletes anything (D4), which bounds what a
     phished grant can do.
   - **A loopback redirect gets the localhost warning, never "recognised" (amendment F).** MCP
     warns that an attacker can present a legitimate CIMD URL, Claude Code's
     `https://claude.ai/oauth/claude-code-client-metadata` included, with a localhost port of
     their own, and says a server *"SHOULD display additional warnings for localhost-only redirect
     URIs"*. So a client whose redirect is loopback, Claude Code's CIMD included, is shown with a
     warning that access goes to a program on this computer and to continue only if the person
     started the connection themselves. *This replaces recognising Claude Code's CIMD.*
   - **Open redirect.** A redirect URI is matched **exactly** against the registered list, as a
     string, at authorize and at token exchange, with no normalisation: a difference in case,
     a trailing slash, percent-encoding or a default port is a mismatch. The one exception is a
     loopback URI (`http://localhost`, `http://127.0.0.1` or `http://[::1]`, amendment H), whose
     port is ignored (RFC 8252 §7.3; OAuth 2.1 calls `localhost` NOT RECOMMENDED, and it is kept
     for the clients that use it). No wildcards, no prefix match. An error before the redirect is
     proven (unknown client, a CIMD that does not fetch or validate, mismatched redirect) is shown
     on our page and never redirected; only after the redirect is proven does an error go back to
     the client, with `state` and `iss`. **Even then, only a recognised redirect is followed
     automatically (amendment M).** Registration is open, so a proven redirect can still be an
     attacker's own site, and bouncing a signed-in visitor there with no click is the open
     redirect RFC 9700 §4.11.2 names. An error for any other client is shown on our page with a
     link to the client's redirect (carrying `error`, `state` and `iss`), which the person
     follows or not. A successful Allow still redirects, because the person chose it on the
     consent page.
   - **PKCE downgrade (amendment I).** Authorize refuses a request with no `code_challenge` or a
     method other than `S256` before any code exists, so every code row has a challenge. The
     token endpoint refuses a code exchange with no `code_verifier`, and a `code_verifier`
     presented for a code that had no challenge, with `invalid_grant` (OWASP OAuth 2.0 cheat
     sheet), so a code can never be redeemed without the proof it was issued against.
   - **No `http` except loopback, no fragments.** Registration refuses `http:` on any other host,
     any URI with a `#`, and any URI that does not parse. `invalid_redirect_uri`.
   - **Registration abuse.** DCR is rate-limited per client IP (`quota.ts`, keyed on a hash of the
     IP Vercel reports), and a DCR client with no grant 24 hours after it registered has expired:
     authorize refuses it (`invalid_client`), read from `first_used_at`, never deleted.
   - **CIMD is a server-side fetch of a stranger's URL (amendment J).** It goes through ADR-081's
     guarded fetcher (`guardedHttpsFetcher`, `server/external/remoteImage/fetchImage.ts`), which
     **pins the resolved address**: the socket connects to the address the guard checked
     (`guardedLookup`), so a rebinding DNS answer cannot swap a public address for a private one
     between the check and the connect. It refuses every special-use address (RFC 6890,
     `guard.ts`), takes `https` only, follows no redirect it has not re-checked, **caps the read at
     5 KB** (not the image fetch's 10 MB) and times out at 5 seconds. The document's `client_id`
     must equal its URL, and its `redirect_uris` follow the same rules as DCR's. **`logo_uri` and
     `jwks_uri` are never fetched**, from a CIMD or a DCR body: the consent page shows no logo, and
     there are no confidential clients to need keys.
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
   `tco_` token only inside it; anywhere else it answers 401. **And on every MCP call the grant's
   stored `resource` is compared to this server's `mcpResource()`** (amendment C), so the audience
   is checked against the token's own record, not only inferred from where the call arrived. Every refusal of an OAuth credential
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
   **Which MCP revision (amendment L).** MCP 2026-07-28 adds required `Mcp-Method` and `Mcp-Name`
   request headers and a `CacheableResult`. Part 4 checks which revision the pinned
   `@modelcontextprotocol/sdk` targets and records it here; if the SDK predates 2026-07-28, the
   route still accepts both header forms and the gap is a known issue.
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
- A pepper rotation after that is no longer a mass logout (P1-a): `API_TOKEN_PEPPER_PREVIOUS` is
  one more optional secret variable, which the original §2 avoided.
- A client whose refresh response is lost re-consents (K).
- `v1` verification drops from ~37ms of CPU per request to under a microsecond.
- Anyone can create a client and show a person our consent page. The page, not an allowlist, is
  the control, which is why its wording, the recognised-client marking and the localhost warning
  are gate items. Claude Code is never shown as recognised, only warned about, because its
  redirect is loopback (F).
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
- **Dropping DCR because MCP deprecated it.** It shuts out any client that only registers, and
  Mitchell wants any website to connect (E).
- **Recognising Claude Code's CIMD with a loopback redirect.** Anyone can present that CIMD URL
  with their own port (F).
- **Deriving the issuer from the request's origin.** A `Host` header is the requester's to choose
  (B).
- **A grace window for a rotated-away refresh token.** It reopens the reuse that rotation exists
  to detect (K).

## Independent review, 2026-10-27

Mitchell asked for an independent check of the cryptography before part 1 merged. It read primary
sources and found the design sound in its hashing (HMAC-SHA256 with a pepper for 256-bit random
secrets), its key derivation (HKDF with a fixed label) and most of its OAuth (S256-only PKCE, a
one-minute single-use code whose reuse revokes the grant, refresh rotation with reuse detection,
one-hour opaque access tokens, exact redirect matching with loopback port variance, RFC 8707). It
proposed P1-a to P1-c and A to L above; Mitchell approved all of them on 2026-10-27.
Amendment M (errors auto-redirect only to a recognised redirect) came from part 2's fresh-pass
review the same day; Mitchell approved it on 2026-10-27. The pieces it
called most error-prone in a hand-rolled server, and which part 2's tests therefore name one by
one: single-use and rotation races, redirect matching and normalisation, PKCE downgrade, errors
redirected before the redirect is validated, issuer and audience confusion, and CIMD SSRF.

Sources:
- NIST SP 800-63B §5.1.2.2, `https://pages.nist.gov/800-63-3/sp800-63b.html#sec5`
- OWASP Password Storage cheat sheet; OWASP OAuth 2.0 cheat sheet (`cheatsheetseries.owasp.org`)
- CodeQL `js/insufficient-password-hash` help, and `shared/concepts/codeql/concepts/internal/SensitiveDataHeuristics.qll` (`github/codeql`)
- GitLab `lib/gitlab/crypto_helper.rb` (`token_digest`, `sha256_candidates`)
- RFC 5869 §3 (HKDF); RFC 6890; RFC 7009; RFC 7591; RFC 8252 §7.3; RFC 8414; RFC 8707; RFC 9728
- OAuth 2.1 draft (`draft-ietf-oauth-v2-1`), §4.1.2, §4.3.1, §7.5.3, §8.4.2
- RFC 9700 (OAuth security BCP), cited from knowledge, not fetched
- MCP authorization, `modelcontextprotocol.io/specification/2025-11-25/basic/authorization`, and
  the 2026-07-28 changelog
- OAuth Client ID Metadata Document draft (`draft-ietf-oauth-client-id-metadata-document`), §6

Several were read through GitHub mirrors because the session's proxy refused rfc-editor.org,
datatracker.ietf.org, modelcontextprotocol.io and owasp.org.
