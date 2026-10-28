# M55 — Claude connects to Caesura as you, and can publish what it plans

**Status (2026-10-28): built, gate open.** All six code parts are merged (PRs 614, 615, 616,
617, 618 and 620, in `1c353dd`), and `0069` is applied in production (`migrate-production`
40604400973). The gate is 10 of 13. *Two gates hold*, *The inspector* and *[walk]* wait on
Mitchell (see *Exit gate*), and the retro is drafted below.

**Scoped 2026-10-27.** Minted by Mitchell the same day (*"Could you add a
milestone to the caesura project to add the ability for a oauth connector so you can connect?"*,
then *"Yes, add it"*), and placed **ahead of M43** at scoping the same day (see
`docs/milestones/README.md`, *2026-10-27 — placed: M55 ahead of M43*). All eleven decisions are
answered (below); D7, D8's hashing and D11 changed from the recommendation, and D10 was widened
and then narrowed again the same day. The design is
**ADR-083**, and the plan is `docs/plans/2026-10-27-M55-claude-connects-as-you.md` (deleted at
gate close). Five parts plus part 0. **Amended 2026-10-27** after an independent review of the
cryptography and the OAuth design, which Mitchell asked for and then approved in full: D3, D7 and
D8 below record it, and ADR-083 marks each change (P1-a to P1-c, A to L) with its source.

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
of it, so Claude (and Claude Code, and any other MCP client, D7) can act as the signed-in person
with exactly the powers M22's two gates already allow.

### What exists, and what this builds on

| Already here | Where | What this milestone does with it |
|---|---|---|
| Two credentials, one principal: a session cookie or a `tc_…` bearer token, both resolved to an `Actor` | `apps/web/src/server/public-api/actor.ts` | Adds a third credential, an OAuth access token (`via: "oauth"`), resolved to the same kind of `Actor` |
| The v1 wrapper: scope check, trip confinement, role gate, parsing, the error envelope, rate limit, pagination, once for every endpoint | `route()`, `apps/web/src/server/public-api/route.ts:437`; it calls `resolveActor` itself at `:478` | Every MCP tool runs its v1 route's own declared handler (D2). No tool re-implements a gate |
| Scopes, nothing implied by anything else | `SCOPE_CATALOGUE`, `packages/contracts/src/publicApi.ts:102`; `docs/guidelines/using-the-api.md` *Scopes* | The OAuth consent screen offers the same scopes, by the same words |
| API tokens stored as a keyed digest, shown once, always expiring, never swept | `api_tokens`, `apps/web/src/server/db/schema.ts:241`; `apps/web/src/server/api-tokens/index.ts` | **Corrected 2026-10-27:** this row said `HMAC-SHA256`. Tokens are stored as **`scrypt(secret, API_TOKEN_PEPPER)`, N=16384, ~37ms per verify** (`api-tokens/index.ts:103,152-154`), and the column comment that says `sha256(secret)` is stale (`schema.ts:250`). D8 moves tokens and the new OAuth secrets to HMAC-SHA256 together |
| API access is the `api.tokens` entitlement (Premium), resolved per request, never cached on a token row | `packages/contracts/src/entitlement.ts`, `accountCan` in `apps/web/src/server/entitlements/resolver.ts:324` | D6 |
| Sign-in is Auth.js with Google, JWT sessions, no DB adapter; previews delegate the Google round trip to production | ADR-024, ADR-025, ADR-034 | The consent page is an ordinary signed-in page; the OAuth server is ours, not Auth.js's |
| Every internal route has one line in the exposure ledger, and CI holds the public side to it | `apps/web/src/server/public-api/exposure.ts`, `exposure.test.ts` | The MCP route and the OAuth routes each get a line, under a new status (ADR-083 §9) |
| The Vercel firewall challenges automated traffic on every path outside `/api/*` | `docs/guidelines/using-the-api.md:95-109` | D9: two `/.well-known` paths need a bypass, or Claude cannot discover the server |
| `/.well-known/*` routes already exist | `apps/web/src/app/.well-known/api-catalog/route.ts`, `security.txt/route.ts` | The two metadata documents sit beside them |

### What Claude expects of the server (re-read 2026-10-27)

From Claude's connector documentation (`https://claude.com/docs/connectors/building/authentication`
and the help-centre article on custom connectors), re-read at scoping on 2026-10-27. Re-read again
before part 2 merges, because they move.

- **Transport:** the authentication page does not name one. We build **streamable HTTP,
  stateless, JSON responses** (ADR-083 §8). SSE is not built.
- **Discovery:** an unauthenticated MCP request answers **401** with
  `WWW-Authenticate: Bearer resource_metadata="…"`. If that pointer is missing, Claude probes
  `/.well-known/oauth-protected-resource/<mcp-path>` (here `/.well-known/oauth-protected-resource/api/mcp`)
  and then the root `/.well-known/oauth-protected-resource`, so both answer. That document (RFC
  9728) names the resource, which must **exactly** match the URL the person typed, and lists the
  authorization server first (only the first entry is used). The authorization server publishes
  RFC 8414 metadata.
- **Registration:** Dynamic Client Registration (RFC 7591), a **JSON** body, by default a new client
  per fresh connection. Client ID Metadata Documents are used instead if the metadata advertises
  `client_id_metadata_document_supported: true` and `none` among
  `token_endpoint_auth_methods_supported`. Claude Code's CIMD is
  `https://claude.ai/oauth/claude-code-client-metadata`. **MCP's 2026-07-28 revision deprecates
  DCR** in favour of CIMD: a client tries a pre-registered id, then a CIMD, then DCR (its
  changelog; checked 2026-10-27 in the independent review). Open DCR is still allowed, as legacy.
  So CIMD is our primary path and DCR the fallback (D7, amended), and both are tested, because
  Claude's own page above still describes DCR as the default.
- **`iss`:** the same revision says an authorization response SHOULD carry `iss`; OAuth 2.1
  §4.1.2 makes it REQUIRED. Every redirect back carries it, and the metadata advertises
  `authorization_response_iss_parameter_supported: true`.
- **PKCE:** required, S256 only, and `code_challenge_methods_supported: ["S256"]` must say so.
- **Redirects:** **only `https://claude.ai/api/mcp/auth_callback` is documented** for claude.ai,
  the desktop and mobile apps and Cowork. A `claude.com` callback is not confirmed by the current
  page; under D7 it would register like any other HTTPS redirect, just not marked as recognised.
  Claude Code uses a loopback redirect on any port (`http://localhost:<port>/callback`,
  `127.0.0.1` too).
- **Tokens:** the token endpoint takes `application/x-www-form-urlencoded`. Claude refreshes on a
  401 and up to five minutes before expiry. Refresh tokens rotate for public clients, and a dead
  one answers `invalid_grant`. Discovery, registration and token calls must answer within **10
  seconds**, a refresh within **30**.
- **Scopes:** a `scope` in the 401's challenge wins; otherwise Claude asks for the protected
  resource metadata's `scopes_supported`, plus `offline_access` if the server lists it.
- **Where Claude calls from:** `160.79.104.0/21`, discovery included.

## Decisions

### Answered

**Answered by Mitchell, 2026-10-27, at scoping.** Where he changed the recommendation, the entry
says so and the text below is his choice.

1. **"Publish a notebook" means a Playbook published to Discover — accepted.** In Caesura a
   Notebook page lives inside a trip (M30) and is never public; the public, indexable, reviewable
   thing is a **Playbook published to Discover** (ADR-050), and a 1 to 5 day itinerary is exactly a
   multi-day Playbook (M23). The routine creates an inline Playbook (`days[].stops[]`, a `summary`
   that names its sources) and publishes it. The tools are named for what the person sees
   (*create_playbook*, *publish_playbook*), and each tool's description says a Playbook is "a
   public day plan in the Discover library", so Claude does not go looking for a notebook tool.
   Trip Notebook pages are reachable too (D4), for research notes on a trip of his own.
2. **Each tool dispatches in process through its v1 route's own declared handler — accepted.**
   The handler `route()` returns (`route.ts:437`) is called with a synthetic `Request` carrying
   the `tco_` bearer; it calls `resolveActor` itself (`route.ts:478`), so the scope check, the role
   gate, parsing, validation, the error envelope and the rate limit are the ones the REST call
   gets. Tool input schemas come from the same Zod the declaration validates with
   (`handler[DECLARED].def`), through `z.toJSONSchema` with the **JSON Schema target** (not
   `openapi-3.0`, which `openapi.ts:124` uses for the REST document). The `superRefine` rules of
   `PatchPlaybookBody` (`apps/web/src/server/public-api/playbooks.ts:187-203`: at least one field;
   `expectedVersion` with any content change) cannot be expressed in JSON Schema; the tool's
   description says them in words, and the route still enforces them. **`create_playbook`'s
   `Idempotency-Key` is derived** from the grant id and a hash of the tool input, not minted per
   call, so a retried call dedupes (ADR-051's 24-hour window). A conformance test fails on a tool
   that names no v1 declaration. Calling `/api/v1` over HTTP was refused (double latency and rate
   spend for no isolation); writing tool handlers against server modules directly was refused (the
   "same logic rewritten" `exposure.test.ts` cannot see).
3. **Our own small authorization server — accepted**, under `apps/web/src/server/oauth/`, with
   storage in our Postgres beside `api_tokens`, and the **MCP TypeScript SDK
   (`@modelcontextprotocol/sdk`) for the MCP server side**. *Corrected:* `oauth4webapi` is a client
   library, so it is not a source of authorization-server primitives; the protocol checks are ours,
   small, and tested against the RFCs' error codes. A hosted identity provider (Auth0, WorkOS,
   Stytch, Clerk) was refused: a vendor, a second user directory, a sign-in page that is not ours.
   ADR-083.
   **Amended — answered by Mitchell, 2026-10-27, after the research** (ADR-083, *Independent
   review, 2026-10-27*). The hand-rolled server stands (the review found it defensible at this
   size), with what the review called its most error-prone pieces pinned down: code redemption
   and refresh rotation are each one atomic `UPDATE … WHERE … IS NULL RETURNING` (D); the issuer
   and resource come from `deploymentOrigin()`, never the `Host` header (B); every authorization
   response carries `iss` (A); the grant's stored `resource` is checked on every MCP call and any
   other `resource` is `invalid_target` (C); and part 4 records which MCP revision the SDK
   targets, since 2026-07-28 adds required `Mcp-Method` / `Mcp-Name` headers (L).
4. **The tool list — accepted, no deletes.** Each names the v1 route it adapts:

   | Tool | v1 route | Scope | Hints |
   |---|---|---|---|
   | `whoami` | `GET /v1/account` | `account:read` | read-only |
   | `search_places` | `GET /v1/geocode` | `places:read` | read-only, spends geocode quota |
   | `search_library_cities` | `GET /v1/cities` | `trips:read` (its scope today) | read-only |
   | `list_discover_playbooks` | `GET /v1/discover/playbooks` | `library:read` | read-only |
   | `list_my_playbooks` | `GET /v1/playbooks` | `library:read` | read-only |
   | `get_playbook` | `GET /v1/playbooks/{id}` | `library:read` | read-only |
   | `create_playbook` | `POST /v1/playbooks` (inline body), `Idempotency-Key` derived (D2) | `library:write` | |
   | `update_playbook` | `PATCH /v1/playbooks/{id}` (name, summary, days; `expectedVersion`) | `library:write` | |
   | `publish_playbook` / `unpublish_playbook` | `PATCH /v1/playbooks/{id}` (`visibility`) | `library:write` | open-world: publishing makes it public |
   | `list_trips` / `get_trip` | `GET /v1/trips`, `GET /v1/trips/{id}` | `trips:read` | read-only |
   | `list_notebook_pages` / `get_notebook_page` / `update_notebook_page` | `…/pages`, `…/pages/{id}` | `notebook:read` / `notebook:write` | |

   **Plus, from scoping:** `update_playbook` on a **published** Playbook's `days` passes v1's 409
   through as a tool error that says what to do: *unpublish → edit → republish*
   (`apps/web/src/server/savedDays.ts:879,915` refuse `days` on a non-private day). An inline
   create has no `visibility` field, so publishing is always a second call (`publish_playbook`, a
   second `PATCH`).

   **Left out of the first cut:** every delete (`DELETE /v1/playbooks/{id}` included), trip
   writes, invites and share links (`sharing:write`), import and export. Billing, admin, the
   assistant and token management stay out for the reasons `exposure.ts`'s `never` lines give.
5. **Default scopes — accepted.** `scopes_supported` lists the scopes the tools use, plus
   `offline_access`. The consent screen shows each in `SCOPE_CATALOGUE`'s words with a checkbox,
   all ticked except the two `notebook:` scopes, so the default grant is "see my trips and the
   library, write and publish Playbooks, search places, see who I am". A tool whose scope was not
   granted answers the v1 `insufficient-scope` error as a tool error.
6. **Premium, the same `api.tokens` entitlement, resolved per request — accepted.** A lapsed plan
   disables a grant without revoking it, exactly as it does a token. A free account reaching the
   consent page sees the same upgrade prompt as the API tokens section and cannot approve.
7. **Registration is open to any HTTPS redirect URI — CHANGED.** Mitchell wants "Claude Duet" (a
   separate Claude product whose redirect URI we do not know) and other websites to connect.
   `/api/oauth/register` accepts any `https://` redirect URI, plus loopback `http://localhost` and
   `http://127.0.0.1` on any port (Claude Code, the MCP Inspector). It refuses `http` anywhere
   else, any URI with a fragment, and wildcards. Redirects are matched **exactly** at authorize,
   except a loopback URI's port. CIMD is advertised too. **The threat review is in ADR-083 §6**:
   look-alike clients on the consent page (the client's name is shown as self-declared and
   unverified, the redirect host prominently, and Claude's known callback and Claude Code's CIMD
   are marked as recognised), open redirect, registration abuse (a per-IP rate limit on DCR,
   unused clients expiring), no plain `http` off loopback, no fragments. A developer portal, an
   app directory and client secrets for confidential clients stay out of scope.
   **Amended — answered by Mitchell, 2026-10-27, after the research.** MCP's 2026-07-28 revision
   deprecated DCR, so **CIMD becomes the primary registration path** and open DCR to any HTTPS
   redirect stays as the fallback, because Mitchell wants any website to be able to connect (E).
   The threat review changes to match: **only `https://claude.ai/api/mcp/auth_callback` is
   recognised**; a loopback redirect, Claude Code's CIMD included, gets a **localhost warning**
   instead, because anyone can present that CIMD URL with their own port (F); the consent page
   shows a CIMD client's `client_id` host beside the redirect host (G); `[::1]` is loopback too
   (H); a request without a `code_challenge`, or a verifier for a code that had none, is refused
   (I); and the CIMD fetch pins the resolved IP, refuses special-use addresses, reads at most
   5 KB and never fetches `logo_uri` or `jwks_uri` (J). Redirects are still matched exactly, with
   no normalisation.
8. **Lifetimes accepted; hashing CHANGED.** Access tokens live **one hour**; refresh tokens rotate
   on every use and live **90 days from their last use**, capped at **365 days from the grant**;
   authorization codes live **one minute** and are single-use (a second use revokes the whole
   grant). All are opaque and prefixed (`tco_` access, `tcr_` refresh, `tcc_` code).
   **Hashing:** this file said `api_tokens` used HMAC; they use scrypt (above). Mitchell's
   decision: **OAuth secrets and API tokens both move to `HMAC-SHA256` through one shared helper**,
   keyed by a key derived from `API_TOKEN_PEPPER`; **every existing `tc_` token is revoked**, with
   a recorded reason so a refused one says why (*"revoked when token storage changed; mint a new
   one"*), not upgraded on use. Never swept, so a refused secret can always say why. JWT access
   tokens were refused: they cannot be revoked before they expire, and the v1 route already reads
   Postgres on every request.
   **Amended — answered by Mitchell, 2026-10-27, after the research.** HMAC-SHA256 with a pepper
   stands: NIST SP 800-63B §5.1.2.2 requires an approved one-way function, not a slow hash, for
   look-up secrets of at least 112 bits, and CodeQL's `js/insufficient-password-hash` is recorded
   in ADR-083 §2 as a known false positive (the query keys on a name regex). Three changes for
   part 1: the pepper is **versioned** (a `key_version` column on `api_tokens` and the OAuth
   digest tables, `API_TOKEN_PEPPER_PREVIOUS` looked up after the current key), so a rotation is
   not a mass logout (P1-a); a pepper **under 32 bytes** is refused (P1-b); and the legacy refusal
   reads one row with `LIMIT 1` and verifies it with the **async** `scrypt` (P1-c). Lifetimes
   stand; a client whose rotated refresh response is lost re-consents, with no grace window (K).
9. **The firewall and where the documents live — accepted.** The MCP endpoint, registration, the
   token endpoint and revocation sit under `/api/*` (`/api/mcp`, `/api/oauth/register`,
   `/api/oauth/token`, `/api/oauth/revoke`). The two discovery documents are fixed under
   `/.well-known/` by RFC 9728 and RFC 8414, so **Mitchell adds two Vercel firewall bypass rules**,
   `/.well-known/oauth-protected-resource*` and `/.well-known/oauth-authorization-server*`, and
   `using-the-api.md`'s table (`:95-109`) gains the two rows. Allowlisting `160.79.104.0/21` was
   refused: it trusts a network, not a request. **Two constraints found at scoping:** the CSP's
   `form-action 'self'` (`apps/web/next.config.ts:118-123`) would block a native consent form POST
   that 302s to another origin, so the consent form posts with `fetch` and then navigates to the
   redirect it is handed; and `/oauth/*` is outside the proxy matcher (`apps/web/src/proxy.ts:241-250`),
   so the consent page redirects a signed-out visitor to `/signin?callbackUrl=…` itself.
10. **Connected apps in Account → Profile, with Disconnect only — answered.** Account → Profile
    gains **Connected apps** beside API tokens (`components/account/TokensSection.tsx`'s sub-view
    pattern): each grant's client name, redirect host, scopes, when it was made and last used, and
    a **Disconnect** that revokes the grant, its refresh token and every access token issued from
    it, effective on the next request. **History of the decision:** at scoping Mitchell first
    widened D10 to also build *"via <client name>"* origin labels in History and on Playbooks, then
    withdrew that the same day (2026-10-27) to keep M55 simple. The labels, a Playbook changed-by
    column, and the question of whether a connector-created Playbook should set `authorKind: "ai"`
    are now the candidate *Writes made through an API token or a connected app say so*
    (`docs/candidates.md`). In M55 a write through a grant records exactly what a write through a
    `tc_` token records today, and `authorKind` keeps today's behaviour. **The operator-console
    mirror** (the M36 account page, `components/admin/AccountPage.tsx`, which shows no tokens
    today) **moves to `docs/candidates.md`** too.
11. **No duplicate guard; publish answers the public URL — CHANGED.** `publish_playbook` does not
    refuse a duplicate of a published day (M53's decision 1 builds that guard on its own terms).
    Its answer carries the day's public URL, built with `dayPath` (`apps/web/src/lib/playbookUrls.ts:45`),
    because the v1 Playbook response has none (`playbooks.ts:59-63`). The routine's own prompt
    decides whether to publish; the walk runs it both ways.

### Risks the plan carries into part briefs (from the 2026-10-27 survey)

- **Six places branch on the credential kind**, and a new `via: "oauth"` must be handled in each:
  the rate limit (`route.ts:488`), trip confinement on a tripless request (`route.ts:640`),
  `touchLastUsed` (`route.ts:806`), the per-token geocode allowance
  (`app/api/v1/geocode/route.ts:50`), the globals gate (`app/api/v1/trips/[tripId]/globals/route.ts:17`),
  and `actorHasScope` / `actorMayReachTrip` (`actor.ts:99-114`). The brief named five; the sixth is
  `route.ts:640`. The rate-limit and geocode buckets key on the **grant id**.
- **Refusals need `WWW-Authenticate: Bearer resource_metadata="…"`** for an OAuth credential;
  today every refusal sends a bare `Bearer` (`BEARER_CHALLENGE`, `route.ts:384`, used at
  `:844-871`).
- **Audience.** A `tco_` token is minted for the resource `https://caesura.today/api/mcp` (RFC
  8707). Because tools dispatch through v1's own handlers (D2), `resolveActor` would otherwise
  accept that token on a direct `/api/v1` call too. ADR-083 §7 binds it: a `tco_` token resolves
  only inside the MCP route's dispatch, and anywhere else answers 401.
- **The exposure ledger's `Exposure` type** (`exposure.ts:28-34`) has no status that fits a public
  route that is not under `v1/` (`api/mcp`, `api/oauth/*`), and `exposure.test.ts` walks only
  `app/api/**`. A new status (ADR-083 §9), and the test widened to the MCP server's own modules.
- **The legacy `tc_` tokens.** Their digests are scrypt, so an HMAC lookup cannot find them to say
  *"revoked"*. ADR-083 §3 finds a legacy row by its stored `prefix` and checks it with one scrypt
  verify, only on an HMAC miss, until the last legacy token's `expires_at` has passed.
- **CIMD is a server-side fetch of a URL a stranger chose.** It goes through the guarded fetcher
  ADR-081 built (`server/external/remoteImage/guard.ts`), not a bare `fetch`.

## Scope

Five parts, each its own PR on `main` (the plan has every file):

1. **Storage and one way to hash a secret** (D3, D8): migration `0069` (`oauth_clients`,
   `oauth_grants`, `oauth_codes`, `oauth_tokens`, no foreign keys per ADR-025; `api_tokens` gains
   `revoked_reason`; every live `tc_` token revoked with reason `storage-changed`), the shared
   `HMAC-SHA256` helper, `api_tokens` moved onto it, and the legacy refusal.
2. **The authorization server** (D5, D6, D7, D9): both metadata documents, `/api/oauth/register`
   (DCR and CIMD, the redirect rules, the per-IP limit), `/oauth/authorize` (the consent page and
   its `fetch` post), `/api/oauth/token` (code with PKCE S256, refresh with rotation, `resource`
   per RFC 8707), `/api/oauth/revoke` (RFC 7009), and the exposure status for non-v1 routes.
3. **The OAuth actor**: `resolveActor` recognises `tco_` inside MCP dispatch, `via: "oauth"` in the
   six places, the grant-keyed rate limit, the entitlement per request, and the
   `resource_metadata` challenge.
4. **The MCP server** (D2, D4, D11): `/api/mcp`, streamable HTTP, stateless, JSON responses; the
   tools, their annotations and descriptions; the derived idempotency key; the 409 pass-through;
   publish's public URL; the conformance test and the end-to-end flow test.
5. **Connected apps and the docs** (D10): the list and Disconnect, the
   `/developers` and `llms.txt` lines, `using-the-api.md`'s connector section and firewall rows,
   and the e2e spec.
0. **The gate**: the decisions, ADR-083, the plan, connecting from claude.ai on production, the
   evidence, the retro.

## Out of scope

- **New product behaviour.** Every tool adapts a v1 route that exists today. A tool that needs
  an endpoint that does not exist waits for that endpoint, by the *Features ship before their
  endpoints* rule.
- **Signing in to Caesura with Claude**, or Caesura as an identity provider for anything else.
  The OAuth server issues access to the API and nothing more; there is no OIDC `id_token`.
- **A developer portal, a public app directory, and client secrets for confidential clients.**
  Registration is open (D7), but every client is a public client with PKCE.
- **Listing Caesura in Claude's connector directory.** That is a submission to Anthropic, Mitchell's
  to make once the connector has been used for a while.
- **The routine itself.** It is a Claude routine Mitchell sets up once he has connected; this
  milestone proves it can run, it does not own it.
- **A duplicate-day guard on publish** (D11; M53 decision 1).
- **The operator console's view of a person's grants and tokens** (D10; `docs/candidates.md`).
- **Origin labels for writes made through a grant or a token** (*"via <client name>"* in History,
  a Playbook changed-by column) and any change to `authorKind` (D10; `docs/candidates.md`).
- **Trip-confined grants**, and every tool left out in D4.

## Exit gate

**Evidence read 2026-10-28** on `main` at `1c353dd` (the merge of PR 620, which merged the six
stacked code parts together, 2026-10-27 23:26Z). File and line references are at `1c353dd`. CI is
the e2e and integration evidence: no full suite ran locally. `ci-ok` was green on each part's
final head before it merged. These were re-read over REST (`commits/<sha>/check-runs`):

| Part | PR | Final head | Actions run | `ci-ok` job | `test / integration` | `test / e2e` (1/2, 2/2) |
|---|---|---|---|---|---|---|
| 1 | 614 | `f61d3ae` | 40445785392 | 122000534415 | 121996670044 | 121996670205, 121996670139 |
| 2 | 615 | `728759c` | 40545664885 | 122344645941 | 122335573509 | 122335573926, 122335573703 |
| 3 | 616 | `e0385d7` | 40546568113 | 122348525713 | 122339638338 | 122339638199, 122339638261 |
| 4 | 617 | `aaacdfd` | 40557435386 | 122385062381 | 122377235009 | 122377235065, 122377235101 |
| 5 | 618 | `2d41565` | 40565824177 | 122410384052 | 122406781746 | 122406781881, 122406781750 |
| 6 | 620 | `ffc976d` | 40599204180 | 122525797073 | 122522855642 | 122522855719, 122522855787 |

`migrate-production`: run **40604400973**, dispatched by Neablis on `main` at `1c353dd`, started
2026-10-27T23:46:30Z, job 122540184971 `migrate` success. Its *Run pnpm --filter web db:migrate*
step succeeded, so `0069_oauth_and_hmac_secrets` was applied. The job log cannot be read through
the cloud proxy (KI-2026-10-13-f), so this rests on the step's conclusion.

- [x] **Decisions answered and recorded here**, with ADR-083, the plan, and the contracts
  changelog entries for `ApiToken.revokedReason`, the OAuth prefixes and `ConnectedApp`.
  *Evidence:* *Decisions → Answered* above (D1–D11, each amendment marked);
  `docs/architecture/ADR-083-claude-connects-through-our-own-oauth-server.md` and
  `docs/plans/2026-10-27-M55-claude-connects-as-you.md` on this branch;
  `docs/contracts/CHANGELOG.md:30-36` (`ApiToken.revokedReason`, `OAUTH_ACCESS_PREFIX` /
  `OAUTH_REFRESH_PREFIX` / `OAUTH_CODE_PREFIX`, part 1) and `:16-25` (`ConnectedApp`, part 5).
- [x] **One way to hash a secret:** API tokens and every OAuth secret are stored as
  `HMAC-SHA256` through one helper (no `scrypt` left in `api-tokens/`), every `tc_` token live
  before migration `0069` is revoked with its reason, and a request with one answers
  `token-revoked` saying a new token must be minted (an integration test seen red; the migration
  applied by `migrate-production`).
  *Evidence:* the helper is `server/secrets/keyedDigest.ts`. API tokens store through it
  (`api-tokens/index.ts:18,153`), and so do the OAuth secrets (`oauth/tokens.ts:6`,
  `oauth/clients.ts:16`, `oauth/grants.ts:7`). The revocation is
  `apps/web/drizzle/0069_oauth_and_hmac_secrets.sql:84`
  (`UPDATE "api_tokens" SET … revoked_reason = 'storage-changed' WHERE "revoked_at" IS NULL`).
  The tests are `apiTokens.int.test.ts:556` (*is refused as revoked with storage-changed*), `:567`
  (still refused after a pepper rotation) and `public-api/route.int.test.ts:206` (the
  *"…revoked when token storage changed on <date>. Mint a new one."* message). PR 614's body
  records them seen red, for example `- "message": "This token was revoked when token storage
  changed on 2026-10-28. Mint a new one." + "message": "This token was revoked."`. CI
  `test / integration` 121996670044 is green on `f61d3ae`, and `migrate-production` 40604400973 is above.
  **On the parenthesis:** one `scrypt` remains, in `api-tokens/legacyScrypt.ts:1,39`. It
  verifies a pre-0069 token only so that it can be refused as `storage-changed`, which is the
  refusal this box asks for. D8 (P1-c) and ADR-083 §3 require it, it stores nothing, and
  KI-2026-10-27-e deletes it by 2027-10-27.
- [x] **Discovery:** an unauthenticated `POST /api/mcp` on production answers 401 with a
  `WWW-Authenticate` naming `resource_metadata`; both `/.well-known` documents (and the
  `/.well-known/oauth-protected-resource/api/mcp` path form) answer 200 to a request from outside
  a browser, with `resource` equal to `https://caesura.today/api/mcp` and
  `code_challenge_methods_supported: ["S256"]` (a production `curl`, pasted).
  *Evidence:* a production `curl` from a cloud container (not a browser), 2026-10-28T00:06:12Z,
  pasted unchanged:

  ```text
  $ curl -sS https://caesura.today/.well-known/oauth-protected-resource
  {"resource":"https://caesura.today/api/mcp","authorization_servers":["https://caesura.today"],"scopes_supported":["trips:read","trips:write","notebook:read","notebook:write","library:read","library:write","sharing:write","account:read","places:read","offline_access"],"bearer_methods_supported":["header"]}
  [HTTP 200]

  $ curl -sS https://caesura.today/.well-known/oauth-protected-resource/api/mcp
  {"resource":"https://caesura.today/api/mcp","authorization_servers":["https://caesura.today"],"scopes_supported":["trips:read","trips:write","notebook:read","notebook:write","library:read","library:write","sharing:write","account:read","places:read","offline_access"],"bearer_methods_supported":["header"]}
  [HTTP 200]

  $ curl -sS https://caesura.today/.well-known/oauth-authorization-server
  {"issuer":"https://caesura.today","authorization_endpoint":"https://caesura.today/oauth/authorize","token_endpoint":"https://caesura.today/api/oauth/token","registration_endpoint":"https://caesura.today/api/oauth/register","revocation_endpoint":"https://caesura.today/api/oauth/revoke","response_types_supported":["code"],"grant_types_supported":["authorization_code","refresh_token"],"code_challenge_methods_supported":["S256"],"token_endpoint_auth_methods_supported":["none"],"revocation_endpoint_auth_methods_supported":["none"],"client_id_metadata_document_supported":true,"authorization_response_iss_parameter_supported":true,"scopes_supported":["trips:read","trips:write","notebook:read","notebook:write","library:read","library:write","sharing:write","account:read","places:read","offline_access"]}
  [HTTP 200]

  $ curl -sS -D - -o /dev/null -X POST -H 'content-type: application/json' -d '{}' https://caesura.today/api/mcp
  HTTP/2 401
  www-authenticate: Bearer resource_metadata="https://caesura.today/.well-known/oauth-protected-resource/api/mcp"
  ```
- [x] **The flow end to end:** an integration test registers a client, authorizes with a PKCE
  pair, exchanges the code, calls a tool, refreshes, and calls again; and is seen to fail when
  the S256 check is removed (the source edit and the red text in the PR).
  *Evidence:* `server/mcp/flow.int.test.ts:158` (*registers, consents, exchanges, calls,
  refreshes and calls again*). The CIMD path is `:183`. PR 617's red-first table has the S256
  edit and its failure: *`verifyS256` returns true on a mismatch* → *all 3 `expected 200 to be
  400` (the wrong-verifier exchange)*. PR 615's table adds *the S256 check removed* →
  `expected 'ok' to be 'invalid_grant'` on `oauth/tokens.int.test.ts:159`. CI
  `test / integration` 122377235009 is green on `aaacdfd`.
- [x] **Refusals:** a reused authorization code revokes its grant; a wrong `code_verifier`, a
  missing `code_challenge` or `code_verifier`, an `http` redirect off loopback, a redirect with a
  fragment, a redirect that does not exactly match the registered one (normalisation cases
  included), a `resource` that is not the MCP URL (`invalid_target`), an expired access token, a
  `tco_` token on a direct `/api/v1` call, and a rotated-away refresh token are each refused with
  the RFC's error code; **two parallel redemptions of one code, and two parallel refreshes of one
  token, let exactly one through** (an integration test against the real database, seen red with
  the atomic `UPDATE` split into a read then a write); and **every authorization response, code
  or error, carries `iss`** equal to the configured issuer, which a forged `Host` header does not
  change (unit and integration tests).
  *Evidence:* the files are under `apps/web/src`.
  - **Code reuse:** `server/oauth/tokens.int.test.ts:139`.
  - **PKCE:** `:159` (no verifier, or the wrong one) and `:167` (a code row with no challenge),
    plus `server/oauth/authorizeRequest.test.ts:81-93` (no `code_challenge`, `plain`, no method).
  - **Redirects:** `server/oauth/redirects.test.ts:17-30` (http off loopback, a fragment, an empty
    fragment, userinfo, custom schemes) and `:48-80` (exact match, the normalisation cases,
    loopback only on its port). `app/api/oauth/register/route.int.test.ts:35-47` answers them
    `invalid_redirect_uri`.
  - **Resource:** `invalid_target` at `tokens.int.test.ts:132` and `authorizeRequest.test.ts:96`.
  - **Expired access token:** `server/oauth/verifyAccess.int.test.ts:66`.
  - **`tco_` on bare `/v1`:** `server/public-api/oauthActor.int.test.ts:52` (401 with the challenge).
  - **Rotated-away refresh token:** `tokens.int.test.ts:199`.
  - **Races:** `tokens.int.test.ts:148` (parallel code redemption) and `:209` (parallel refresh).
    PR 615 records both seen red with the `IS NULL` dropped from the `UPDATE`:
    `expected [ 'ok', 'ok' ] to deeply equal [ 'invalid_grant', 'ok' ]`, 3 runs of 3 once the pool
    was warmed.
  - **`iss`:** on Allow and on Deny (`access_denied`), `app/api/oauth/authorize/route.int.test.ts:83,92`.
    On the PKCE and `invalid_target` error redirects, `authorizeRequest.test.ts:91,100`.
  - **Forged `Host`:** `server/oauth/wellKnown.test.ts:43`, with Host and X-Forwarded-Host both
    forged. Every `iss` above comes from `oauthIssuer()` (`server/oauth/metadata.ts:20-22`,
    `deploymentOrigin()`), which takes no request, so a header cannot reach it. No test forges
    Host on the authorize route itself.

  CI `test / integration` 122335573509 is green on `728759c`, and 122339638338 on `e0385d7`.
- [x] **Registration abuse is bounded:** DCR past its per-IP limit answers 429, and a client never
  used within its window is refused at authorize (tests).
  *Evidence:* `app/api/oauth/register/route.int.test.ts:58` (429 with Retry-After past the per-IP
  limit) and `:70` (one IPv6 /64 counted as one). `server/oauth/clients.int.test.ts:312`: a client
  with no grant expires after 24 hours, and `resolveClient`, which authorize calls, answers
  `expired-client`. PR 615 records `expected 201 to be 429` with the quota decision ignored, and
  the expiry red. CI 122335573509 is green on `728759c`.
- [ ] **Two gates hold:** a tool whose scope was not granted answers `insufficient-scope`; a
  `get_trip` on a trip the person cannot see answers `not-found`; a free account cannot complete
  consent; a lapsed plan's grant is refused and works again on re-subscribing.
  *Open, 2026-10-28.* Three of the four clauses have tests:
  - **Scope:** `app/api/mcp/route.int.test.ts:133` (a tool error naming `insufficient-scope`) and
    `server/public-api/oauthActor.int.test.ts:65`.
  - **Free account:** `app/api/oauth/authorize/route.int.test.ts:96` (402, nothing issued).
  - **Lapsed plan:** `oauthActor.int.test.ts:100` (402, then 200 after re-subscribing).

  The `get_trip` clause has no test through a grant, and its wording disagrees with the code.
  v1 answers a stranger's trip **403 `forbidden`**, not `not-found`
  (`server/public-api/route.int.test.ts:298-310`: *"403 and not 404: `tripAccessFor` answers
  `forbidden` for a stranger…"*). The only OAuth trip test, `oauthActor.int.test.ts:78`, covers
  the owner's own trip. **Needs from Mitchell:** either amend the clause to `forbidden` (and accept
  the shared v1 test as the gate, since D2 dispatches through the same handler), or ask for a
  `get_trip`-through-a-grant test on a stranger's trip.
- [x] **Parity:** a conformance test fails on a tool that names no v1 declaration, and on a tool
  whose input schema differs from its route's.
  *Evidence:* `server/mcp/conformance.test.ts:134` (*refuse a tool whose handler has no
  declaration*) and `:146` (*refuse a schema that differs from its route's*), plus `:116-127` (path
  and handler identity). PR 617 has them seen red: `+ "whoami: its handler did not come through
  route()"` and `+ "create_playbook: its branches differ from the route's"`. CI `test / unit`
  122377234992 is green on `aaacdfd`.
- [x] **Publish answers the public URL:** `publish_playbook`'s result carries the day's
  `https://…/playbooks/day/<slug>-<uuid>`, and `update_playbook` on a published day's `days`
  answers a tool error that says unpublish, edit, republish (tests).
  *Evidence:* `server/mcp/dispatch.int.test.ts:196` (`published.url` equals
  `deploymentOrigin() + dayPath(…)`, matching `/playbooks/day/two-days-in-lisbon-`) and `:165`
  (*answers a published Playbook's new days with unpublish, edit, republish*). PR 617 has both seen
  red. CI 122377235009 is green on `aaacdfd`.
- [x] **Revocation:** Disconnect in Connected apps makes the next tool call with that grant's
  access token answer 401, and its refresh token answer `invalid_grant`
  (`pnpm --filter web test:e2e:ci-like e2e/m55-connected-apps.spec.ts` for the page, an
  integration test for the refusal).
  *Evidence:* `apps/web/e2e/m55-connected-apps.spec.ts:31`: Disconnect, confirm, and the row
  reads *Disconnected* at `:81-84`; `whoami` after disconnect is 401 at `:87`. PR 618 records
  ci-like `2 passed` and the spec seen red (`Error: whoami after disconnect Expected: 401
  Received: 200`). CI `test / e2e` is green on `2d41565` (122406781881, 122406781750) and on
  `ffc976d` (122522855719, 122522855787). The integration test is
  `server/mcp/flow.int.test.ts:170-178` (after `revokeGrant`, `whoami` is 401 with
  `error="invalid_token"`, and the refresh is 400 `invalid_grant`). CI 122406781746 is green on
  `2d41565`.
- [ ] **The inspector:** the MCP Inspector connects to a preview through the loopback redirect and
  lists every tool with its annotations (a screenshot in the PR).
  *Open, 2026-10-28.* It is blocked on preview by KI-2026-09-16-d: no preview account holds
  `premium@v2`, so consent cannot be approved there. `app/api/mcp/route.int.test.ts:106` (*lists
  every tool with its annotations, statelessly*) covers the listing in CI, but it is not the
  Inspector and not a screenshot. **Needs from Mitchell:** the Inspector against production, or
  against a preview with a premium account, and a screenshot on PR 613. Otherwise, waive the box.
- [x] **Exposure:** the MCP, OAuth and Connected-apps routes each have a line in `exposure.ts`, and
  `exposure.test.ts` is green, including its check over the MCP server's modules.
  *Evidence:* `server/public-api/exposure.ts:119-127` (`oauth/register`, `oauth/token`,
  `oauth/revoke`, `oauth/authorize`, `mcp`) and `:183-191` (`account/connected-apps`,
  `…/[grantId]`, `never`). `exposure.test.ts:107` (a line for every route), `:143` (connected apps
  kept off the public side) and `:153` (*walks the MCP server's modules as part of the public
  side*). CI `test / unit` 122522855709 is green on `ffc976d`, the last head before merge.
- [ ] **[walk]** Mitchell adds `https://caesura.today/api/mcp` as a custom connector in claude.ai,
  signs in with Google, approves the default scopes, and from a Claude chat has a 3-day Playbook
  researched, created and published; it appears on Discover with the right days and stops, and the
  chat reports its public URL. He then disconnects it in Connected apps, and the next tool call in
  that chat asks him to connect again.
  *Open, 2026-10-28. Partial evidence, not a tick:* on 2026-10-28 the M55 orchestrator's own
  Claude session had the Caesura connector connected against production. Its `whoami` returned
  `{"planVersionRef":"premium@v2","entitlements":[…,"api.tokens",…]}`. That shows production
  registration, consent and token issue, an MCP tool call, and the HMAC digest under production's
  pepper. **Not walked:** the 3-day Playbook researched, created and published to Discover with
  its public URL; Disconnect in Connected apps; and the next call asking to reconnect. The
  Security tab, where Connected apps now lives (part 6), has not been seen rendered at 390px or on
  desktop by anyone. **Needs from Mitchell:** that walk on production, ideally at both widths.

## Retro — written 2026-10-28 (10 of 13 boxes ticked)

This is a draft, written on part 0 (PR 613) before the close. Three boxes are open: *Two gates
hold*, *The inspector* and *[walk]*. Each says what it needs from Mitchell.
`pnpm milestone close M55` has not been run, and the plan has not been deleted.

### What went well

- **Six parts and one migration in under a day.** The milestone was scoped on 2026-10-27. All
  six code parts (PRs 614, 615, 616, 617, 618, 620) merged as one stack in `1c353dd` at
  23:26Z the same day, each with `ci-ok` green on its final head (table above). `0069` was applied
  20 minutes later (`migrate-production` 40604400973, 23:46Z), which kept the window short in
  which v1 bearer requests could answer 500.
- **Red-first caught a race test that proved nothing.** On a cold connection pool, the split
  `SELECT`-then-`UPDATE` passed the parallel-redemption test. The second request waited for a
  connection while the first ran to the end. The test only went red (3 of 3) once it warmed
  the pool first (`warmPool`; PR 615, *On the races*). Without the seen-red rule, the gate's
  most important refusal would have shipped untested.
- **The independent crypto and OAuth review paid for itself before any code.** Its amendments
  (P1-a to P1-c, A to L) each became a test with a recorded red. Pepper rotation is
  `apiTokens.int.test.ts:567`, `iss` is `authorize/route.int.test.ts:83,92`, and the resource
  binding is `verifyAccess.int.test.ts:110`. PR 614 also caught a second-order defect: after a
  pepper rotation, the legacy refusal answered `unknown` instead of `revoked` (finding 2).
- **Production worked on the first connection.** The discovery `curl` (Discovery box) and the
  orchestrator's own connector session (`whoami` → `premium@v2` with `api.tokens`) both
  succeeded on 2026-10-28, the morning after the merge.
- **Part 6 was absorbed without disrupting the stack.** Mitchell asked for a Security tab
  mid-milestone. It was planned on part 0 (`217028c`), built as PR 620 on top of part 5, and
  merged in the same stack.

### What could be better

- **The orchestrator's share missed its target by double: 29.9% against under 15%**, with a
  214k peak context (spend block below). The orchestrator held six stacked parts and their
  reviews in one context. Moving each part's review and fix loop into the part's own session
  would have kept the orchestrator to merges and the tracker.
- **The tracker on PR 613 was not kept current.** Until this close its table listed five parts
  with empty PR cells, and no part 6 (`close-a-milestone` step 1). The state of each part had to
  be rebuilt from REST at the close. The tracker should be updated in the same turn as each PR
  opens or merges.
- **Two gate clauses were written without checking the code or the environment.** *Two gates
  hold* asks for `not-found` on a stranger's trip, but v1 has answered `forbidden` by design
  since M22 (`public-api/route.int.test.ts:298-310`). *The inspector* asks for a preview walk
  that KI-2026-09-16-d already said cannot pass consent on a preview. Checking each test-shaped
  box against the code, and each walk box against `docs/known-issues/open/`, at scoping would
  have caught both.
- **Two KIs were filed under the same id.** Part 1 filed KI-2026-10-27-e (the legacy scrypt
  branch, cited in `api-tokens/index.ts:268` and `legacyScrypt.ts:9`). Part 0 filed the
  MCP-revision gap as -e too. The collision surfaced at this merge, and part 0's copy is now
  KI-2026-10-27-j. Two branches allocating KI letters on the same day should each read `main`'s
  `open/` first.
- **The gate wording drifted from the decision it records.** *One way to hash a secret* says
  "no `scrypt` left in `api-tokens/`", while D8 (P1-c) itself keeps one scrypt verify for the
  legacy refusal (`legacyScrypt.ts`). The box is ticked with that noted. Gate text written
  before an amendment should be re-read when the amendment lands.

### Leftovers

- **Two gates hold:** Mitchell's call. Either amend the clause to `forbidden`, or have a
  `get_trip`-through-a-grant test written.
- **The inspector:** Mitchell's call. A screenshot against production, or with a premium
  preview account, or waive it (KI-2026-09-16-d).
- **[walk]:** Mitchell's, on production. It includes the Security tab at 390px and on desktop,
  which nobody has seen rendered.
- **`scopes_supported` is wider than D5 says.** Production lists `trips:write` and
  `sharing:write` (the Discovery `curl`), but D5 says it lists "the scopes the tools use, plus
  `offline_access`", and no tool uses either. Mitchell's call: narrow `OAUTH_SCOPES`
  (`server/oauth/metadata.ts:34,59`), or amend D5.
- KI-2026-10-27-e: delete `api-tokens/legacyScrypt.ts` by 2027-10-27.
- KI-2026-10-27-f: a local ci-like build needs an 8 GB heap.
- KI-2026-10-27-g: a client revoking its own token is recorded as `owner`.
- KI-2026-10-27-h: the register counter sweep scans the whole table.
- KI-2026-10-27-i: the exposure walk misses a bare side-effect import.
- KI-2026-10-27-j: the MCP server cannot serve a client that speaks only 2026-07-28.
- `docs/candidates.md`: *Writes made through an API token or a connected app say so* (the
  *"via <client>"* labels, D10), and the operator-console mirror of grants and tokens.
- Listing Caesura in Claude's connector directory: Mitchell's call, once the connector has been
  used for a while (*Out of scope*).

## Spend
<!-- session-metrics:milestone v1 -->

**Not generated here.** The two build sessions' transcripts went with their containers, so this
close could not run `pnpm -s session-metrics --milestone`. The figures below are the ones those
sessions reported in their hand-offs, written in the generated block's shape. No dollar cost was
recorded for either session, so the block reports units only (units = input + 1.25 × cache
write + 0.1 × cache read; output excluded).

| Session | Block | Agents | Calls | Units |
|---|---|---|---|---|
| Earlier build session (scoping and the first parts) | counts only | – | 87 orchestrator requests, 13 `phase-implementer`, 10 `part-reviewer` | **unknown** |
| Previous build session (the parts to merge) | carried | 13 | 429 | 5.50M |
| This close (part 0) | none | – | – | not measured |

**By agent type, previous build session**

| Who | Agents | Calls | Peak context | Units | Share |
|---|---|---|---|---|---|
| `phase-implementer` | 6 | 196 | – | 1.92M | 34.8% |
| `orchestrator` | 1 | 66 | 214k | 1.64M | 29.9% |
| `phase-verifier` | 1 | 65 | – | 911k | 16.6% |
| `part-reviewer` | 3 | 73 | – | 600k | 10.9% |
| `general-purpose` | 2 | 29 | – | 433k | 7.9% |
| **Total** | **13** | **429** | | **5.50M** | |

The earlier session reported request counts per agent type, but no units, so its spend is
unknown and is not in any total here.

**Parts:** 7 (part 0 and the six code parts).

**Lines added: 11,652.** This is
`git diff --shortstat 837eef5 1c353dd -- apps packages`. `837eef5` is PR 614's base, and it is
also `merge-base(837eef5, 1c353dd)`, the first parent of PR 620's merge commit. The command
gives 108 files changed, 11,652 insertions and 508 deletions. No `*.generated.json` or
`pnpm-lock.yaml` change is in that range. **Without the migration snapshot
`apps/web/drizzle/meta/0069_snapshot.json` (4,194 lines), the count is 7,458**, the figure that
compares with M54's (which had no snapshot).

**Targets**

| Target | Result | Measured |
|---|---|---|
| Orchestrator share of units < 15% | missed | 29.9% (previous build session) |
| No phase-implementer averaging > 250k context | not measurable | no per-builder average carried |
| GitHub wakes per merged part < 5 | not measurable | not carried |
| Dollars per 1k lines added < 20 | not measurable | no recorded cost |
| Coordinator-message re-writes <= 2 | not measurable | not carried |

### Spend against the last milestone

M54 is the last closed milestone.

- **Dollars per 1,000 lines added (under 20):** not measurable, because no session recorded a
  cost. M54 was $41.0. In units, the previous build session spent 5.50M over 7,458 lines without
  the snapshot (about 737k units per 1,000 lines). That excludes the earlier session, so it
  understates the total.
- **Orchestrator's share (under 15%):** missed at 29.9%; M54 was 20.4%. The cause is in
  *What could be better*: one orchestrator context held a six-part stack, its reviews and its
  merge.
- **A builder's average context (none over 250k):** not measurable, for M55 as for M54.
- **GitHub wakes per merged part (under 5):** not measurable; M54 measured 0 in its close.
- **Cache re-writes after a coordinator message (2 or fewer):** not measurable; M54 measured 0
  in its close.
