# M60 plan — A personal agent can find Caesura, and act for you within what you allow

Milestone: `docs/milestones/M60-personal-agents-act-for-you.md` (decisions D1–D14, answered 2026-11-09). ADR: `docs/architecture/ADR-089-personal-agents-reach-caesura-through-poppy.md`.
Part 0 is the prose-only tracking PR on `claude/relaxed-pascal-i6125m` (PR 712); it merges last.
Deleted at gate close (`docs/plans/README.md`).

Paths are relative to `apps/web/src/` unless they start with `packages/`, `apps/` or `docs/`.
Line numbers are from `main` at `ba3b66a`, so treat them as a starting point, not as fact.
**New** marks a file that does not exist yet.

The spec is draft 0.4 at `personal-agent-protocol/personal-agent-protocol@a2f16ec`,
`skills/implement-personal-agent-protocol/reference/spec.md`; its `checklist.md` lists every
Company MUST and SHOULD by milestone. A builder clones it outside the repo (it is not vendored,
ADR-089 decision 13) and reads the sections each part names.

## Order

| Part | Branch | Depends on | Can run beside |
|---|---|---|---|
| 1 Discovery | `claude/m60-part1-discovery` | — | — |
| 2 The agent signs in as itself | `claude/m60-part2-client-assertions` | 1 | — |
| 3 Sessions | `claude/m60-part3-sessions` | 2 | — |
| 4 Every listed API takes it | `claude/m60-part4-v1-takes-it` | 3 | — |
| 5 Tasks and feedback | `claude/m60-part5-tasks-feedback` | 4 | — |

**One stack** (`docs/guidelines/stacked-prs.md`): part 1 branches from `main` and its PR targets
`main`; part K+1 branches from part K's head and its PR targets part K's branch. Every part's PR is
a draft. The top part's PR is retargeted to `main` and marked ready at the gate, and lands all
five. Each PR body says `Part K of 5`, its base, and *"lands through the top part's PR"*.

`server/oauth/metadata.ts` is touched by parts 1 and 2; `server/public-api/route.ts` by parts 3
and 4; `components/admin/consoleTab.ts` and `app/admin/page.tsx` by parts 4 and 5. The stack
orders them.

Facts the parts share (the survey, 2026-11-09):
- **No JOSE library** is in the repo. Part 2 adds `jose` to `apps/web` (ADR-089). Remote key sets
  are fetched with `clients.ts`'s guarded fetcher (`fetchDocument` :270, `assertPublicAddress`
  from `server/external/remoteImage/guard`), never `createRemoteJWKSet`.
- **One migration, `0075`, in part 3**: `agent_sessions`, `oauth_client_blocks`,
  `agent_feedback`. Newest today is `apps/web/drizzle/0074_poll_votes.sql`; schema in
  `server/db/schema.ts` (`oauthClients` :316, `oauthGrants` :346, `oauthTokens` :411).
- **The issuer and every URL we publish** come from `deploymentOrigin()` (`lib/deploymentOrigin`),
  never the request (ADR-083 amendment B). `htu` is compared against it too.
- **The exposure ledger** (`server/public-api/exposure.ts`, `EXPOSURE` :47, statuses public /
  planned / never / front-door) gets a line for every new route; `exposure.test.ts` enforces it.
- **The 429 path** is `consumeQuota` (`server/quota.ts` :576) as `route.ts` uses it at :502–512.
- **Cache**: `getCache()` (`server/cache/redis.ts` :148), keys in `server/cache/keys.ts`.
- **A test identity for a Personal Agent** (an ES256 key, a CIMD document, a `jwks_uri`, a
  delegation) is built once, in part 2, as a test helper **new**
  `server/poppy/testAgent.ts`, and served by the integration tests' fake fetcher, so no test
  touches the network.
- **Errors** `invalid_session`, `session_ended`, `version_unsupported` are HTTP 400 with body
  `{"error": …}` (ADR-089), outside v1's envelope.

## Part 1 — Discovery (~12 files)

**Theme.** D1, D2, D7, D9: `poppy.json`, scope hints, and the two metadata documents agreeing with
it. Spec §3, §3.1, §3.2, §4.7. Nothing verifies a Session yet; no client changes.

| File | Entry point | Change | Test |
|---|---|---|---|
| `packages/contracts/src/publicApi.ts` | `SCOPE_CATALOGUE` :102 | **new** `SCOPE_HINTS: Record<ApiScope, {changes, personal_data}>` | `packages/contracts/test/publicApi.test.ts` (every scope has a hint) |
| **new** `server/poppy/discovery.ts` | `poppyDocument()` | builds `poppy.json` from `deploymentOrigin()`, `SCOPE_CATALOGUE`, `SCOPE_HINTS`, `mcpResource()`, the OpenAPI URL; `web: {}`; no `agent`, no `tasks` yet | **new** `server/poppy/discovery.test.ts` |
| **new** `app/.well-known/poppy.json/route.ts` | `GET` | serves it via `metadataJson` | `server/oauth/wellKnown.test.ts` |
| `server/oauth/metadata.ts` | `protectedResourceMetadata` :30, `authorizationServerMetadata` :40 | bare form names the domain; `/api/mcp` form unchanged; AS gains `protected_resources` | `server/oauth/metadata.test.ts` |
| `app/.well-known/oauth-protected-resource/[[...path]]/route.ts` | `GET` :16 | pick the document by path | `server/oauth/wellKnown.test.ts` |
| `server/public-api/exposure.ts` | `EXPOSURE` :47 | line for `/.well-known/poppy.json` | `server/public-api/exposure.test.ts` |
| `server/public-api/discovery.test.ts` | — | `/v1` index lists `poppy.json` if it lists the others | itself |

Gate boxes: *The metadata agrees with itself*; half of *`poppy.json` passes* (`check --file`).

**Preview walk:** nothing on screen. `curl` the preview's `/.well-known/poppy.json`, the bare and
`/api/mcp` protected-resource documents, and the AS metadata; then add the preview as a custom
connector in claude.ai and confirm Claude still signs in (D7 gate box).

## Part 2 — The agent signs in as itself (~14 files)

**Theme.** D3 (identity half), D10: `private_key_jwt` at the token and revocation endpoints for a
CIMD client that declares it; no beyond-requested scopes; the consent page and Connected apps name
the agent from its document. Spec §4.1, §4.2, §4.4, §4.6, §4.7. Not the kill switch (part 4).

| File | Entry point | Change | Test |
|---|---|---|---|
| `apps/web/package.json` | dependencies | add `jose` | — |
| `server/oauth/clients.ts` | CIMD schema :114, `resolveClient` :129, `fetchDocument` :270 | accept `private_key_jwt` with a same-domain `jwks_uri`; fetch the key set through the guarded fetcher, cached | `server/oauth/clients.int.test.ts` |
| **new** `server/oauth/clientAssertion.ts` | `verifyClientAssertion()` | RFC 7523: `aud` = issuer exactly, ES256 / PS384, short `exp`, `jti` once (cache) | **new** `server/oauth/clientAssertion.test.ts` |
| `server/oauth/tokens.ts` | `exchangeCode` :99, `refresh` :139, `revokeSecret` :177 | require the assertion for a `private_key_jwt` client; refuse scope beyond requested; `scope` required | `server/oauth/tokens.int.test.ts` |
| `app/api/oauth/token/route.ts`, `app/api/oauth/revoke/route.ts` | `POST` :9 | read `client_assertion` / `client_assertion_type` | each `route.int.test.ts` |
| `server/oauth/metadata.ts` | `authorizationServerMetadata` | `token_endpoint_auth_methods_supported: ["none","private_key_jwt"]`, `token_endpoint_auth_signing_alg_values_supported: ["ES256","PS384"]`, same for revocation | `server/oauth/metadata.test.ts` |
| `server/oauth/authorizeRequest.ts` | `parseAuthorizeRequest` :73 | `scope` required for a `private_key_jwt` client (`invalid_scope`) | `server/oauth/authorizeRequest.test.ts` |
| `components/oauth/ConsentScreen.tsx` | `ConsentScreen` :61 | the agent's `client_name`, `logo_uri` and domain | `components/oauth/ConsentScreen.test.tsx` |
| `components/account/ConnectedAppsSection.tsx` | default export | a Personal Agent row shows its name, logo and *Personal agent* | `components/account/ConnectedAppsSection.test.tsx` |
| **new** `server/poppy/testAgent.ts` | `makeTestAgent()` | keys, CIMD document, `jwks`, assertions and delegations for tests | used by the above |

Gate boxes: *A client assertion is required and checked*; *No scope beyond what was asked*.

**Interaction model (consent and Connected apps).** The consent page reads *"**Muse** (meta.ai)
wants to act for you on Caesura"*, the agent's logo beside it; the Read and Write groups and the
Approve / Cancel buttons are M55's, unchanged. Connected apps lists the agent like Claude, with a
*Personal agent* label under its name and the same **Disconnect** button and confirm.

**Preview walk:** run the kit validator's `keygen` with a non-production base URL, host its
`agent.json` and `jwks.json`, then open `/oauth/authorize` with that `client_id`: the consent page
names the test agent. Approve read scopes, exchange the code with the validator's assertion, see
the agent under Account → Profile → Connected apps, and Disconnect it.

## Part 3 — Sessions (~13 files)

**Theme.** D8: the `Poppy-Session` verifier, `Poppy-Version`, the three 400 errors, and the
session row, applied in `route()` and `/api/mcp` for any request that carries the header. No
route's behaviour changes yet for a request without it. Spec §3.4, §5.1–§5.6.

| File | Entry point | Change | Test |
|---|---|---|---|
| `apps/web/drizzle/0075_agent_sessions.sql` (**new**), `server/db/schema.ts` | — | `agent_sessions`, `oauth_client_blocks`, `agent_feedback` | `server/poppy/sessions.int.test.ts` |
| **new** `server/poppy/sessionHeader.ts` | `verifySessionHeader(request, accessToken?)` | delegation (§5.2 order), `typ`, `aud`, `htm`/`htu`, `iat` ±60s, `ath`, same `client_id` as the token | **new** `server/poppy/sessionHeader.test.ts` |
| **new** `server/poppy/sessions.ts` | `openOrContinueSession()` | the row by `(client_id, sid, agent_user_id)`; 30-day idle end; account change → `session_ended` | **new** `server/poppy/sessions.int.test.ts` |
| **new** `server/poppy/errors.ts` | `poppyError()` | the 400 bodies | covered by the above |
| `server/public-api/route.ts` | `route()` :447 | verify when the header is present, before the actor; `Poppy-Version` check | `server/public-api/route.int.test.ts` |
| `app/api/mcp/route.ts` | `POST` :24 | the same, before dispatch | `app/api/mcp/route.int.test.ts` |
| `server/cache/keys.ts` | — | delegation key by `jti` | `server/cache/keys.test.ts` |

Gate box: *A Session header is verified or refused* — every refusal case seen red first.

**Preview walk:** nothing on screen. Run the validator's `check <preview> --milestone foundation`
with the part 2 test identity; every foundation check passes or is a recorded warning.

## Part 4 — Every listed API takes it (~13 files)

**Theme.** D3 (kill switch), D4, D5, D6: v1 accepts a domain-audience OAuth token through every
gate; the signed-out surface (Discover, read-only, Session header only, per-session limit); the
*Agents* console tab with Block / Unblock by `client_id`. Spec §5.4, §7.

| File | Entry point | Change | Test |
|---|---|---|---|
| `server/public-api/actor.ts` | `resolveActor` :79, refusal :115 | accept a domain-audience token outside MCP; refuse an `/api/mcp` one there, and a domain one inside MCP | `server/public-api/oauthActor.int.test.ts` |
| `server/oauth/verifyAccess.ts`, `server/oauth/tokens.ts` | `verifyAccessToken` :47, `exchangeCode` :99 | audience = domain when no `resource` was asked for | `server/oauth/verifyAccess.int.test.ts` |
| `server/public-api/route.ts` | `declare` :458, `route()` :447 | `signedOut: true` opt-in; per-`(client_id, sid)` quota; blocked `client_id` → `invalid_session` | `server/public-api/route.int.test.ts` |
| `server/public-api/discover.ts` | `discoverPlaybooksDef` :57 | `signedOut: true` | `server/public-api/discover.int.test.ts` |
| `server/oauth/tokens.ts`, `server/oauth/clients.ts` | token, revoke | blocked `client_id` → `invalid_client` | `server/oauth/tokens.int.test.ts` |
| **new** `app/api/admin/agents/route.ts`, **new** `app/api/admin/agents/[clientId]/block/route.ts` | `GET`, `PUT`/`DELETE` | list agents seen, block and unblock | each **new** `route.int.test.ts` |
| `components/admin/consoleTab.ts`, `app/admin/page.tsx` | `CONSOLE_TABS` :8, the `tab ===` branch | an `agents` tab | `components/admin/consoleTab.test.ts`, `app/admin/admin.console.test.ts` |
| **new** `components/admin/AgentsTab.tsx` | `AgentsTab` | the list and the toggle (pattern: `AccountTestMode.tsx`) | **new** `components/admin/AgentsTab.test.tsx` |

Gate boxes: *The v1 API takes a Poppy access token*; *Signed out reaches only the public reads*.

**Interaction model (console *Agents* tab).** A table of Personal Agents seen, one row per
`client_id`: logo and name from its document, its domain, sessions in the last 30 days, accounts
signed in, last seen. Each row ends in a **Block** button; clicking it asks *"Block <name>? Its
sign-ins stop and every request it sends is refused."* with Block / Cancel, then the row shows
*Blocked* and an **Unblock** button that needs no confirm.

**Preview walk:** with the test agent signed in, `GET /v1/trips` with its access token and Session
header lists Mitchell's trips. Signed out, `GET /v1/discover/playbooks` answers and `/v1/trips`
does not. In `/admin?tab=agents` block the test agent and see the next request refused; unblock it.

## Part 5 — Tasks and feedback (~10 files)

**Theme.** D11: `GET /api/poppy/tasks` with `excluded_tasks` and `feedback.endpoint`;
`POST /api/poppy/feedback` storing reports; `poppy.json` gains `tasks`; the *Agents* tab lists
reports. The guideline section. Spec §9, §9.1–§9.3.

| File | Entry point | Change | Test |
|---|---|---|---|
| **new** `server/poppy/tasks.ts` | `tasksResponse()` | excluded tasks from a list kept beside `exposure.ts`'s `never` rows | **new** `server/poppy/tasks.test.ts` |
| **new** `app/api/poppy/tasks/route.ts` | `GET` | Session header verified; same body for everyone, cacheable | **new** `app/api/poppy/tasks/route.int.test.ts` |
| **new** `app/api/poppy/feedback/route.ts`, **new** `server/poppy/feedback.ts` | `POST`, `recordFeedback()` | `task` ≤200, `description` ≤2000, `202`; `invalid_request` otherwise; rate limited | **new** `app/api/poppy/feedback/route.int.test.ts` |
| `server/poppy/discovery.ts` | `poppyDocument()` | `tasks.endpoint` | `server/poppy/discovery.test.ts` |
| `server/public-api/exposure.ts` | `EXPOSURE` | two lines | `server/public-api/exposure.test.ts` |
| `components/admin/AgentsTab.tsx`, `app/api/admin/agents/route.ts` | `AgentsTab` | a *Reports* list under the agents table | `components/admin/AgentsTab.test.tsx` |
| `docs/guidelines/using-the-api.md` | *For a caller* | a *Personal agents (Poppy)* section after *Connecting Claude* | — |

Gate box: *The tasks endpoint answers, and a feedback report shows in the operator console.*

**Interaction model (reports).** Under the agents table, *Reports from agents*, newest first: the
task phrase in bold, the description below it as plain text (never rendered as markdown), the
agent's name and the date. No actions; it is read-only.

**Preview walk:** `GET /api/poppy/tasks` with the test agent's Session header; `POST` a report to
the feedback endpoint; see it in `/admin?tab=agents`.

## Gate

CI runs once, on part 5's PR, retargeted to `main` and marked ready once every part is done
(`close-a-milestone`). The validator boxes are run against the top part's preview and pasted into
the milestone file. *Claude's connector still connects* and *Disconnect signs the agent out* are
checked on that preview. The **[walk]** is Mitchell's, on the top preview: sign the test agent in
with read-only scopes, have it list his trips, then Disconnect it in Connected apps. Migration
`0075` is applied to production by `migrate-production` after the top part merges.
