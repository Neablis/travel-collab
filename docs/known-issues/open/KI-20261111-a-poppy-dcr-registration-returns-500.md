### KI-2026-11-11-a — Poppy dynamic client registration returns 500, so no fresh agent can onboard

- **Severity:** correctness, and wider than registration. The cause is migration
  `0075_agent_sessions` merged to `main` with M60 (`d05a1fd`, 2026-11-11 18:38 UTC) and
  deployed, but not applied to the production database. Every query that names a column or
  table 0075 adds throws, so **every OAuth surface fails**, not only DCR: registration (the
  insert names `oauth_clients.logo_uri`), the token endpoint and every OAuth-authenticated
  MCP or `/api/v1` call (`grantOf`'s `select()` names `oauth_grants.token_endpoint_auth_method`;
  `clientIsBlocked` reads `oauth_client_blocks`), authorize for a DCR client
  (`resolveClient`'s `select()`), and Poppy Session verification. Claude's connector is in
  that set.
- **Area:** `apps/web/drizzle/0075_agent_sessions.sql` (pending in production),
  `.github/workflows/migrate-production.yml`, `.github/workflows/migration-pending.yml`;
  `apps/web/src/app/api/oauth/register/route.ts`, `apps/web/src/app/api/oauth/token/route.ts` and
  `apps/web/src/app/api/oauth/revoke/route.ts` (had no catch, so a throw became an empty 500);
  `apps/web/src/server/oauth/errors.ts` (`handlerFailed`).
- **Symptom / What happens:** `POST https://caesura.today/api/oauth/register` returns HTTP 500
  with an empty body for every registration shape, from the M60 deploy onward. Last known good
  2026-11-09 (probe client `1c436920-1f7b-4714-ae1b-afcbd7aa71f6`, 201).
- **Diagnosis (2026-11-12):**
  - `migration-pending` went red on the M60 merge (`d05a1fd`, 18:38 UTC) and stayed red; the
    last `migrate-production` run is 2026-11-09 (`7b390a2`, through 0074). Nothing applied
    0075. The detector did its job; nobody read it.
  - The registration insert's SQL, from drizzle for the current schema:
    `insert into "oauth_clients" (…, "first_used_at", "logo_uri") values (…, default)`.
    Against a database at 0074 that is `column "logo_uri" does not exist`.
  - Not the quota path the original fix path suspected: `consumeQuota` already fails closed to
    a JSON 503, and `registerClient`'s validation answers 400s before the insert.
  - "Vercel logs" in the original entry: production has been on Coolify since 2026-11-09 (M59);
    the error is in the app container's logs there.
- **The four "remaining Poppy gaps", checked against the published 0.4 spec** (frozen
  2026-11-10 as the 1.0 release candidate, `personal-agent-protocol` `content/versions/0.4/spec.mdx`):
  1. *Signed-out Discover 401s:* not a defect. `/v1/discover/playbooks` declares `signedOut`
     (ADR-089 decision 5) and answers a request carrying a verified `Poppy-Session` header with
     no token. The test sent no Session header, which §5.6 forbids an agent to leave out; the
     `401` with `WWW-Authenticate: Bearer scope="library:read"` is §7's answer to that request.
  2. *`"web": {}`:* conforms. §3.1 makes `browser_session_endpoint` optional and says that
     without it agents browse as ordinary signed-out visitors (ADR-089 decision 2).
  3. *`protocol_version: "0.4"` vs "published 0.3":* the premise is stale. 0.4 was published on
     2026-11-10 and 0.3 is superseded. ADR-089 pinned `a2f16ec` (2026-11-09); the only changes
     between it and the published 0.4 are optional (`scopes_supported` in protected resource
     metadata; §10.8's consent-page advice), noted as candidates, not defects.
  4. *No session endpoint:* correct. A Session starts with the first request whose
     `Poppy-Session` carries a new `sid` (§5); a plain `Bearer` beside it is §7's signed-in
     request. Now said in `server/poppy/discovery.ts`.

  So the 2026-11-11 walkthrough never reached Poppy proper: with no agent identity, Session
  header or `Poppy-Version`, it exercised plain OAuth and MCP only.
- **Fixed in code (PR 729):** the register, token and revocation routes catch a throw and
  answer `500 server_error` in RFC 6749's JSON shape, logging the error, instead of an empty
  500 (`handlerFailed`). Deliberately not a 503 with `Retry-After`: a throw is rarely
  transient, and a retried token request could present a spent secret (KI-2026-11-12-a).
  Each route's `route.int.test.ts` has a store-failure test, seen red with the catch removed.
  `register/route.int.test.ts` also pins three of the walkthrough's four registration shapes
  answering 201 (the fourth is the existing https test); those pass with or without the catch
  and guard the request shapes, not the fix.
- **Why still open:** the outage itself ends only when `migrate-production` is dispatched
  (manual by design, ADR-004). Then, for the proof line: `migration-pending` re-run green; a
  minimal registration on production answers 201; Claude's connector answers `tools/list`; and
  a real Poppy walkthrough (ADR-089 decision 13: the kit's validator with its `keygen`
  identity, then discovery → signed-out Discover with a Session header → CIMD sign-in → token →
  MCP `initialize` + `tools/list`) passes.
- **Cross-reference:** KI-2026-09-05-k (the migration-pending detector), KI-20261027-h,
  ADR-083 §6, ADR-089 (on PR 712's branch until it merges), KI-2026-11-12-a, KI-2026-11-08 (stale Vercel mentions). API 2.5.0.
- **First noted:** 2026-11-11, fresh-agent Poppy test by Sunny (Muse) at Mitchell's request;
  diagnosed 2026-11-12.
