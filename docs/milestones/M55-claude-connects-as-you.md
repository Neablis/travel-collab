# M55 — Claude connects to Caesura as you, and can publish what it plans

**Status (2026-10-27): proposed, not scoped.** Minted by Mitchell the same day (*"Could you add a
milestone to the caesura project to add the ability for a oauth connector so you can connect?"*,
then *"Yes, add it"*). Placed **last**, after M53, until Mitchell places it (see
`docs/milestones/README.md`, *2026-10-27 — minted: M55, a connector Claude signs in to*). Every
decision below is a recommendation; none has been answered.

## Why this exists

Mitchell wants a daily Claude routine that finds a travel destination people are talking about,
researches it from real traveller reports, and publishes a 1 to 5 day itinerary to Caesura. M22
already built everything that routine needs to *write*: inline Playbooks of up to 366 days
(`POST /v1/playbooks`), publishing to Discover (`PATCH … visibility: "public"`), place search
(`GET /v1/geocode`), and Discover's own list to check against (`GET /v1/discover/playbooks`).

What it cannot do is **get in**. A v1 credential today is a `tc_…` token minted in Account →
Profile → API tokens and pasted somewhere. A Claude routine has nowhere safe to keep a pasted
secret, and a secret pasted into a chat sits in a transcript for as long as the token lives (90
days by default, 365 at most). Claude's own answer to this is a **custom connector**: a remote MCP
server the person adds in claude.ai's connector settings, which signs them in through OAuth in
their browser. Claude then holds a short-lived access token it refreshes on its own, and the
person never sees or copies a secret.

So this milestone is not new product behaviour. It is a **second front door onto M22's surface**:
an MCP server at `https://caesura.today/api/mcp`, and the OAuth 2.1 authorization server in front
of it, so Claude (and Claude Code) can act as the signed-in person with exactly the powers M22's
two gates already allow.

### What exists, and what this builds on

| Already here | Where | What this milestone does with it |
|---|---|---|
| Two credentials, one principal: a session cookie or a `tc_…` bearer token, both resolved to an `Actor` | `apps/web/src/server/public-api/actor.ts` | Adds a third credential, an OAuth access token, resolved to the same kind of `Actor` |
| The v1 wrapper: scope check, trip confinement, role gate, parsing, the error envelope, rate limit, pagination, once for every endpoint | `apps/web/src/server/public-api/route.ts` | Every MCP tool runs through it. No tool re-implements a gate |
| Scopes, nothing implied by anything else | `SCOPE_CATALOGUE`, `docs/guidelines/using-the-api.md` *Scopes* | The OAuth consent screen offers the same scopes, by the same words |
| Tokens stored as `HMAC-SHA256(pepper, secret)`, shown once, always expiring, never swept | `api_tokens` in `apps/web/src/server/db/schema.ts`, `API_TOKEN_PEPPER` | Authorization codes, access tokens and refresh tokens are stored the same way |
| API access is the `api.tokens` entitlement (Premium), resolved per request, never cached on a token row | `packages/contracts/src/entitlement.ts`, `server/entitlements/` | Decision 6 |
| Sign-in is Auth.js with Google, JWT sessions, no DB adapter; previews delegate the Google round trip to production | ADR-024, ADR-025, ADR-034 | The consent page is an ordinary signed-in page; the OAuth server is ours, not Auth.js's |
| Every internal route has one line in the exposure ledger, and CI holds the public side to it | `apps/web/src/server/public-api/exposure.ts`, `exposure.test.ts` | The MCP route and the OAuth routes each get a line |
| The Vercel firewall challenges automated traffic on every path outside `/api/*` | `docs/guidelines/using-the-api.md` *Discovery* | Decision 9: two `/.well-known` paths need a bypass, or Claude cannot discover the server |

### What Claude expects of the server (read 2026-10-27)

From Claude's connector documentation (`https://claude.com/docs/connectors/building/authentication`
and the help-centre article on custom connectors). Re-read both when the milestone is scoped,
because they move.

- **Transport:** streamable HTTP. SSE is also accepted but is being deprecated, so it is not built.
- **Discovery:** an unauthenticated MCP request answers **401** with
  `WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource"`. That
  document (RFC 9728) names the resource, which must **exactly** match the URL the person typed,
  and lists the authorization server first (only the first entry is used). The authorization
  server publishes RFC 8414 metadata.
- **Registration:** Dynamic Client Registration (RFC 7591) by default, a new client per fresh
  connection. Client ID Metadata Documents are used instead if the metadata advertises
  `client_id_metadata_document_supported: true` and `none` among
  `token_endpoint_auth_methods_supported`.
- **PKCE:** required, S256 only, and `code_challenge_methods_supported: ["S256"]` must say so.
- **Redirects:** `https://claude.ai/api/mcp/auth_callback` for claude.ai, the desktop and mobile
  apps; `https://claude.com/api/mcp/auth_callback` may replace it. Claude Code uses a loopback
  redirect on any port (`http://localhost:<port>/callback`, `127.0.0.1` too), port ignored.
- **Tokens:** the token endpoint takes `application/x-www-form-urlencoded`. Claude refreshes on a
  401 and up to five minutes before expiry. Refresh tokens rotate for public clients, and a dead
  one answers `invalid_grant`. Discovery, registration and token calls must answer within 10
  seconds, a refresh within 30.
- **Scopes:** a `scope` in the 401's challenge wins; otherwise Claude asks for the protected
  resource metadata's `scopes_supported`, plus `offline_access` if the server lists it.
- **Where Claude calls from:** `160.79.104.0/21`, discovery included.

## Decisions

### Open

1. **What "publish a notebook" means here.** Mitchell's words for the routine are *a notebook*,
   but in Caesura a Notebook page lives inside a trip (M30) and is never public; the public,
   indexable, reviewable thing is a **Playbook published to Discover** (ADR-050), and a 1 to 5 day
   itinerary is exactly a multi-day Playbook (M23). *Recommendation:* the routine creates an inline
   Playbook (`days[].stops[]`, a `summary` that names its sources) and publishes it. The tools are
   named for what the person sees (*create_playbook*, *publish_playbook*), and each tool's
   description says a Playbook is "a public day plan in the Discover library", so Claude does not
   go looking for a notebook tool. Trip Notebook pages are reachable too (decision 4), for
   research notes on a trip of his own.
2. **How a tool reaches the v1 surface.** *Recommendation:* each MCP tool is a thin adapter over
   one v1 route declaration, dispatched **in process through `route()`** with the OAuth actor, so
   the scope check, the role gate, parsing, validation, the error envelope and the rate limit are
   the ones the REST call gets. Tool input schemas are generated from the same Zod schemas the
   OpenAPI document is (`openapi.ts`), so a field cannot drift between the two. A conformance test
   fails on a tool that names no v1 declaration. Calling `/api/v1` over HTTP from the MCP route
   was considered: it doubles the latency and the rate-limit spend for no isolation gained.
   Writing tool handlers against the server modules directly was refused: it is the "same logic
   rewritten inside `v1/`" that `exposure.test.ts` cannot see.
3. **The OAuth server: ours, or a library.** Auth.js is an OAuth *client* (it signs people in
   with Google) and cannot issue tokens. *Recommendation:* a small authorization server of our own
   under `apps/web/src/server/oauth/`, on a maintained library for the protocol checks
   (`oauth4webapi`-style primitives, or the MCP TypeScript SDK's server-side auth helpers,
   whichever the build finds current), with storage in our Postgres beside `api_tokens`. A hosted
   identity provider (Auth0, WorkOS, Stytch, Clerk) was considered: it adds a vendor, a second
   user directory to keep in step with `users`, and a sign-in page that is not ours, for one
   consent screen. Decided by an ADR before the first part.
4. **The tool list.** *Recommendation*, each naming the v1 route it adapts:

   | Tool | v1 route | Scope | Hints |
   |---|---|---|---|
   | `whoami` | `GET /v1/account` | `account:read` | read-only |
   | `search_places` | `GET /v1/geocode` | `places:read` | read-only, spends geocode quota |
   | `search_library_cities` | `GET /v1/cities` | `trips:read` (its scope today) | read-only |
   | `list_discover_playbooks` | `GET /v1/discover/playbooks` | `library:read` | read-only |
   | `list_my_playbooks` | `GET /v1/playbooks` | `library:read` | read-only |
   | `get_playbook` | `GET /v1/playbooks/{id}` | `library:read` | read-only |
   | `create_playbook` | `POST /v1/playbooks` (inline body), with an `Idempotency-Key` minted per call | `library:write` | |
   | `update_playbook` | `PATCH /v1/playbooks/{id}` (name, summary, days; `expectedVersion`) | `library:write` | |
   | `publish_playbook` / `unpublish_playbook` | `PATCH /v1/playbooks/{id}` (`visibility`) | `library:write` | open-world: publishing makes it public |
   | `list_trips` / `get_trip` | `GET /v1/trips`, `GET /v1/trips/{id}` | `trips:read` | read-only |
   | `list_notebook_pages` / `get_notebook_page` / `update_notebook_page` | `…/pages`, `…/pages/{id}` | `notebook:read` / `notebook:write` | |

   **Left out of the first cut:** every delete (`DELETE /v1/playbooks/{id}` included), trip
   writes, invites and share links (`sharing:write`), import and export. Each is one adapter
   later; none is needed for the routine, and a connector that cannot delete is a smaller thing to
   trust. Billing, admin, the assistant and token management stay out for the reasons
   `exposure.ts`'s `never` lines give.
5. **Which scopes the connector asks for.** *Recommendation:* `scopes_supported` lists the scopes
   the tools above use, and the consent screen shows each in `SCOPE_CATALOGUE`'s words with a
   checkbox, all ticked except the two `notebook:` scopes, so the default grant is "see my trips
   and the library, write and publish Playbooks, search places, see who I am". `trips:read` stays
   in the default because `GET /v1/cities` is declared under it today. A tool whose scope
   was not granted answers the v1 `insufficient-scope` error as a tool error, which tells Claude
   (and through it, the person) exactly what to re-connect with. `offline_access` is listed, so
   Claude gets a refresh token.
6. **Who may connect.** API tokens are Premium (`api.tokens`). *Recommendation:* the connector
   uses the same entitlement, resolved per request as M22 requires, so a lapsed plan disables a
   grant without revoking it, exactly as it does a token. A free account reaching the consent page
   sees the same upgrade prompt as the API tokens section. A separate `api.connectors` capability
   was considered and is cheap to add later if the two should ever be priced apart.
7. **Which clients may register.** Open DCR means any program can register a client and send a
   person to our consent page. *Recommendation:* registration accepts only redirect URIs on
   Claude's two callbacks and loopback (`localhost`, `127.0.0.1`, any port, for Claude Code and the
   MCP Inspector), and refuses everything else with `invalid_redirect_uri`. The consent page names
   the client and shows the redirect host in plain words. Opening it to any HTTPS redirect is a
   later decision of Mitchell's, with its own threat review. CIMD is advertised too, so Claude can
   skip registration altogether; both paths land on the same allowlist.
8. **Token lifetimes.** *Recommendation:* access tokens live **one hour**; refresh tokens rotate
   on every use and live **90 days** from their last use, capped at M22's 365 days from the grant;
   authorization codes live **one minute** and are single-use (a second use revokes the whole
   grant, per OAuth 2.1). All three are opaque, prefixed (`tco_`, `tcr_`), stored as
   `HMAC-SHA256(API_TOKEN_PEPPER, secret)`, and never swept, so a refused one can say why.
   JWT access tokens were considered: they cannot be revoked before they expire, and the v1 route
   already reads Postgres on every request.
9. **The firewall, and where the documents live.** The MCP endpoint, registration and the token
   endpoint sit under `/api/*` (`/api/mcp`, `/api/oauth/register`, `/api/oauth/token`,
   `/api/oauth/revoke`), which the firewall leaves alone. The two discovery documents cannot:
   RFC 9728 and RFC 8414 fix them under `/.well-known/`. *Recommendation:* Mitchell adds two bypass
   rules in Vercel → Firewall, `/.well-known/oauth-protected-resource*` and
   `/.well-known/oauth-authorization-server*`, the same kind he was asked for in M22's discovery
   table, and the guideline's table gains the two rows. The consent page (`/oauth/authorize`) is a
   person's browser, not a bot, and needs nothing. Allowlisting `160.79.104.0/21` was considered:
   it would trust a network, not a request.
10. **What a connection looks like to the person afterwards.** *Recommendation:* Account → Profile
    gains **Connected apps** beside API tokens: each grant's client name, scopes, when it was made
    and last used, and a **Disconnect** that revokes the grant, its refresh token and every access
    token issued from it, effective on the next request. The same list is in the operator console's
    account page (M36). Writes made through a grant are labelled where the app already labels an
    origin (a trip's History, and wherever a Playbook shows who changed it), as *"via Claude"*,
    from the client's registered name.
11. **What the routine publishes without a look.** Publishing is public, indexed (M50, M53) and
    reviewable (M12), and the routine runs with nobody watching. *Recommendation:* the connector
    can publish, and the routine's own prompt decides whether it does; the milestone's walk runs
    it both ways. Two guards ride on the publish tool itself: it refuses a Playbook whose city
    already has a published day with the same title (the guard M53's decision 1 asks for, built
    once and shared), and its answer carries the public URL so the routine can report it.

## Scope

A first cut of the parts, for the plan to settle:

1. **The ADR and the storage** (decisions 3, 8): `oauth_clients`, `oauth_grants`,
   `oauth_codes`, `oauth_tokens` (the next free migration numbers), hashed the way `api_tokens`
   is, owned by `users.id` on ADR-025's no-foreign-key terms.
2. **The authorization server**: the two metadata documents, `/api/oauth/register` (DCR and the
   redirect allowlist, decision 7), CIMD, `/oauth/authorize` (the consent page, signed in through
   the existing Google sign-in, decisions 5 and 6), `/api/oauth/token` (code with PKCE S256,
   refresh with rotation, `resource` per RFC 8707 checked against the MCP URL), and
   `/api/oauth/revoke` (RFC 7009).
3. **The OAuth actor**: `resolveActor` recognises a `tco_` access token, resolves it to an
   `Actor` with the grant's scopes, account-wide (a grant confined to trips is a later decision),
   and the rate limiter keys on the grant. A refused access token answers the MCP-shaped 401 with
   `resource_metadata`, so Claude refreshes or re-connects on its own.
4. **The MCP server** (decisions 2, 4): `/api/mcp`, streamable HTTP, **stateless** (no session id,
   no resumable stream), because Vercel functions have no sticky routing; JSON responses; the
   tools above, with titles, descriptions written for a model and `readOnlyHint` /
   `destructiveHint` / `openWorldHint` annotations; the publish guard (decision 11).
5. **Connected apps** (decision 10), the exposure-ledger lines, `/developers` and `llms.txt`
   naming the connector URL, and the guideline's new section in `docs/guidelines/using-the-api.md`.
0. **The gate**: connecting from claude.ai on production, the evidence, the retro.

## Out of scope

- **New product behaviour.** Every tool adapts a v1 route that exists today. A tool that needs
  an endpoint that does not exist waits for that endpoint, by the *Features ship before their
  endpoints* rule.
- **Signing in to Caesura with Claude**, or Caesura as an identity provider for anything else.
  The OAuth server issues access to the API and nothing more; there is no OIDC `id_token`.
- **Third-party apps in general.** The redirect allowlist is Claude's (decision 7). A developer
  portal, client secrets for other apps and a public app directory are a candidate if anyone asks.
- **Listing Caesura in Claude's connector directory.** That is a submission to Anthropic, Mitchell's
  to make once the connector has been used for a while.
- **The routine itself.** It is a Claude routine Mitchell sets up once he has connected; this
  milestone proves it can run, it does not own it.
- **Trip-confined grants**, and every tool left out in decision 4.

## Exit gate

- [ ] **Discovery:** an unauthenticated `POST /api/mcp` on production answers 401 with a
  `WWW-Authenticate` naming `resource_metadata`; both `/.well-known` documents answer 200 to a
  request from outside a browser, with `resource` equal to `https://caesura.today/api/mcp` and
  `code_challenge_methods_supported: ["S256"]` (a production `curl`, pasted).
- [ ] **The flow end to end:** an integration test registers a client, authorizes with a PKCE
  pair, exchanges the code, calls a tool, refreshes, and calls again; and is seen to fail when
  the S256 check is removed (the source edit and the red text in the PR).
- [ ] **Refusals:** a reused authorization code revokes its grant; a wrong `code_verifier`, a
  redirect URI off the allowlist, an expired access token and a rotated-away refresh token are
  each refused with the RFC's error code (unit and integration tests).
- [ ] **Two gates hold:** a tool whose scope was not granted answers `insufficient-scope`; a
  `get_trip` on a trip the person cannot see answers `not-found`; a free account cannot complete
  consent; a lapsed plan's grant is refused and works again on re-subscribing.
- [ ] **Parity:** a conformance test fails on a tool that names no v1 declaration, and on a tool
  whose input schema differs from its route's.
- [ ] **Revocation:** Disconnect in Connected apps makes the next tool call with that grant's
  access token answer 401, and its refresh token answer `invalid_grant`
  (`test:e2e:ci-like` for the page, an integration test for the refusal).
- [ ] **The publish guard:** `publish_playbook` refuses a duplicate of a published day, in its test.
- [ ] **The inspector:** the MCP Inspector connects to a preview through the loopback redirect and
  lists every tool with its annotations (a screenshot in the PR).
- [ ] **Exposure:** the MCP and OAuth routes each have a line in `exposure.ts`, and
  `exposure.test.ts` is green.
- [ ] **[walk]** Mitchell adds `https://caesura.today/api/mcp` as a custom connector in claude.ai,
  signs in with Google, approves the default scopes, and from a Claude chat has a 3-day Playbook
  researched, created and published; it appears on Discover with the right days and stops. He
  then disconnects it in Connected apps, and the next tool call in that chat asks him to
  connect again.
