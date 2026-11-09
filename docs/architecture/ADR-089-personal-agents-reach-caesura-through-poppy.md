# ADR-089: Personal agents reach Caesura through Poppy, on top of our own OAuth server

**Status:** **Accepted — 2026-11-09.** Mitchell answered M60's decisions 1–14 in session, all as
recommended (*"go with your recommendations. D4 - Premium + free like you suggested, D3 -
Recommended, D14 - Next in queue"*).
**Deciders:** Mitchell (product); Claude — drafted
**Amends:** ADR-083 (Claude connects through our own OAuth server). Its public-client-only rule
(§3, `token_endpoint_auth_method: none`) gains a second method, and its bare
protected-resource document changes what it names (decision 7).
Related: M60 (`docs/milestones/M60-personal-agents-act-for-you.md`), M55, M22
(`docs/guidelines/using-the-api.md`), the Personal Agent Protocol spec, draft 0.4
(`github.com/personal-agent-protocol/personal-agent-protocol` at `a2f16ec`,
`skills/implement-personal-agent-protocol/reference/spec.md`).

## Context

The Personal Agent Protocol ("Poppy", Sierra and Meta, draft 0.4) lets a Personal Agent such as
Meta's Muse discover a Company from `/.well-known/poppy.json`, authenticate as itself with a key,
sign a person in with standard OAuth, and call the Company's APIs carrying a per-request
`Poppy-Session` JWT. M55 already runs an OAuth 2.1 authorization server with CIMD client IDs, the
RFC 9207 `iss` parameter, rotating refresh tokens and revocation, and an MCP server at `/api/mcp`.
What it does not have: discovery, client authentication (every client is public), the Session
header, and a v1 API that accepts OAuth tokens (`server/public-api/actor.ts:115` refuses one
outside MCP dispatch with `audience`).

## Decision

1. **Draft 0.4, pinned.** `protocol_version: "0.4"`, no `supported_versions`. The spec is re-read
   before part 1 merges; a later version is a candidate, not a reopened gate.
2. **`poppy.json` lists two APIs and the website.** `apis`: the MCP server (`/api/mcp`, type
   `mcp`) and the OpenAPI description (`/api/v1/openapi`, type `openapi`). `web: {}` with no
   `browser_session_endpoint`: agents browse the public site as signed-out visitors. **No
   `agent`**: the assistant as a Poppy conversation (§8) is a candidate. `organization.domain` is
   the deployment origin's host, the same source as `oauthIssuer()`, never the request's `Host`
   (ADR-083 amendment B).
3. **Any Personal Agent may connect, and the operator can cut one off.** A CIMD client whose
   document declares `token_endpoint_auth_method: "private_key_jwt"` and a same-domain `jwks_uri`
   is a Personal Agent. There is no allowlist. A refused `client_id` (a new
   `oauth_client_blocks` row, set in the operator console) answers `invalid_client` at the token
   and revocation endpoints and `invalid_session` at every resource.
4. **Signed out is free; the account is Premium.** A request with a verified Session header and
   no access token reaches only the signed-out surface (decision 5), on any plan or none. Account
   access stays behind `api.tokens`, resolved per request, exactly as M55 D6.
5. **The signed-out surface is Discover, read-only.** `GET /v1/discover/playbooks` (today
   `library:read`) and the discovery documents (`/v1`, `/v1/openapi`). Nothing that writes,
   nothing that spends a paid quota (geocode is excluded), under a per-`(client_id, sid)` rate
   limit with `429` and `Retry-After`. A route opts in by declaring `signedOut: true` in
   `declare()`; the default is no.
6. **The v1 API accepts OAuth access tokens** whose audience is the domain
   (`https://caesura.today`), through every gate `route()` already applies (scope, trip
   confinement, role, entitlement). An `/api/mcp`-audience token is still refused outside MCP
   (`audience`), and a domain-audience token is refused inside it. A Poppy sign-in without a
   `resource` gets a domain-audience token; MCP clients keep sending `resource=…/api/mcp`.
7. **The bare protected-resource document names the domain.**
   `/.well-known/oauth-protected-resource` answers `resource: https://caesura.today` with our
   issuer; `/.well-known/oauth-protected-resource/api/mcp` keeps answering the MCP resource; the
   MCP 401's `resource_metadata` already points at the `/api/mcp` form (`route.ts:865`). The
   issuer's metadata gains `protected_resources: [domain, domain/api/mcp]`. Claude's connector is
   walked on the preview before this merges.
8. **A Session is one row.** `agent_sessions (client_id, sid, agent_user_id, agent_id?,
   account_id?, created_at, last_seen_at, ended_at)`, unique on `(client_id, sid, agent_user_id)`,
   created by the first request with a new `sid` **whose access token the actor has accepted**: a
   request refused for its credential, and a signed-out request, write nothing (part 4's signed-out
   Discover surface calls `open(null)` itself). Idle for 30 days, it ends; a request on
   an ended row answers `session_ended`. A signed-in request records the account; a later request
   on another account answers `session_ended` (§5.4). `agent_user_id` is the agent's pairwise ID
   and is joined to nothing but `account_id`. Verified delegations are cached until their `exp`
   in the existing cache (`server/cache`), keyed by delegation `jti`.
9. **Every scope has a description and a hint.** `auth.scopes` takes `SCOPE_CATALOGUE`'s words;
   a new `SCOPE_HINTS` in `packages/contracts/src/publicApi.ts` gives each scope `changes` and
   `personal_data`, and a contracts test fails if a scope lacks one. Publishing to Discover is
   `irreversible`.
10. **Direct Sign-In only.** No Device Sign-In; `grant_types_supported` stays
    `authorization_code` and `refresh_token`.
11. **A tasks endpoint, with excluded tasks and feedback.** `GET /api/poppy/tasks` lists
    `excluded_tasks` (billing and plan changes, deleting the account, inviting or removing trip
    members, and what part 5's survey of `exposure.ts`'s `never` rows adds), and
    `feedback.endpoint` = `POST /api/poppy/feedback`, which stores `{task, description}` with the
    verified `client_id` and answers `202`. The operator console lists reports in a new *Agents*
    tab, beside the kill switch. Report text is data, never a prompt. No `skill_index`.
12. **No Gemini-specific work.** Gemini reaches Caesura through MCP and OpenAPI, as any MCP client
    does, outside any Poppy Session (§7).
13. **Conformance is the kit's validator on the preview**, at the pinned kit commit, never vendored
    and never in CI, with its `keygen` test identity hosted outside production. Sign-in and the
    checklist's manual items are checked by hand; the evidence goes in the milestone file.
14. **Placed next after M59, ahead of M53.**

**Implementation choices (not product decisions, recorded so they are not reopened):**

- **`jose` is added** to `apps/web` for JWS verification, JWK thumbprints (RFC 7638) and remote
  key sets. The repo has no JOSE library today; hand-rolling ES256/PS384 verification and
  thumbprints is the kind of code that is wrong quietly. Key sets are fetched with the existing
  guarded fetcher (`clients.ts` `fetchDocument`, `assertPublicAddress`), not `jose`'s own
  `createRemoteJWKSet`, so the private-address rule (§3) holds.
- **Client assertions:** `aud` must equal `oauthIssuer()` character for character (the token
  endpoint's URL is refused); `exp` at most 5 minutes after `iat`; `jti` remembered in the cache
  until `exp`, and a reuse is `invalid_client`. **Best effort, and it fails open:** while the cache
  is down or `CACHE_DRIVER=off` (ADR-059), a replayed `jti` passes; the assertion must still be
  unexpired and signed. The kit validator's `assertion.jti-reuse` check cannot pass where the
  cache is off.
- **A client with no stored row is never fetched for.** Only `/oauth/authorize` creates an
  `oauth_clients` row (at Allow, under its own quota). The token endpoint, revocation and Session
  verification answer a `client_id` with no row `invalid_client` / `invalid_session` without a
  fetch, so inventing URLs costs an attacker nothing and spends no pool. For a stored client,
  fetches made before an account is known are charged to the caller's IP on the signed-out fetch
  quota (120 per caller, 3,000 an hour global), never to a `client_id` the caller names and never
  to the authorize share. Sizing: a busy agent refetches its document and key set every 5 minutes,
  about 24 units an hour, so 3,000 carries over a hundred of them; the 429 a stranger could cause
  is bounded by how many known agents there are, since each costs at most that.
- **A key set that cannot be read does not lock an agent out, and a removed key does not outlive
  the removal.** The last known good document and key set of a `private_key_jwt` client are kept
  for 24 hours (fresh for 5 minutes; a public client's copies keep the 5 minutes), and the token
  endpoint and Session verification fall back to them **only when the host cannot be reached**: a
  transport failure, a timeout or a 5xx. Never on a 404, a 410 or another answer, on a set that
  omits the key, or on a spent quota. The longest a key an agent has removed can still be
  accepted is therefore 5 minutes when its host answers (the cache), and 24 hours when it is down.
  A key set asked for again (an unknown `kid`) gets no fallback and is read at most once a minute
  per cached copy. A rotated refresh token or spent code cuts a grant off only when presented
  under the grant's own `client_id`.
- **A grant's auth method is sticky.** A grant stored as `private_key_jwt` always needs an
  assertion, whatever its document says now, at refresh, code exchange and revocation; one stored
  as `none` never reads its document.
- **Sessions are kept 60 days from their last request.** A Session ends after 30 idle days, and
  its row is deleted 60 days after its last request (a month in which its `sid` is still refused),
  by a 1% sweep on insert. Opening a new one is charged per `(client_id, account)` when signed
  in and `(client_id, caller IP)` when not, 60 an hour each (`AGENT_SESSION_OPEN_RATE_LIMIT_PER_ACCOUNT_HOURLY`),
  with 20,000 an hour global; only the insert is charged. The refusal is a 429 in the
  `{ error: { code, message } }` envelope with `Retry-After`, as `/api/v1` and `/api/mcp` answer
  everything else.
- **A refresh that asks for fewer scopes is refused** with `invalid_scope`; the scope must name
  exactly what the grant holds. Poppy 4.4 allows an agent to ask for less, but no scope is stored
  per token, and answering with the full set would breach 4.7's "never beyond requested". A
  deliberate choice, not an oversight: narrowing would need a per-token scope column.
- **The agent's token-endpoint auth method is stored on its grant** (part 3's migration `0075`),
  so the token and revoke endpoints read the database instead of a cache marker, and a public
  client (Claude) never depends on a document fetch at refresh. Part 2 carries a cache marker
  until then.
- **The agent's logo is hidden** on the consent page and in Connected apps while the CSP
  `img-src` blocks the agent's own domain. Open decision with Mitchell: proxy it through a
  same-origin route or widen `img-src`. No CSP change in M60.
- **Session JWTs:** `iat` within ±60 seconds; `htu` compared without query or fragment against
  the deployment origin plus the request path, never the forwarded `Host`; `jti` replay is not
  refused (the spec makes it optional and the window is one minute).
- **Errors** are `{ "error": "invalid_session" | "session_ended" | "version_unsupported" }` with
  HTTP 400, outside v1's error envelope, because Poppy agents read them by that shape. Token errors
  stay in `WWW-Authenticate`.

## Consequences

- A second client type at the token endpoint. Public MCP clients (Claude) are untouched: the
  `none` method stays, and a gate box proves Claude's connector still connects.
- `route()` learns two things: a Session header, and a third credential audience. Both are
  covered once there, so no v1 route re-implements either.
- One migration (`agent_sessions`, `oauth_client_blocks`, `agent_feedback`) and one dependency
  (`jose`).
- The spec is a draft; when it moves, the ADR is amended, not silently drifted from.
