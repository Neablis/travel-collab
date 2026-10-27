# M55 plan — Claude connects to Caesura as you, and can publish what it plans

Staged while M55 is in flight; deleted in the gate-close commit. Decisions: the milestone file
(`docs/milestones/M55-claude-connects-as-you.md`, *Answered*). Design: ADR-083. Paths are relative
to the repo root; `web/` means `apps/web/src/`. Line numbers are from `main` at `837eef5`.

**Order.** Every part targets `main` and merges on its own; a part that needs an earlier one
branches from `main` only after that one has merged. Part 1 merges first (it owns migration
`0069`; once its merge commit's production deploy is READY, dispatch `migrate-production`, because
`api_tokens.revoked_reason` is read on every v1 request; never before the deploy, or old code can
mint a scrypt token after the `UPDATE`, and never roll back past it — PR 614's review). Part 2 then branches from `main`. Part 3 waits on part 2, part 4 on
part 3. Part 5 waits on part 2 and can be built beside parts 3 and 4, but its e2e spec drives
`/api/mcp`, so it merges after part 4.
Part 0 (`ccr-a54f396f-65ja2i`, prose only) merges last.

| Part | Branch | Theme | Waits on | Files (approx.) |
|---|---|---|---|---|
| 1 | `claude/m55-part1-hmac-storage` | Migration 0069, one HMAC helper, `tc_` tokens moved and the old ones revoked | — | 20 |
| 2 | `claude/m55-part2-authorization-server` | Metadata, DCR + CIMD, consent, token, revoke | 1 | 45 |
| 3 | `claude/m55-part3-oauth-actor` | `tco_` resolves to an actor, `via: "oauth"` in six places | 2 | 16 |
| 4 | `claude/m55-part4-mcp-server` | `/api/mcp`, the tools, conformance, the end-to-end flow test | 3 | 20 |
| 5 | `claude/m55-part5-connected-apps` | Connected apps + Disconnect, `/developers`, `llms.txt`, the guideline, the e2e spec | 2 (merge after 4) | 18 |

**The riskiest part is 2** (an authorization server open to any client): it gets the extra fresh
`part-reviewer` pass on its whole diff before it is called ready. Part 1 is second (it revokes
every customer's token): its reviewer checks the migration's `UPDATE` and the legacy refusal.

**Every builder's brief carries the survey's risks** (milestone file, *Risks the plan carries*):
the six credential branches, the `resource_metadata` challenge, the audience binding, the exposure
status, the legacy-token refusal, CIMD through the guarded fetcher. **Parts 1, 2 and 4 also carry
the 2026-10-27 amendment** (ADR-083, *Independent review, 2026-10-27*; Mitchell approved all of
it): P1-a to P1-c in part 1, A to K in part 2, L in part 4. Each row below names its letter.

---

## Part 1 — one way to hash a secret, and the storage

ADR-083 §1–§4. Migration `0069` (confirmed free against `origin/main`: the journal ends at
`0068_cover_source_position`; re-check after merging `main`, and run `db:generate` for a fresh
`when` if `main` moved — KI-2026-09-05-k).

| File | Entry point | Test |
|---|---|---|
| `web/server/secrets/keyedDigest.ts` (new) | `keyedDigest(secret)` = `HMAC-SHA256(HKDF(pepper, "caesura api secret digest v1"), secret)` hex under the current key, with its `keyVersion`; `digestCandidates(secret)`: the digest under `API_TOKEN_PEPPER`, then under `API_TOKEN_PEPPER_PREVIOUS` when set (P1-a); `digestsMatch(a, b)`; `pepper()` refuses a value under 32 bytes as well as an empty one (P1-b); `ApiTokenPepperMissingError` moves here | `web/server/secrets/keyedDigest.test.ts` (stable per key, differs per key, throws without the pepper; a 31-byte pepper throws, 32 does not; a secret minted under the previous key is found once it is `_PREVIOUS`; seen red by swapping HMAC for `sha256`, and by dropping the length check) |
| `web/server/api-tokens/index.ts` | `hashOf` → `keyedDigest` (`:152`), storing `key_version`; `SCRYPT` const and import leave (`:103`); `verifyToken` (`:304`) looks up `token_hash IN digestCandidates(secret)` (P1-a), then the legacy branch; `revokeToken` (`:412`) records `revoked_reason = 'owner'`; `toDto` (`:188`) carries `revokedReason` | `web/server/api-tokens/apiTokens.int.test.ts` (a new token verifies by HMAC; a pepper change with no `_PREVIOUS` still locks out; a pepper rotated into `_PREVIOUS` still verifies; a legacy-shaped row answers `revoked` with `storage-changed`) |
| `web/server/api-tokens/legacyScrypt.ts` (new) | `matchesLegacyToken(secret, row)`: the one verify, with the async `scrypt` (never `scryptSync`), of the one row the prefix query read with `LIMIT 1` (P1-c), kept apart so its deletion is one file | covered by `apiTokens.int.test.ts` (two legacy rows sharing a prefix: one verify, not two; seen red without the `LIMIT 1`) |
| `web/server/api-tokens/apiTokens.retention.test.ts` | still finds no sweeping caller (the migration's `UPDATE` is SQL, not a caller) | itself |
| `web/server/db/schema.ts` | `apiTokens` (`:241`) gains `revokedReason` and `keyVersion` (P1-a), and the `token_hash` comment (`:250`) says HMAC; `oauthCodes` and `oauthTokens` carry `keyVersion` too; new `oauthClients`, `oauthGrants`, `oauthCodes`, `oauthTokens` (ADR-083 §1), unique indexes on each hash, no foreign keys (ADR-025) | — |
| `apps/web/drizzle/0069_oauth_and_hmac_secrets.sql` (+ `meta/0069_snapshot.json`, `meta/_journal.json`) | from `pnpm --filter web db:generate`, then the hand-added `UPDATE api_tokens SET revoked_at = now(), revoked_reason = 'storage-changed' WHERE revoked_at IS NULL` | applied by the integration suite's migrate |
| `packages/contracts/src/publicApi.ts` | `ApiToken` (`:300`) gains `revokedReason: "owner" \| "storage-changed" \| null`; `OAUTH_ACCESS_PREFIX = "tco_"`, `OAUTH_REFRESH_PREFIX = "tcr_"`, `OAUTH_CODE_PREFIX = "tcc_"` | `packages/contracts/test/publicApi.test.ts` |
| `web/server/public-api/route.ts` | `refusalResponse` (`:843`) says *"revoked when token storage changed on <date>. Mint a new one."* for `storage-changed` | `web/server/public-api/route.int.test.ts` |
| `web/components/account/TokensSection.tsx` | a revoked row with `storage-changed` reads *"Revoked when token storage changed — mint a new one"* (`:511`) | `TokensSection.test.tsx` (seen red with the reason ignored) |
| `docs/contracts/CHANGELOG.md` | `ApiToken.revokedReason`, the prefixes | — |
| `docs/known-issues/open/KI-<date>-<x>-the-legacy-scrypt-token-branch.md` (new; pick the id after merging `main`) | delete `legacyScrypt.ts` once every `storage-changed` row's `expires_at` has passed (at most 2027-10-27) | — |
| `docs/architecture/SYSTEM-DESIGN.md` | §5.5 item 1 and §6 *Tokens*: HMAC, ADR-083 | — |
| `.env.example`, `docs/guidelines/using-the-api.md` and `docs/guidelines/cloud-agent-sessions.md` where `API_TOKEN_PEPPER` is named | `API_TOKEN_PEPPER` at least 32 bytes; `API_TOKEN_PEPPER_PREVIOUS` optional, and the rotation in two steps (ADR-083 §2) | — |

**Preview:** Account → Profile → API tokens: mint a token, `curl -H "Authorization: Bearer <it>"
<preview>/api/v1/account` answers 200. If the preview's database ran `0069` over tokens minted
before it, those rows read *Revoked when token storage changed*, and `curl` with one answers 401
`token-revoked` with that message.

**Gate boxes:** *One way to hash a secret* (with the migration applied in production).

---

## Part 2 — the authorization server

ADR-083 §5–§6, §9. The extra review pass. Every endpoint answers well inside 10 seconds. The
issuer and resource come from `deploymentOrigin()` (`web/lib/deploymentOrigin.ts`), never the
request (B).

| File | Entry point | Test |
|---|---|---|
| `web/server/oauth/metadata.ts` (new) | `protectedResourceMetadata()`, `authorizationServerMetadata()`, `OAUTH_SCOPES` (the tools' scopes + `offline_access`), `oauthIssuer()` and `mcpResource()`, both from `deploymentOrigin()` (B); `authorization_response_iss_parameter_supported: true` (A), `client_id_metadata_document_supported: true` and `["none"]` auth (E) | `metadata.test.ts` (`resource` exact, `S256` only, `none` auth, CIMD flag, `iss` flag) |
| `web/app/.well-known/oauth-protected-resource/[[...path]]/route.ts` (new) | `GET`: answers for `""` and `"api/mcp"`, 404 otherwise | `web/server/oauth/wellKnown.test.ts` (both path forms; **a Host-header issuer**: a request with `Host: evil.example` and `X-Forwarded-Host: evil.example` still names `deploymentOrigin()` as `issuer` and `resource`, seen red by building the origin from `request.url`) |
| `web/app/.well-known/oauth-authorization-server/[[...path]]/route.ts` (new) | `GET` | same |
| `web/server/oauth/redirects.ts` (new) | `checkRedirectUri(uri)` (https any host; http only `localhost`, `127.0.0.1` and `[::1]` (H); no fragment; parses), `redirectMatches(registered, presented)` (exact string, no normalisation; loopback port ignored), `isLoopback(uri)` | `redirects.test.ts`, one case per rule, each seen red, and **redirect normalisation** named case by case: a trailing slash, a different case in the host or path, `%2F` for `/`, an explicit `:443`, `localhost` registered and `127.0.0.1` presented, a userinfo part, and `http://[::1]:5555/cb` against `http://[::1]/cb` (the one that matches) |
| `web/server/oauth/recognised.ts` (new) | `RECOGNISED_REDIRECTS` = only `https://claude.ai/api/mcp/auth_callback` (F); `consentMarking(client, redirect)` → `recognised` / `localhost-warning` / `unverified` | `recognised.test.ts` (Claude Code's CIMD URL with a loopback redirect is `localhost-warning`, never `recognised`; seen red by adding the CIMD URL back to the list) |
| `web/server/oauth/clients.ts` (new) | `resolveClient(clientId)`: an `https` `client_id` is a CIMD, fetched first (E) through `guardedHttpsFetcher` (`web/server/external/remoteImage/fetchImage.ts:53`), which pins the checked address, with a **5 KB** read cap and a 5 s timeout (J); `client_id` must equal the URL; `logo_uri` and `jwks_uri` read as nothing and never fetched (J); otherwise a DCR row. `registerClient(body, ip)` (RFC 7591 JSON, the fallback, `invalid_redirect_uri` / `invalid_client_metadata`); expiry after 24 h with no grant | `clients.int.test.ts` (fake fetcher and resolver, no network), and **CIMD SSRF** by name: a CIMD host resolving to `127.0.0.1`, `169.254.169.254`, `10.0.0.1` and `::1` refused; a resolver that answers public on the first lookup and private on the second is refused (the pin; seen red by passing a plain `fetch`); a 6 KB document refused (seen red with the image cap); a redirect to a private host refused; a document whose `client_id` differs from its URL refused; a document with `logo_uri` and `jwks_uri` makes no second request |
| `web/server/quota.ts` | `oauthRegisterQuota()` per IP hash, beside `placeSearchTokenQuota` (`:305`) | `web/server/quota.test.ts` |
| `web/app/api/oauth/register/route.ts` (new) | `POST`, IP from `clientIp` (`web/server/og/limit.ts:20`) | `web/app/api/oauth/register/route.int.test.ts` (201; 400 on each bad redirect; 429 past the limit) |
| `web/server/oauth/pkce.ts` (new) | `verifyS256(verifier, challenge)` | `pkce.test.ts` (RFC 7636 appendix B vector) |
| `web/server/oauth/authorizeRequest.ts` (new) | `parseAuthorizeRequest(params)`: `response_type=code`, client, exact redirect, `code_challenge` present and `code_challenge_method=S256` (I), scopes ⊆ supported, `resource` = `mcpResource()` else `invalid_target` (C); errors before the redirect is proven are shown, never redirected; every redirected answer carries `state` and `iss` (A) | `authorizeRequest.test.ts`, with **errors before the redirect is validated** by name: an unknown client, a CIMD that fails to fetch, and a mismatched redirect each answer `{ show: … }` with no `redirectTo`, even when the request also has a bad `scope` (seen red by checking scope first); **the PKCE downgrade at authorize**: no `code_challenge`, and `plain`, both refused; a wrong `resource` is `invalid_target` |
| `web/server/oauth/grants.ts` (new) | `createGrant`, `issueCode`, `grantOf`, `revokeGrant(ownerId, grantId, reason)` (the grant, its refresh and access tokens, effective on read), `listGrants(ownerId)` (part 5 calls it) | `grants.int.test.ts` |
| `web/server/oauth/tokens.ts` (new) | `exchangeCode`: redeemed by one `UPDATE … WHERE used_at IS NULL RETURNING` (D), no row → reuse revokes the grant; PKCE, refusing a missing `code_verifier` and a verifier for a code with no challenge (I); redirect; `resource` else `invalid_target` (C). `refresh`: rotated by one `UPDATE … WHERE rotated_at IS NULL RETURNING` (D); reuse of a rotated token revokes the grant, no grace window (K); 90 d sliding, 365 d cap. `revokeSecret` (RFC 7009) | `tokens.int.test.ts`: each RFC error code (`invalid_grant`, `invalid_request`, `unsupported_grant_type`, `invalid_target`; seen red with S256 removed), and by name: **parallel code redemption** (`Promise.all` of two exchanges of one code against the real database: exactly one 200, the other `invalid_grant`, and the grant revoked; seen red by splitting the `UPDATE` into a `SELECT` then an `UPDATE`); **parallel refresh rotation** (the same, two refreshes of one token); **the PKCE downgrade at the token endpoint** (a code row written with a null challenge by hand cannot be redeemed with or without a verifier; no verifier for a normal code is `invalid_grant`); **a lost rotation response** (the old refresh token presented after rotation revokes the grant: the documented re-consent) |
| `web/server/oauth/errors.ts` (new) | `oauthError(code, description, status)`, RFC 6749 §5.2 JSON, `Cache-Control: no-store` | via the route tests |
| `web/app/api/oauth/token/route.ts` (new) | `POST`, `application/x-www-form-urlencoded` only | `web/app/api/oauth/token/route.int.test.ts` |
| `web/app/api/oauth/revoke/route.ts` (new) | `POST`, always 200 | `web/app/api/oauth/revoke/route.int.test.ts` |
| `web/app/api/oauth/authorize/route.ts` (new) | `POST` the consent decision: session, same-origin `Origin`, `accountCan(…, "api.tokens")`, re-parses the request, answers `{ redirectTo }` (code + `state` + `iss`, or `error=access_denied` + `state` + `iss`; A) | `web/app/api/oauth/authorize/route.int.test.ts` (free account refused; cross-origin refused; **`iss`** equals `oauthIssuer()` on Allow and on Deny, seen red by dropping it) |
| `web/app/oauth/authorize/page.tsx` (new) | server page: `auth()`, else `redirect("/signin?callbackUrl=…")` (outside `proxy.ts:241-250`'s matcher); `parseAuthorizeRequest`; renders `ConsentScreen` or the error | `web/app/oauth/authorize/page.test.tsx` |
| `web/components/oauth/ConsentScreen.tsx` (new) | client name as a self-declared, *unverified* claim, or *Recognised: Claude* (only the claude.ai callback, F); the redirect host large, and a CIMD client's `client_id` host beside it (G); the localhost warning for a loopback redirect (F); no logo (J); scopes in `SCOPE_CATALOGUE` words, `notebook:*` unticked; the upgrade prompt for a free account; Allow posts with `fetch`, then `window.location.assign(redirectTo)` (CSP `form-action 'self'`, `next.config.ts:118-123`) | `ConsentScreen.test.tsx` (unverified wording; recognised wording; the localhost warning; the `client_id` host shown for a CIMD client; Allow disabled when free) |
| `web/server/public-api/exposure.ts` | `Exposure` (`:28-34`) gains `{ status: "front-door"; why; adapts?: "v1" }`; lines for `oauth/register`, `oauth/token`, `oauth/revoke`, `oauth/authorize` | `web/server/public-api/exposure.test.ts` (accepts the status; a `front-door` line needs no `v1` route) |
| `apps/web/e2e/m55-consent.spec.ts` (new) | sign in as a premium dev user (as `m22-api-tokens.spec.ts:32` grants it), register a loopback client with `request.post`, open `/oauth/authorize?…`, click Allow, catch the redirect, see `code` and `state` | the spec, on `pnpm --filter web test:e2e:ci-like e2e/m55-consent.spec.ts` |

**Preview:** `curl <preview>/.well-known/oauth-authorization-server` and
`curl <preview>/.well-known/oauth-protected-resource/api/mcp` (both 200, `resource` =
`<preview>/api/mcp`). `curl -X POST <preview>/api/oauth/register -H 'content-type: application/json'
-d '{"client_name":"Test","redirect_uris":["http://example.com/cb"]}'` answers 400
`invalid_redirect_uri`; with `https://example.com/cb` it answers 201. Open
`<preview>/oauth/authorize?client_id=<it>&redirect_uri=https://example.com/cb&response_type=code&code_challenge=<S256>&code_challenge_method=S256&state=x&resource=<preview>/api/mcp`
signed out: it sends you to sign in and back. Signed in on a free account: the upgrade prompt.
On a premium one: *An app calling itself "Test"*, unverified, `example.com` large; Allow lands on
`https://example.com/cb?code=tcc_…&state=x&iss=<preview>`. `curl -H 'Host: evil.example'
<preview>/.well-known/oauth-authorization-server` still names `<preview>` as the issuer.

**Gate boxes:** *Refusals* (the authorize and token halves, `iss`, the atomic single-use tests),
*Registration abuse is bounded*,
*Two gates hold* (free account cannot consent), half of *Exposure*.

---

## Part 3 — the OAuth actor

ADR-083 §7. The six credential branches (milestone file, *Risks*).

| File | Entry point | Test |
|---|---|---|
| `web/server/oauth/verifyAccess.ts` (new) | `verifyAccessToken(secret, now)`: `digestCandidates` lookup in `oauth_tokens` (P1-a), kind `access`, not expired, grant live, grant's `resource` = `mcpResource()` (C), owner `accountCan(…, "api.tokens")`; refusals `unknown` / `expired` / `revoked` / `not-entitled` | `verifyAccess.int.test.ts` |
| `web/server/oauth/dispatchContext.ts` (new) | `runInMcpDispatch(fn)`, `inMcpDispatch()` (`AsyncLocalStorage`) | `dispatchContext.test.ts` |
| `web/server/public-api/actor.ts` | `Actor` gains `{ via: "oauth"; grantId; clientName; scopes; tripIds: null }`; `resolveActor` (`:63`) routes `tco_` to `verifyAccessToken`, and outside `inMcpDispatch()` answers a refusal; `actorHasScope` (`:99`), `actorMayReachTrip` (`:111`); a `credentialKey(actor)` helper (token id or grant id) | `web/server/public-api/oauthActor.int.test.ts` (new: scope set honoured; a `tco_` on a bare `/v1/account` call is 401; a lapsed plan 402 then 200 on re-subscribe) |
| `web/server/public-api/route.ts` | rate limit (`:488`) on `credentialKey`; tripless confinement (`:640`) unchanged in effect, written over the union; `touchLastUsed` (`:806`) → the grant's `last_used_at` for `oauth`; `refusalResponse` (`:843-871`) sends `Bearer resource_metadata="<origin>/.well-known/oauth-protected-resource/api/mcp", error="invalid_token"` for an OAuth refusal (`BEARER_CHALLENGE`, `:384`) | `web/server/public-api/rateLimit.int.test.ts` (an OAuth grant has its own bucket), `route.int.test.ts` (the challenge header) |
| `web/server/oauth/grants.ts` | `touchGrantLastUsed(grantId)` (five-minute coarse, as `api_tokens`) | `grants.int.test.ts` |
| `web/app/api/v1/geocode/route.ts` | the per-credential allowance (`:50`) keys on `credentialKey` | `web/server/public-api/placeSearch.int.test.ts` |
| `web/app/api/v1/trips/[tripId]/globals/route.ts` | `:17` over the union (an OAuth actor is account-wide) | `web/server/public-api/surface.int.test.ts` |

**Preview:** nothing visible. With a `tco_` token from part 2's flow, `curl -H "Authorization:
Bearer tco_…" <preview>/api/v1/account` answers 401 with the `resource_metadata` challenge (the
audience binding), which is what proves part 3 is live.

**Gate boxes:** *Two gates hold* (scope, trip, lapse), *Refusals* (expired access token, `tco_` on
`/api/v1`).

---

## Part 4 — the MCP server

ADR-083 §8. D2, D4, D11.

| File | Entry point | Test |
|---|---|---|
| `apps/web/package.json`, `pnpm-lock.yaml` | `@modelcontextprotocol/sdk`, pinned; the build confirms its Web-standard (`Request`/`Response`) streamable HTTP transport and Zod 4 compatibility, or uses its low-level `Server` with JSON Schema directly. **Which MCP revision the pinned SDK targets (L):** read from its `LATEST_PROTOCOL_VERSION` / `SUPPORTED_PROTOCOL_VERSIONS`; if it is before 2026-07-28, check how it treats the new required `Mcp-Method` / `Mcp-Name` headers and `CacheableResult`, and write the answer into ADR-083 §8 (or a known issue if a gap remains) | `web/app/api/mcp/route.int.test.ts` (a `tools/call` with and without `Mcp-Method` / `Mcp-Name` both answer) |
| `web/server/mcp/tools.ts` (new) | `TOOLS`: name, title, description written for a model, `readOnlyHint` / `destructiveHint` / `openWorldHint`, the `DeclaredHandler` imported from its `web/app/api/v1/**/route.ts`, path parameters | `web/server/mcp/conformance.test.ts` |
| `web/server/mcp/schemas.ts` (new) | `inputSchemaFor(tool)`: `z.toJSONSchema(def.body ?? def.query, { target: "draft-2020-12", io: "input" })` + path params; the `PatchPlaybookBody` rules (`playbooks.ts:187-203`) in the description | `conformance.test.ts` (a tool with no declaration fails; a schema that differs from its route's fails; each seen red) |
| `web/server/mcp/dispatch.ts` (new) | `callTool(tool, input, request)`: synthetic `Request` with the same bearer, `Idempotency-Key` `mcp-<grantId>-<sha256(canonicalJson(input))>` for `create_playbook` (`canonicalJson`, `web/server/public-api/idempotency.ts:48`), inside `runInMcpDispatch`; the v1 envelope → `isError` tool result; 409 on a published day's `days` (`savedDays.ts:879,915`) → *unpublish, edit, republish* | `dispatch.int.test.ts` (a retried create returns the same Playbook; the 409 message) |
| `web/server/mcp/publishUrl.ts` (new) | `publish_playbook`'s answer adds `url: origin + dayPath(day)` (`web/lib/playbookUrls.ts:45`) | `dispatch.int.test.ts` |
| `web/server/mcp/server.ts` (new) | `buildServer(actor)` per request: `tools/list`, `tools/call` | via the route test |
| `web/app/api/mcp/route.ts` (new) | `POST` only, stateless, JSON responses: resolve the credential first (401 + `resource_metadata` before any MCP parsing), then the SDK transport; `GET`/`DELETE` 405 | `web/app/api/mcp/route.int.test.ts` |
| `web/server/mcp/flow.int.test.ts` (new) | register → authorize (as a signed-in premium user) → token → `tools/call whoami` → refresh → call again; disconnect → 401 and `invalid_grant`; the CIMD path as well as DCR (E); a grant whose stored `resource` differs from `mcpResource()` is refused on the call (C) | itself (seen red with `verifyS256` returning true) |
| `web/server/public-api/exposure.ts` | `mcp: { status: "front-door", adapts: "v1", why }` | `exposure.test.ts`, whose check 3 now also walks `web/server/mcp/**` (seen red by importing a `never` symbol into `tools.ts`) |

**Preview:** `curl -X POST <preview>/api/mcp -H 'content-type: application/json' -d '{}'` answers
401 with `WWW-Authenticate: Bearer resource_metadata="…"`. Then run the MCP Inspector
(`npx @modelcontextprotocol/inspector`), point it at `<preview>/api/mcp`, sign in through the
loopback redirect, and see every tool with its annotations (the screenshot for the gate). Call
`create_playbook` with two days, then `publish_playbook`, and open the URL it answers.

**Gate boxes:** *The flow end to end*, *Parity*, *Publish answers the public URL*, *The inspector*,
*Discovery* (on production after merge), the rest of *Refusals* (rotated-away refresh, reused
code), half of *Exposure*.

---

## Part 5 — Connected apps, and the docs

D10, D9's table. Branches after part 2; merges after part 4 (its spec calls `/api/mcp`).

| File | Entry point | Test |
|---|---|---|
| `web/app/api/account/connected-apps/route.ts` (new) | `GET` (session only): `listGrants(ownerId)` — client name, redirect host, recognised, scopes, created, last used | `route.int.test.ts` beside it |
| `web/app/api/account/connected-apps/[grantId]/route.ts` (new) | `DELETE`: `revokeGrant(ownerId, grantId, "owner")`; idempotent; 404 on another's | `route.int.test.ts` beside it |
| `packages/contracts/src/publicApi.ts` | `ConnectedApp` DTO | `packages/contracts/test/publicApi.test.ts` |
| `web/components/account/ConnectedAppsSection.tsx` (new) | the list and Disconnect (confirm, then the row reads *Disconnected*) | `ConnectedAppsSection.test.tsx` |
| `web/components/account/AccountScreen.tsx` | `?tab=apps` sub-view beside `?tab=tokens` (`:149-168`); `accountTabFrom` (`:62`) | `AccountScreen.test.tsx` |
| `web/components/account/ProfileSection.tsx` | *Connected apps →* line beside *API tokens →* (`:490-500`) | `ProfileSection.test.tsx` |
| `web/server/public-api/exposure.ts` | `account/connected-apps`, `account/connected-apps/[grantId]`: `never`, reaching `listGrants` / `revokeGrant` | `exposure.test.ts` |
| `web/components/front/DevelopersScreen.tsx` | *Connect Claude*: the connector URL `https://caesura.today/api/mcp`, Premium, the scopes | `DevelopersScreen.test.tsx` |
| `web/app/llms.txt/route.ts` | an *MCP connector* line | `web/server/public-api/discovery.test.ts` |
| `docs/guidelines/using-the-api.md` | a *Connecting Claude (MCP and OAuth)* section; the firewall table (`:99-107`) gains `/.well-known/oauth-protected-resource*` and `/.well-known/oauth-authorization-server*`, **required** | — |
| `apps/web/e2e/m55-connected-apps.spec.ts` (new) | the consent flow as in part 2's spec, exchange the code with `request.post`, call `/api/mcp` `whoami` (200), open Account → Connected apps, Disconnect, call again (401), refresh (`invalid_grant`) | the spec, on `pnpm --filter web test:e2e:ci-like e2e/m55-connected-apps.spec.ts` |

**Preview:** after connecting the Inspector (part 4's preview walk), Account → Profile →
*Connected apps*: the Inspector's row, its scopes and redirect host. Disconnect; the Inspector's
next tool call fails and asks to sign in again. `/developers` and `/llms.txt` name the connector.

**Gate boxes:** *Revocation*, the last of *Exposure*. Mitchell adds the two firewall rules once it
merges (the *Discovery* box's production `curl` needs them).

---

## Gate box → part

| Box | Part |
|---|---|
| Decisions, ADR-083, the plan, changelog entries | 0 (+ 1, 5 for their entries) |
| One way to hash a secret | 1 |
| Discovery (production `curl`) | 2 + 4, after Mitchell's firewall rules |
| The flow end to end | 4 |
| Refusals (including `iss` and the atomic single-use tests) | 2 + 3 + 4 |
| Registration abuse is bounded | 2 |
| Two gates hold | 2 (free consent) + 3 |
| Parity | 4 |
| Publish answers the public URL | 4 |
| Revocation | 5 |
| The inspector | 4 (screenshot) |
| Exposure | 2 + 4 + 5 |
| [walk] | Mitchell, on production after all five merge and `migrate-production` has run |
| Retro | 0 |
