# M60 — A personal agent can find Caesura, and act for you within what you allow

**Status:** **Scoped 2026-11-09 by Mitchell, placed next after M59 (current), ahead of M53.**
All fourteen decisions are answered as recommended (below). The design is **ADR-089**, and the plan
is `docs/plans/2026-11-09-M60-personal-agents.md` (deleted at gate close). Five parts as one stack,
plus part 0 on `claude/relaxed-pascal-i6125m`. Minted the same day; see
`docs/milestones/README.md`, *2026-11-09 — minted: M60, Personal Agent Protocol*.

## Why this exists

Mitchell, 2026-11-09: *"Can you read through this new AI agent protocol
https://personalagentprotocol.org/ and make a new milestone to add the ability for Caesura to be
consumed by AI agents such as Muse and Gemini."*

**Personal Agent Protocol** ("Poppy") is an open draft standard from Sierra and Meta, previewed
2026-10-06, Apache-2.0. It defines how a *Personal Agent* (software acting for one person, such as
Meta's **Muse**) discovers a *Company* (here, Caesura), identifies itself, signs the person in with
ordinary OAuth, and then uses the Company's APIs, MCP servers, website or own agent, within scopes
the person approved. Muse was demonstrated using it at launch. The Company publishes one document,
`/.well-known/poppy.json`, and every agent that speaks Poppy can use it without per-agent work.

M55 already built most of the hard part: our own OAuth 2.1 server, CIMD client IDs, the `iss`
parameter, refresh tokens, revocation, an MCP server at `/api/mcp` and Connected apps. Poppy sits
on top of that. What it adds is **discovery** (`poppy.json`), **a stricter client identity** (the
agent signs its token requests with a key), and **the Session header**, a per-request JWT that
names the agent, a pseudonymous user and a session, signed in or out.

**Gemini is not a Poppy client** as far as anything public says (re-checked 2026-11-09): Poppy's
launch partners are Meta, Sierra, Genesys, NiCE, Decagon, Rocket, Shopify, Stripe, Walmart, with
Visa and Mastercard as design partners, and Google's own effort is the Universal Commerce Protocol
(UCP), for checkout. What reaches a Gemini-based agent today is what M55 built: the remote MCP
server and the public OpenAPI description. `poppy.json` lists both, so this milestone serves Muse
directly and keeps the MCP door open for Gemini, Claude and anyone else (D12).

### Where this was read

The site's host is not reachable from a cloud session (DNS/proxy refused, 2026-11-09). The spec was
read instead from its source repository, `github.com/personal-agent-protocol/personal-agent-protocol`
at `a2f16ec` (2026-11-09): `skills/implement-personal-agent-protocol/reference/spec.md`, **draft
0.4**, which the repo says is the same text as the site. The repo also ships an implementer kit for
Companies (survey, design, four build milestones, a 72 KB checklist of every Company MUST and
SHOULD, and a validator that acts as a Personal Agent). **Re-read the spec before scoping and again
before the first part merges**: it says any part can change before 1.0, including incompatibly, and
it moved from 0.1 to 0.4 in five weeks.

## What exists, and what Poppy asks of it

| Poppy asks (spec §) | What Caesura has today | Gap |
|---|---|---|
| `GET /.well-known/poppy.json`: `protocol_version`, `organization {name, domain, logo_uri}`, `auth.scopes`, `auth.scope_hints`, and at least one of `apis`, `agent`, `web`; optional `tasks` (§3, §3.1) | `/.well-known/` holds `api-catalog`, `security.txt` and the two OAuth documents (`apps/web/src/app/.well-known/`) | **New document.** |
| Domain protected resource metadata at the bare `/.well-known/oauth-protected-resource` whose `resource` is **exactly** `https://{domain}` (§3.2) | The bare path answers `resource: …/api/mcp`, on purpose, for MCP clients that fall back to the bare form (`server/oauth/metadata.ts`, `protectedResourceMetadata`) | **Conflict.** D7 |
| AS metadata lists `protected_resources` with `https://{domain}` (and may list `/api/mcp`); `revocation_endpoint`; `grant_types_supported` with `refresh_token` (§3.2) | Revocation and both grants are there; `protected_resources` is absent (`authorizationServerMetadata`) | Add the field. |
| `client_id` is an HTTPS URL to a CIMD document with `jwks_uri`; the agent authenticates with `private_key_jwt`, assertion `aud` = issuer exactly, `ES256` MUST, `PS384` SHOULD, short-lived with `iat` and `jti` (§4.1) | CIMD is accepted (`client_id_metadata_document_supported: true`), but every client is public: `token_endpoint_auth_methods_supported: ["none"]` (`server/oauth/clients.ts`) | **New client authentication** at token and revoke, beside `none` for MCP clients. D3 |
| Direct Sign-In: auth code + PKCE, exact `redirect_uri`, `iss` on every redirect back including errors (§4.2) | Built in M55 (`authorizeRequest.ts` appends `iss` always) | Verify against the kit's checklist. |
| Every sign-in returns a refresh token; `scope` required; **never grant beyond what was requested**; at least one scope granted (§4.4, §4.7) | Every grant gets a refresh token (`OAUTH_SCOPES` comment); the rest is unverified | Verify; fix if not. |
| Every listed API accepts the Session header and, when account access is offered, the access token, and enforces scopes (§7) | OAuth tokens are honoured **only inside MCP dispatch**: `resolveActor` refuses one elsewhere with `audience` (`server/public-api/actor.ts:115`) | **The v1 API rejects OAuth tokens.** D6 |
| `Poppy-Session` JWT on every request: `typ poppy-session+jwt`, `ES256`, signed by a delegated key vouched for by a `poppy_dlg` delegation from the agent's `jwks_uri`; claims `iss aud sid sub htm htu iat jti` and `ath` when signed in; `Poppy-Version` checked; errors `invalid_session` / `session_ended` / `version_unsupported` as HTTP 400 JSON (§3.4, §5.2, §5.3) | Nothing | **New verifier and a session record.** D8 |
| 429 with `Retry-After` on every endpoint that rate-limits (§5.6) | v1's `route()` already answers 429 with `Retry-After` (`locations.int.test.ts`) | Carry to the new endpoints. |
| `tasks.endpoint`: `excluded_tasks`, an Agent Skills `skill_index`, and a `feedback.endpoint` taking `{task, description}` with 202 (§9) | Nothing | Optional. D11 |
| Website browser join at `web.browser_session_endpoint` with scope `poppy:browser-sign-in` (§6) | Nothing | Optional. D2 |
| A Company Agent reached by a conversation protocol, handoff to a person (§8) | The assistant exists, but only inside the app | Optional. D2 |
| Device Sign-In (RFC 8628) (§4.3) | Nothing | Optional. D10 |

## Decisions

**Answered 2026-11-09, all as recommended.** Mitchell: *"Let's scope M60, go with your
recommendations. D4 - Premium + free like you suggested, D3 - Recommended, D14 - Next in queue."*
ADR-089 records each one with its mechanism. Three were sharpened by the scoping survey, without
changing the recommendation: D5's signed-out surface is Discover only, because the survey found
every other tripless v1 read is the caller's own data (library, cities, account) or spends a paid
quota (geocode); D14's *next in queue* is after M59, which became current on 2026-11-08; and the
survey found no JOSE library in the repo, so ADR-089 adds `jose` as an implementation choice.

The decisions as they were put:

1. **Which version to build to.** *Recommended:* draft **0.4**, pinned, with
   `supported_versions` left empty. Record the spec commit read at scoping in the ADR, re-read
   before the first part merges, and treat a version bump after merge as a candidate, not as a
   reopened gate.
2. **Which channels `poppy.json` lists.** *Recommended:* `apis` = the MCP server (`/api/mcp`) and
   the OpenAPI description (`/api/v1/openapi.json`); `web` listed with **no**
   `browser_session_endpoint` (agents browse the public site as signed-out visitors, which M53 is
   making readable); **no `agent`**: exposing the assistant as a Poppy conversation (§8) is its own
   milestone, so it goes to `docs/candidates.md`.
3. **Which Personal Agents may connect.** Open to any agent with a valid CIMD document and
   `private_key_jwt`, the way M55 D7 opened registration, or an allowlist (Muse first).
   *Recommended:* open, plus an operator kill switch by `client_id` in the console (refuse answers
   `invalid_client` at the token endpoint and `invalid_session` at resources, §4.1).
4. **What a free account and a signed-out agent get.** M55 D6 put all API access behind Premium's
   `api.tokens`. *Recommended:* signed-out agent requests reach only what anyone can already read
   without an account (Discover playbooks, library cities, public places), and **account access
   stays Premium**, resolved per request, with the same upgrade prompt on the consent page.
   Mitchell's call: it is a business decision, not a protocol one.
5. **The signed-out surface.** Which v1 endpoints and MCP tools answer with only a Session header.
   *Recommended:* the read-only public ones in D4, under a per-session rate limit, and nothing that
   writes.
6. **The v1 API accepts OAuth access tokens.** Poppy requires every listed API to. *Recommended:*
   yes, through the same `route()` gates (scope, trip confinement, role, entitlement), for a token
   whose audience is the domain (`https://caesura.today`, the Poppy default, §4.5); MCP keeps its
   own resource-bound tokens, so a token issued for `/api/mcp` still works only there. If
   declined, `poppy.json` lists MCP only.
7. **The bare protected-resource path.** Poppy needs `resource: https://caesura.today` there; M55
   serves the MCP resource there for MCP clients that fall back to the bare form.
   *Recommended:* the bare path names the domain, the `/api/mcp` path keeps naming MCP, and the
   MCP 401's `WWW-Authenticate` keeps pointing at the `/api/mcp` path (RFC 9728 §5.1). Gate box:
   claude.ai's connector still connects on the preview before this merges.
8. **What a Session is in our database.** *Recommended:* one table keyed by `(client_id, sid,
   agent_user_id)`, holding the account once a signed-in request uses it, `last_seen_at`, and
   `ended_at`; a 30-day idle lifetime; `session_ended` for a remembered ended `sid`. Verified
   delegations cached until `exp` in the existing cache layer. The agent's User ID is opaque and
   pairwise; it is never joined to anything but the account it signs in to.
9. **Scope descriptions and hints.** *Recommended:* `auth.scopes` from `SCOPE_CATALOGUE`'s own
   words (`packages/contracts/src/publicApi.ts`), and a `scope_hints` entry
   (`changes`: `none` / `reversible` / `irreversible`, `personal_data`) for **every** scope, kept
   in contracts with a test that no scope lacks one. Publishing to Discover is `irreversible`
   in Poppy's sense (others may have copied it).
10. **Device Sign-In.** *Recommended:* no. Direct Sign-In is the spec's preferred flow (§4), and
    Device Sign-In carries RFC 10027's phishing obligations.
11. **The tasks endpoint.** *Recommended:* yes, with `excluded_tasks` for what the API does not
    offer (billing and plan changes, removing a member or changing a role, account deletion, API tokens and connected apps, referrals; inviting is offered in v1,
    and whatever else the scoping survey finds) and a `feedback.endpoint` whose reports land in a
    table the operator console lists, treated as data and never as instructions (§9.3).
    `skill_index` is a candidate.
12. **Gemini.** *Recommended:* no Gemini-specific work. What serves it is the MCP server and
    OpenAPI that already exist. Gate box: an MCP client that does not speak Poppy (Claude's
    connector) still connects and works after this milestone, signed outside any Poppy Session as
    §7 allows. If Mitchell wants proof with Gemini itself, that is a walk box, not code.
13. **How we know it conforms.** The kit's validator acts as a Personal Agent and checks discovery
    and signed-out Sessions; the checklist covers the rest. *Recommended:* run it against the PR's
    preview at the pinned kit commit, never vendored and never in CI, with its test identity
    (`keygen`) hosted on a non-production origin, and the sign-in milestone checked by hand from
    the checklist. The validator's output goes in this file as evidence.
14. **Placement.** *Recommended:* last, after M59, since nothing is hurting and Muse traffic does
    not exist yet. Mitchell's call. **Answered: next in queue**, so after M59 and ahead of M53.

**Answered later, during the build (Mitchell, 2026-11-10 unless noted).** Recorded so none is
reopened; ADR-089 carries the mechanism.

- **Signed-out reach for never-allowed agents.** A bounded fetch on `signedOut` routes only. It
  stores no row, and past the share the answer is 429 with `Retry-After`. Per IP 120 an hour, global
  500 an hour, both tunable by environment variable.
- **Report-only agents.** An agent that has never been allowed gets a Session row through
  feedback only, and its quota is charged before `gate.open`. Tasks records none.
- **Agents tab.** Capped at 50 rows, with a note when the cap is reached.
- **Client IP.** Traefik's `forwardedHeaders` are untouched and Cloudflare is DNS-only, so keying
  on the first-hop `clientIp` is fine.
- **IPv6.** `clientIp` keys an IPv6 address by its /64.

## Scope

- `/.well-known/poppy.json`, built from contracts, and the two OAuth metadata changes (D7, the
  `protected_resources` field).
- `private_key_jwt` client authentication for CIMD clients at the token and revocation endpoints:
  fetching `jwks_uri` under the address rules M55's CIMD fetch already follows, `aud` = issuer
  exactly, `ES256` and `PS384`, `jti` replay refusal.
- The Session header verifier and the session record, wired into `route()` and `/api/mcp`, with
  `Poppy-Version` and the three 400 errors.
- OAuth access tokens accepted by the v1 API (D6) and the signed-out surface (D5).
- The tasks and feedback endpoints (D11), and the feedback list in the operator console.
- Connected apps shows a Personal Agent by its CIMD `client_name` and `logo_uri`, and Disconnect
  revokes its refresh tokens (§5.5).
- ADR-089 recording the decisions, and `docs/guidelines/using-the-api.md`
  gaining a *Personal agents* section.

## Out of scope

- The assistant as a Company Agent (§8): conversations, streaming, handoff to a person, Direct
  Conversations. A candidate.
- Browser join (§6) and `poppy:browser-sign-in`.
- Device Sign-In (D10), Mediated Sign-In, and every extension (Operations, links and disclosures,
  UCP checkout).
- `skill_index` (D11), DPoP-bound tokens, Web Bot Auth operator signatures.
- Any new product behaviour: an agent can do exactly what the v1 API and MCP already allow.

## Parts (the plan has each part's files)

0. **The gate**: decisions, the ADR, the plan, the validator run and the walk.
1. **Discovery**: `poppy.json`, scope hints in contracts, the metadata changes (D7, D9).
2. **The agent signs in as itself**: `private_key_jwt` at token and revoke, the consent page
   naming the agent, Connected apps (D3).
3. **Sessions**: the verifier, `Poppy-Version`, the errors, the session table (one migration) (D8).
4. **Every listed API takes it**: v1 accepts OAuth tokens and Session headers, the signed-out
   surface, the kill switch (D4–D6).
5. **What we don't do, and what agents tell us**: tasks and feedback endpoints, the console list
   (D11).

## Exit gate

- [x] **Decisions D1–D14 are answered and recorded here**, and the ADR is written (ADR-089, 2026-11-09).
- [ ] **`poppy.json` passes** the kit validator's `check --file` and `--milestone foundation`
      against the preview, with the run's output recorded here.
      Open: needs the validator run against the preview, which waits on sign-in there. In CI, the
      document's shape is asserted by `apps/web/src/server/poppy/discovery.test.ts` (cases: pinned
      version and sign-in details; every published scope described; MCP server, OpenAPI, tasks
      endpoint listed; origin from configuration) and `apps/web/src/server/oauth/wellKnown.test.ts`
      ("serves the document for the configured origin, never the request's Host"). That is not the
      kit validator's verdict.
- [x] **The metadata agrees with itself**: the bare protected-resource document names
      `https://caesura.today`, the issuer's `protected_resources` lists it, and `/api/mcp`'s
      document still names `/api/mcp`.
      CI run 42738117635 on 4254305 (PR 718's head, which holds the whole milestone; 9 of 9 jobs success, `ci-ok` included): `apps/web/src/server/oauth/metadata.test.ts` (cases: "names the origin as the bare
      document's resource, and the issuer lists both resources"; "names the MCP endpoint as the
      resource, exactly, under the configured origin") and
      `apps/web/src/server/oauth/wellKnown.test.ts` ("names the origin bare and the MCP endpoint on
      the MCP path, whatever Host says").
- [ ] **A Session header is verified or refused** on v1 and MCP: a valid one starts a session; a
      missing delegation, a wrong `aud`, `htm` or `htu`, a stale `iat` or a wrong `ath` answers
      `invalid_session` (400, JSON); a missing `Poppy-Version` answers `version_unsupported`; an
      ended session answers `session_ended`. Each case is a test seen failing first.
      CI run 42738117635 on 4254305 (PR 718's head, which holds the whole milestone; 9 of 9 jobs success, `ci-ok` included): `apps/web/src/server/poppy/sessionHeader.test.ts` (cases: accepts a delegated Session
      JWT; refuses no delegation; refuses an aud that is not the issuer; refuses an htm or htu that
      is not this request; takes an iat within a minute and refuses beyond; "with an access token":
      refuses a missing and a wrong ath), `apps/web/src/server/poppy/sessions.int.test.ts` (cases:
      writes the row on the first request; "answers invalid_session, as a 400 with the bare error";
      "answers version_unsupported for a missing Poppy-Version or an incompatible one";
      "answers session_ended for an ended Session"), `apps/web/src/server/public-api/route.int.test.ts`
      (v1: "refuses a header that fails as invalid_session"; "refuses a missing or incompatible
      Poppy-Version as version_unsupported") and `apps/web/src/app/api/mcp/route.int.test.ts` (MCP:
      "answers invalid_session and version_unsupported as 400, before the 401 an anonymous call
      gets"). Red-first: the failure texts are in PR 716's body, not repeated here.
- [ ] **A client assertion is required and checked** for a `private_key_jwt` client: a wrong
      `aud` (including the token endpoint's URL) or a reused `jti` is `invalid_client`.
      CI run 42738117635 on 4254305 (PR 718's head, which holds the whole milestone; 9 of 9 jobs success, `ci-ok` included): `apps/web/src/server/oauth/clientAssertion.test.ts` (cases: "refuses any aud but the
      issuer, character for character", which lists the token endpoint's URL; "refuses an assertion
      with no jti, and a jti presented twice"), `apps/web/src/server/oauth/tokens.int.test.ts` (cases:
      "is refused at the code exchange without an assertion, and with one that is not its own";
      "is refused at refresh without an assertion, and an assertion works once", where a reused jti
      is `invalid_client`) and `apps/web/src/app/api/oauth/token/route.int.test.ts` ("answers 401
      invalid_client without its client_assertion, and 200 with one"). Every verifier refusal is
      one `invalid_client` path in `tokens.ts`.
- [ ] **No scope beyond what was asked** is ever granted, and a sign-in without `scope` is
      `invalid_scope`.
      CI run 42738117635 on 4254305 (PR 718's head, which holds the whole milestone; 9 of 9 jobs success, `ci-ok` included): `apps/web/src/server/oauth/authorizeRequest.test.ts` ("requires scope from a
      private_key_jwt client, and still defaults it for a public one": no `scope`, and only
      `offline_access`, are `invalid_scope`; a named scope is exactly that scope"),
      `apps/web/src/app/api/oauth/authorize/route.int.test.ts` ("refuses a scope the client did not
      ask for, and an empty choice") and `apps/web/src/server/oauth/tokens.int.test.ts` ("is refused
      a scope beyond what the grant holds, and a refusal rotates nothing").
- [ ] **The v1 API takes a Poppy access token** with every gate `route()` already applies, and an
      `/api/mcp`-audience token is still refused outside MCP.
      Open, partly covered. The audience clauses are tested: `apps/web/src/server/public-api/oauthActor.int.test.ts`
      ("is accepted on v1 when the grant was made for the domain, and refused inside an MCP
      dispatch"; "is refused on v1 when the grant was made for /api/mcp, and accepted inside the
      dispatch"; "is 401 on a bare /v1/account call"). The gates (scope, 402 on a lapsed plan, the
      owner's trip reach) are asserted there only for a token made for `/api/mcp`, run inside an MCP
      dispatch; no test sends a domain-audience token through them on v1. The code path is shared,
      but that is an inference, not an assertion.
- [x] **Signed out reaches only the public reads** (D5), and nothing that writes.
      CI run 42738117635 on 4254305 (PR 718's head, which holds the whole milestone; 9 of 9 jobs success, `ci-ok` included): `apps/web/src/server/public-api/route.int.test.ts` (cases: "reaches a route that
      declares signedOut and no other"; "is still 401 without a Session header, and with a
      credential that is not a bearer token"; "reads signed-out Discover, and nothing else, and is
      not stored as a client") and `apps/web/src/server/public-api/openapi.test.ts` ("publishes the
      signed-out read as optional security, and every other operation as requiring a bearer", which
      runs over every operation including the writes).
- [ ] **Claude's connector still connects and works** on the preview, outside any Poppy Session
      (D7, D12).
      Open: needs claude.ai's connector check on the preview, which waits on sign-in there. In CI,
      `apps/web/src/app/api/mcp/route.int.test.ts` covers the connector's own token and the MCP
      dispatch ("lists every tool with its annotations, statelessly"; "answers tools/call with and
      without the Mcp-Method and Mcp-Name headers"), not claude.ai itself.
- [ ] **The tasks endpoint answers**, and a feedback report shows in the operator console.
      Open, split. Tasks endpoint, covered by CI run 42738117635 on 4254305:
      `apps/web/src/app/api/poppy/tasks/route.int.test.ts` ("answers a verified Session with the
      excluded tasks and the feedback endpoint, cacheable") and `apps/web/src/server/poppy/tasks.test.ts`.
      Feedback stored and listed in code: `apps/web/src/app/api/poppy/feedback/route.int.test.ts`
      ("answers 202 with no body and stores the report under the verified client_id"; "recentReports"),
      `apps/web/src/app/api/admin/agents/route.int.test.ts` ("lists the reports newest first") and
      `apps/web/src/components/admin/AgentsTab.test.tsx` ("reports from agents"). Remaining: a report
      sent to the preview shows in its operator console, which needs the walk.
- [ ] **Disconnect in Connected apps signs the agent out**: its next refresh is `invalid_grant`.
      Open, partly covered by CI run 42738117635 on 4254305:
      `apps/web/src/app/api/account/connected-apps/[grantId]/route.int.test.ts` ("revokes the grant
      as the owner, and its tokens stop on their next use": refresh is `invalid_grant`) and
      `apps/web/src/components/account/ConnectedAppsSection.test.tsx` ("a Personal Agent ... has the
      same Disconnect, confirmed"). That refresh uses an ordinary registered client; no test
      refreshes a `private_key_jwt` agent's revoked grant with a valid assertion. Walk-covered.
- [ ] **[walk]** With the validator's test identity (or Muse, if Meta's agent can reach a preview
      by then), Mitchell signs in on the consent page, approves read-only scopes, and the agent
      lists his trips; then he disconnects it in Connected apps.
- [ ] A retro is appended at gate close.

**Gate status, 2026-11-11.** As of 2026-11-10 Coolify PR previews are on (KI-20261110) and
https://718.preview.caesura.today/api/health reports version
4254305ad01386281d67ad84a63b4f61d5a742b8, PR 718's head. Sign-in on the preview is not working yet
("Sign-in isn't set up on this deployment"): the Preview-scope env (`AUTH_URL` and the rest) is
being corrected in Coolify. The walk, the kit validator run and claude.ai's connector check wait on
that. The boxes ticked above are the test-backed ones, from CI run 42738117635 on PR 718's head;
the unticked ones need the preview. The preview-DB check for migration `0075`
came back clean (Mitchell, 2026-11-10): no preview applied the pre-review `0075`
(`created_at` 1794264391750 is absent from the preview DB), so there is nothing to recover.
