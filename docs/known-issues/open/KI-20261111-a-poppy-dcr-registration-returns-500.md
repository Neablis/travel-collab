### KI-2026-11-11-a — Poppy dynamic client registration returns 500, so no fresh agent can onboard

- **Severity:** correctness. The Poppy front door is closed: a fresh personal
  agent cannot register a client, so it can never reach sign-in, a token, or
  the MCP/OpenAPI channels. Everything else a fresh agent touches works
  (discovery, OAuth metadata, MCP 401, tasks endpoint).
- **Area:** `apps/web/src/app/api/oauth/register/route.ts` (POST handler,
  `registerClient`, `oauthRegisterQuota`, `consumeQuota`, `keyedDigest`),
  `apps/web/src/server/oauth/clients.ts` (`registerClient`),
  `apps/web/src/server/quota.ts` (`oauthRegisterQuota`, `consumeQuota`,
  `sweepExpiredCounters`), `apps/web/src/server/poppy/discovery.ts`
  (`poppyDocument`), `apps/web/src/app/.well-known/poppy.json/route.ts`,
  `apps/web/src/server/oauth/metadata.ts`.
- **Symptom / What happens:** `POST https://caesura.today/api/oauth/register`
  returns HTTP 500 with an empty body, on every registration shape tried. The
  route exists (`GET` on the same path returns 405), so the handler is
  crashing rather than the route missing. A 500 with no body gives the client
  nothing to distinguish a bad request from a broken server.
- **Evidence (the fresh-agent test, 2026-11-11 ~23:52–23:56 UTC):** Sunny
  (Muse), acting as a fresh agent at Mitchell's request, ran the Poppy
  walkthrough from discovery only:
  - `GET /.well-known/poppy.json` → 200, `protocol_version: "0.4"`, org
    Caesura, nine scopes, MCP + OpenAPI channels, tasks endpoint, `web: {}`.
  - `GET /.well-known/oauth-authorization-server` → 200, full metadata
    (issuer, authorize/token/register/revoke, PKCE S256,
    `client_id_metadata_document_supported: true`).
  - `POST /api/mcp` (initialize, no auth) → 401 with a correct
    `WWW-Authenticate` pointing at
    `/.well-known/oauth-protected-resource/api/mcp`, which returns 200.
  - `GET /api/poppy/tasks` (no auth) → 200, `excluded_tasks` + `feedback`
    endpoint.
  - DCR, four shapes, all `500` with an empty body: full body (client_name,
    redirect_uris, grant_types authorization_code+refresh_token,
    response_types code, token_endpoint_auth_method none, scope), minimal
    (redirect_uris + client_name), code-only grant without scope, https
    redirect_uri.
  - Last known good: 2026-11-09, the same endpoint returned 201 (probe client
    `1c436920-1f7b-4714-ae1b-afcbd7aa71f6` registered). Live API `info.version`
    is 2.5.0 (`apps/web/src/server/public-api/openapi.ts:42`); the regression
    likely arrived with the Poppy deploy that bumped it from 2.4.0.
- **Why not fixed here:** filed as a KI per Mitchell's ask while he travels;
  the fix needs the server-side error (Vercel logs) and a look at the handler
  path, not a doc change.
- **Fix path:** reproduce against a preview or locally with the minimal body
  above and read the thrown error. Prime suspects, in order: the quota path
  (`consumeQuota` / `oauthRegisterQuota` counter read/write — see
  KI-20261027-h, the register counter sweep scans the whole table) and
  `registerClient` validation/DB insert. Then: return a proper OAuth error
  instead of an empty 500 (`400 invalid_client_metadata` for a bad body,
  `503 temporarily_unavailable` when the store is down) so a client can tell
  the two apart; add a regression test to
  `apps/web/src/app/api/oauth/register/route.int.test.ts` covering the minimal
  body; re-run the full fresh-agent walkthrough end to end (discovery → DCR →
  authorize → token → MCP `initialize` + `tools/list`) and record the pass
  here as the proof line.
- **Remaining Poppy gaps (decide while here — not separate defects, but the
  same agent should settle them before calling Poppy done):**
  1. Signed-out reads: `GET /api/v1/discover/playbooks` 401s without a token,
     so a guest agent cannot browse published Playbooks at all; the only
     signed-out surface is the website itself. Decide whether that is intended
     (API always needs a token) or the Discover feed should be readable in a
     guest session — the `library:read` scope text says "browse published
     Playbooks".
  2. `"web": {}` in `poppy.json` declares the web channel with no
     browser-session endpoint. Declare the endpoint or drop the channel.
  3. `protocol_version: "0.4"` vs the published draft (0.3, frozen
     2026-11-04): confirm what 0.4 tracks and link the spec revision, so a
     client built against published 0.3 does not drift. (The poppy.json route
     comment cites "spec 3" — read as section 3, Discovery, not the version.)
  4. No session endpoint is listed in the discovery doc; sessions go through
     the OAuth code flow and the MCP channel takes a plain `Bearer` header
     (`bearer_methods_supported: ["header"]`). Confirm that is the intended
     path and say so in the doc or a comment, so the next reader does not go
     hunting for a session route.
- **Cross-reference:** KI-20261027-h (oauth register counter sweep scans the
  whole table), KI-20261027-e, KI-20261027-g, ADR-083 (OAuth/DCR design, §6:
  registration is open to anyone, consent is the defence). API 2.5.0.
- **First noted:** 2026-11-11, fresh-agent Poppy test by Sunny (Muse) at
  Mitchell's request; DCR last known good 2026-11-09.
