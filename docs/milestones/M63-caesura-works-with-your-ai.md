# M63 — Two pages say Caesura is AI first, and safe to hand to your AI

**Status (2026-11-21): scoped and started.** Plan: `docs/plans/2026-11-21-M63-caesura-works-with-your-ai.md`, five parts as one stack, tracked by part 0 on `ccr-8a6d904d-vhaiet`. *(Was: proposed 2026-11-20.)* Minted by Mitchell the same day: *"adding a SEO page
about how caesura is a AI first tool, document all the AI tools we have like mcp, fine scoped
tokens, the api, agents.md, poppy, and give examples how caesura is a partner to your favorite ai
tools."* Placed **after M62, ahead of M53**, by Mitchell the same day (see `docs/milestones/README.md`,
*2026-11-20 — minted: M62 and M63*). **Scoped the same day with every decision as recommended,
and a site-level `/agents.md`.** Mitchell: *"Go with your recommendations, ship the agents
section."* **The page says nothing about how Caesura is built.** Mitchell, the same day: *"we
should leave development details from the ai SEO page"*. **Amended the same day to split the work
across three places** (decision 8). Mitchell: *"yes, amend M63 with the split"*. **Amended
2026-11-21 to add a second page, `/security`** (decisions 10 to 14). Mitchell: *"modify the next
milestone, the ai SEO page a bit, to include two new pages, the one on ai, but also one on our
security"*, then *"Yes, amend M63"* to the proposal as written.

## Why this exists

Caesura has more ways in for AI than for people, and no page says so:

| Surface | What it is | Where it lives today |
|---|---|---|
| **The assistant** | The in-app assistant, with six personas (M57), grounded answers (M9), and `@assistant` in trip chat (M52) | the Ask panel; `server/assistant` |
| **MCP server** | A remote MCP server, signed in to through our own OAuth 2.1 server, with 19 tools from `whoami` to `update_notebook_page` (M55, ADR-083) | `/api/mcp`, `app/api/mcp/tools.ts` |
| **Scoped tokens** | `tc_` API tokens with eleven scopes, from `trips:read` to `current:write`, each one HMAC-SHA256 at rest and revocable | Account → Security → API tokens; `SCOPE_CATALOGUE` in `@tc/contracts` |
| **Public API** | REST under `/api/v1`, an OpenAPI document generated from the routes, and an RFC 9727 api-catalog (M22) | `/api/v1/openapi`, `/.well-known/api-catalog`, `/developers` |
| **Poppy** | The Personal Agent Protocol: `poppy.json`, signed client assertions, the `Poppy-Session` header, tasks and feedback (M60, ADR-089) | `/.well-known/poppy.json`, `/api/poppy/*` |
| **llms.txt** | The front page for a model: what Caesura is, the scopes, where the API is | `/llms.txt` |
| **Connected apps** | Every OAuth grant listed, each with *Disconnect* (M55) | Account → Security |

`/developers` (M53's static copy) is written for someone who already wants a token. Its only AI
setup is *Connect Claude*. Nothing speaks to the person who asks *"does this work with
Claude?"* or *"can ChatGPT plan my trip in it?"*, and nothing ranks for those searches.

**Scopes are already documented**, each from `SCOPE_CATALOGUE`: the table at `/developers#scopes`,
each endpoint's required scope in the OpenAPI document (and so in `/developers/reference`), the
scope list in `/llms.txt`, and the token form and OAuth consent screen. **One gap:** nothing says
which scope each MCP tool needs, so someone who unticks `notebook:write` on the consent screen
cannot tell that `update_notebook_page` will refuse.

**Nothing public says how an account is kept safe, either.** The facts exist: Google sign-in and,
from M62 (ordered before this milestone), a second factor with passkeys, authenticator apps and
recovery codes; tokens kept only as a hash and revocable; every OAuth grant listed with
*Disconnect*; other sessions signed out when a factor changes (M62's `security_epoch`); HTTPS
everywhere with HSTS and a content security policy (`apps/web/next.config.ts`); and an RFC 9116
`/.well-known/security.txt` for reporting a vulnerability. They are spread across the Security
tab, response headers and a file only scanners read. *"Is my data safe with an AI tool?"* is the
question an AI-first page raises most, and today it has nowhere to point.

## Decisions

### Decided 2026-11-20, all as recommended

Each *Recommendation* below is now the decision.

1. **The URL and the words it targets.** *Recommendation:* `/ai`, short and written for a person
   who is not a developer, titled *"Caesura works with
   your AI: Claude, ChatGPT, Gemini and agents"* (the build proposes the final words, and Mitchell
   approves them, as in M50 and M53) *(amended 2026-11-22: ChatGPT cut by decision 20, the approved
   title is now "Caesura: the AI trip planner for Claude and Gemini")*. It targets *AI trip planner*, *trip planner MCP server*,
   *Claude trip planning* and *travel planning API for agents*. It is in the sitemap, linked from
   the landing's footer, `/developers`, and `/llms.txt`.
2. **What "agents.md" is here.** There is no public `agents.md` today. Checked 2026-11-20:
   `/agents.md`, `/AGENTS.md`, `/agent.md` and `/.well-known/agents.md` all answer 404 on
   production, and no route on `main` serves one. What exists for agents is `/llms.txt`,
   `poppy.json`, the api-catalog and the OpenAPI document. The repository's own
   `AGENTS.md` is the operating manual for the agents that *build* Caesura. *Recommendation:*
   publish a site-level **`/agents.md`**, the instructions file for an agent that *acts on*
   Caesura: how to authenticate (token, OAuth, Poppy), which surface to use for which job, the
   scopes, the rate limits, and what never to do (publish without asking, for example). It is a
   sibling of `/llms.txt` and is generated from the same `SCOPE_CATALOGUE`. A *Built with agents*
   section on the page, saying Caesura is itself built by AI agents, was proposed and then
   **dropped by Mitchell**: the page leaves development details out. Neither the page nor
   `/agents.md` mentions the repository's `AGENTS.md`, the build process or its tooling.
3. **Which AI tools the examples name.** *Recommendation:* only what has been seen working on
   production. Each tool's setup, in three steps or fewer, is a section of *Connect your AI* on
   `/developers` (decision 8). `/ai` shows only what you can ask it, one prompt per tool, and
   links to that section:
   - **Claude** (claude.ai and the desktop app): add Caesura as a custom connector at
     `https://caesura.today/api/mcp`, then *"Turn my Lisbon trip into a three-day playbook and
     publish it."*
   - **Claude Code, Cursor or any MCP client**: the same URL in its MCP config.
   - **ChatGPT**: through its MCP connector support, if it signs in to our OAuth server.
     Otherwise through a GPT action on the OpenAPI document. Part 1 finds out which and the
     page says only what works. *(Cut by decision 20.)*
   - **Gemini**: function calling over the OpenAPI document with a scoped token (M60 D12 found
     no public sign that Gemini is a Poppy client). *(Amended by decision 20: it is the Gemini CLI
     over MCP.)*
   - **Meta's Muse and other Poppy agents**: they discover `poppy.json` and need no setup.
   - **A script**: `curl` with a `trips:read` token, to show how small a scope can be.
   An example that cannot be shown working is cut, not described.
4. **Fine scoped tokens, explained to a non-developer.** *Recommendation:* `/ai` does not
   repeat the scope table. It says in plain words that *an AI tool can never do more than you
   can, you choose what it may do, and you can disconnect it at any time*. It names
   *Connected apps*, and links to `/developers#scopes`, which stays the one table. *(Amended
   2026-11-21:)* anything more about keeping an account safe is a link to `/security`
   (decision 10), not a second explanation on `/ai`.
5. **Structured data.** *Recommendation:* `WebPage` with `about` the `SoftwareApplication`, and
   an `FAQPage` block for the four or five questions the page answers (*Does Caesura work with
   Claude? With ChatGPT? Is my data safe with an AI tool? What can an agent not do?*). The FAQ is
   only marked up if it is visible on the page. *(Amended 2026-11-22: the ChatGPT question is cut
   by decision 20 and a "Does Caesura work with Gemini?" question replaces it.)*
6. **How the examples stay true.** *Recommendation:* setup steps are written once, on
   `/developers`. `/ai` links to them and never restates them. The MCP tool table and the
   per-endpoint code samples are generated from code (`tools.ts`, the OpenAPI route
   declarations), not typed. A unit test follows every link on both pages to a route or anchor
   that exists, as `discovery.test.ts` does for `llms.txt`. The written prompts are prose, so
   each one is walked on production before the gate.
7. **Signed out and fast.** *Recommendation:* a static server-rendered page outside `proxy.ts`'s
   matcher, like `/developers`, with no client JavaScript beyond the shared shell. It is
   cached, has its own OG image, and stays inside M53's title and description limits.
8. **The split: each fact lives in one place.** *Recommendation:*
   - **`/developers` holds the how-to.** *Connect Claude* becomes **Connect your AI**, with one
     anchored section per tool from decision 3 (`#connect-claude`, `#connect-chatgpt`, and so on; *`#connect-chatgpt` cut by decision 20*).
     The existing `#connect-claude` anchor keeps working. The token path, the scope table and the
     reference links stay as they are, above it, because agents arriving from `/llms.txt` need
     them first. `/developers`' title and description, approved in M53, do not change.
   - **`/developers/reference` gets code samples per endpoint**, generated into the OpenAPI
     document as `x-codeSamples` (`curl`, JavaScript, Python) from each route's declaration.
     Part 1 first checks that the Scalar version we ship renders them. If it does not, this part
     is cut and recorded, not worked around.
   - **`/ai` makes the case.** It covers what your AI can do in Caesura, one prompt per tool, why
     it is safe, and the FAQ. Every *how* is a link to `/developers#…`.
9. **The MCP tool table.** *Recommendation:* a table on `/developers` under *Connect your AI*,
   generated from `tools.ts`. It lists each tool's name, what it does, and the scope it needs,
   so the consent screen's unticked boxes have a visible cost. The same list goes into
   `/agents.md`.

### Decided 2026-11-21: the `/security` page, all as recommended

10. **A second page, `/security`.** *Recommendation:* a plain-language page, written for the
    person deciding whether to trust Caesura (and to hand it to an AI), not for an auditor. It
    covers, in this order: how you sign in, and the second factor from M62; what an AI tool or a
    token can and cannot do (one line, then a link to `/ai` and `/developers#scopes`); how you
    take access back (tokens, *Connected apps*, signing out other sessions); how your data is
    protected in transit; and how to report a vulnerability. `/ai`'s *"Is my data safe with an
    AI tool?"* answer is a short line and a link here, so each fact lives in one place, the same
    rule as decision 8.
11. **Outcomes, not configuration.** *Recommendation:* the page leaves build and infrastructure
    details out, as `/ai` does: no list of response headers, no hosting or database vendor, no
    repository, no libraries. It states what is true for the reader (*"every connection is
    encrypted"*, *"we keep only a fingerprint of each token, which cannot be turned back into
    the token"*), which is more convincing than *"we take security seriously"* and gives an
    attacker nothing a scan would not already show.
12. **Every claim is true on production.** *Recommendation:* each statement on the page is
    checked against production before the gate, as `/ai`'s prompts are, and the check is
    recorded. A claim that cannot be checked is cut. No compliance badges or certifications
    (SOC 2, ISO 27001): Caesura has none, and the page says nothing that implies one. If M62 has
    not merged by the time this part is built, the page describes sign-in as it is and the
    second-factor paragraph waits for it.
13. **`security.txt` and `/security` point at each other.** *Recommendation:*
    `/.well-known/security.txt` gains a `Policy:` line naming `/security` (RFC 9116 allows it),
    and the page's reporting section is the human-readable version of that file: the same
    contacts, read from one constant so they cannot drift. `security.txt`'s `Expires` and its
    contacts do not change.
14. **Search, and the same shape as `/ai`.** *Recommendation:* a static, signed-out,
    server-rendered page outside `proxy.ts`'s matcher, cached, with its own OG image, in the
    sitemap, linked from the landing's footer, `/ai`, `/developers` and `/agents.md`. It is
    titled along the lines of *"Security at Caesura: your account, your data, your AI"* (the
    build proposes the words, Mitchell approves them), within M53's title and description
    limits. Structured data is `WebPage` with an `FAQPage` block only for questions visible on
    the page.

### Plan questions, answered 2026-11-21 (Mitchell)

15. **ChatGPT and Gemini are built, and Mitchell proves them.** Their sections are written from each
    vendor's docs; Mitchell runs each on production before the gate, and any he cannot get working is
    removed on the top part before it merges. Claude, an MCP client, Poppy discovery and the `curl`
    script are proven from the orchestrating session. *(Applied by decision 20, 2026-11-22.)*
16. **Five parts, not eight.** Each page ships with its own search pieces; proving the examples is
    evidence in part 0, not a code part.
17. **The words are approved on the preview at the gate.** Builders draft from the working titles
    in decisions 1 and 14.

18. **No GitHub contacts anywhere (amends decision 13), answered 2026-11-21.** Part 5's review found
    that `security.txt`'s GitHub advisory and issues links, reused on `/security`, put the
    repository in the page's links and revealed that it is private. Mitchell: *drop GitHub
    everywhere*. `security.txt` and `/security` both keep only the security email, still read from
    one constant. `security.txt`'s `Expires` does not change, and it gains its `Policy:` line.

19. **`/security` carries `SECURITY.md`'s scope and no-SLA/no-bounty lines, answered 2026-11-22.**
    Mitchell, in chat, after walking the PR 788 preview: the page also carries `SECURITY.md`'s scope
    line and its no-SLA, no-bounty line. Part 5 is adding them.

20. **ChatGPT cut, Gemini becomes the Gemini CLI, Poppy is named Muse (applies decision 15),
    answered 2026-11-22.** Mitchell, in the orchestrator session: ChatGPT custom connectors need a
    Business plan, and Gemini's need the Gemini CLI. He could not test ChatGPT on a free tier, so
    per decision 15 ChatGPT was **cut** on part 5 (PR 788 commit a321529) and is named nowhere.
    The Gemini tab became the Gemini CLI over MCP (`~/.gemini/settings.json` with `httpUrl`
    `https://caesura.today/api/mcp`, then `/mcp auth caesura`), anchor `#connect-gemini` kept.
    He asked to name Meta's Muse on the Poppy tab: tab "Muse", section "Connect Meta's Muse",
    anchor `#connect-poppy` kept. His words on proof: "I've used muse with caesura a bunch, it works
    really well since it discovers and uses poppy natively." Tab order is now Claude, Gemini CLI,
    Muse, Script.

## Scope

A first cut of the parts, for the plan to settle:

1. **Proving the examples** (decisions 3, 8): run each named tool against production and record
   what works, which decides the list. Also check that our Scalar version renders
   `x-codeSamples`.
2. **`/agents.md`** (decision 2): the route, generated from the contracts, linked from
   `llms.txt` and the api-catalog, with a discovery test.
3. **Connect your AI on `/developers`** (decisions 3, 8, 9): one section per proven tool, and the
   MCP tool table with its scopes.
4. **Code samples in the reference** (decision 8): `x-codeSamples` generated per endpoint.
5. **The `/ai` page** (decisions 1, 4, 6, 7): the surfaces, one prompt per tool linking to its
   section, the safety summary, and no development details.
6. **Search** (decisions 1, 5): metadata, JSON-LD, the OG image, the sitemap entry and the
   inbound links.
7. **The `/security` page** (decisions 10 to 13): the page, every claim checked on production,
   the reporting section and `security.txt` sharing one contacts constant, and the `Policy:`
   line. `/ai`'s safety answer becomes a link here.
8. **Search for `/security`** (decision 14): metadata, JSON-LD, the OG image, the sitemap entry
   and the inbound links. It may fold into part 6 if the plan finds them small enough together.
0. **The gate**: the evidence, the approved words for both pages, the retro.

## Out of scope

- New AI capability. This milestone describes what exists, and a gap found in part 1 becomes a
  known issue or a candidate.
- Listing in third-party directories (MCP registries, the GPT store, Poppy's directory). They
  are Mitchell's accounts and a candidate.
- A page per AI tool. One page first; per-tool landing pages are a candidate if the one page
  ranks.
- Rewriting the rest of `/developers` or its M53 title and description.
- New security capability, a privacy policy or terms of service, and any compliance
  certification. `/security` describes what exists; a gap found while checking its claims
  becomes a known issue or a candidate.

## Exit gate

- [x] **Examples:** every AI tool `/ai` or `/developers` names has a recorded production run of
  its example, and no tool without one is named.
- [x] **Connect your AI:** `/developers` has one anchored section per proven tool, `/ai` links
  each tool to its section, and `#connect-claude` still resolves (unit test over the links).
- [x] **MCP tool scopes:** `/developers` lists every MCP tool with the scope it needs, generated
  from `tools.ts`, which a test proves by adding a tool in a fixture.
- [x] **Code samples:** every endpoint in the OpenAPI document carries `x-codeSamples` and
  `/developers/reference` shows them, or the part is recorded as cut because Scalar does not
  render them.
- [x] **`/agents.md`:** it answers 200 as `text/markdown` signed out, its scopes are
  `SCOPE_CATALOGUE`, and `llms.txt` and the api-catalog link it (unit tests).
- [x] **Surfaces:** the page names the assistant, the MCP server, scoped tokens, the public API,
  Poppy, `llms.txt`, `agents.md` and Connected apps, and every link on it reaches a route that
  exists (unit test).
- [x] **One scope table:** `/ai` links to `/developers#scopes` and has no scope table of its own.
- [ ] **Search:** the page is in the production sitemap with a canonical, an `og:url`, a title
  of 60 characters or fewer, a description of 160 or fewer, and `FAQPage` JSON-LD that matches
  the visible questions.
- [x] **Signed out:** with JavaScript off, `/ai` answers HTML with one `<h1>` and every prompt
  (`test:e2e:ci-like`, or CI on the PR).
- [x] **Words:** the title, description and headline are the words Mitchell approved.
- [x] **No development details:** neither the page nor `/agents.md` mentions the repository,
  its `AGENTS.md` or how Caesura is built.
- [x] **[walk]** Mitchell runs `/ai` through Google's Rich Results Test with no errors, and
  follows the Claude example from `/ai`, through `/developers#connect-claude`, to a published playbook.
- [x] **`/security` claims:** every statement on `/security` has a recorded check on production,
  and the page names no certification Caesura does not hold.
- [x] **One place for safety:** `/ai`'s safety answer links to `/security` and does not repeat
  it, and every link on `/security` reaches a route or anchor that exists (unit test).
- [x] **Reporting:** `/security`'s reporting section and `/.well-known/security.txt` read their
  contacts from one constant, and `security.txt` carries a `Policy:` line naming `/security`
  (unit tests).
- [ ] **`/security` search and signed out:** in the production sitemap with a canonical, an
  `og:url`, a title of 60 characters or fewer and a description of 160 or fewer; with JavaScript
  off it answers HTML with one `<h1>` (`test:e2e:ci-like`, or CI on the PR).
- [x] **No build details on `/security`:** it names no response header, hosting or database
  vendor, library or repository.
- [x] **`/security` words:** the title, description and headline are the words Mitchell
  approved.

## Evidence

### Examples on production (gate box *Examples*)

- **2026-11-21, Claude through the MCP server.** The orchestrating Claude Code session is connected to
  `https://caesura.today/api/mcp` as a custom connector, signed in through Caesura's OAuth server.
  `whoami` returned the owner's account on `premium@v2`, and `list_trips` (scope `trips:read`)
  returned the account's trips. The same connection is the *any MCP client* case. Still to come:
  publishing a playbook from Claude, in Mitchell's walk.
- **2026-11-21, Poppy discovery.** `GET /.well-known/poppy.json` answered 200 `application/json`,
  signed out.
- **2026-11-21, a script.** `GET /api/v1/openapi` answered 200 signed out. `GET /api/v1/trips`
  without a token answered 401. A run with a real `trips:read` token is still to be recorded, since
  this session has no token.
- **2026-11-21, Mitchell's confirmation.** Mitchell confirmed he has run all three before on
  production and they work: a script with a real `trips:read` token, Claude publishing a playbook,
  and Poppy end to end (connector to a working Caesura session). Recorded here as his word, not a
  run captured by this session.
- **2026-11-22, Gemini CLI.** Mitchell confirmed it on production: "Confirmed Gemini cli". Recorded
  as his word (decision 20).
- **2026-11-22, Muse.** Mitchell, by repeated use: "I've used muse with caesura a bunch, it works
  really well since it discovers and uses poppy natively." Recorded as his word (decision 20).
- **ChatGPT:** named nowhere. Cut by decision 20 on part 5 (PR 788 a321529); `AiScreen.test.tsx:189`
  and `DevelopersScreen.test.tsx:167` assert its absence.
- **Summary for the *Examples* box.** Claude, the MCP client, Poppy discovery and the script were
  proven from the orchestrating session (the 2026-11-21 entries above); the Gemini CLI and Muse by
  Mitchell, as recorded here. Every tool `/ai` and `/developers` name has a recorded run, and the
  one without (ChatGPT) is not named.

### Code and CI at 21d4f01c, the top of the stack (gate boxes *MCP tool scopes*, */agents.md*, *Surfaces*, *One scope table*, *Signed out*, *No development details*, *One place for safety*, *Reporting*, *No build details on /security*)

Every check on PR 788 at `21d4f01c` is green: `ci-ok`, lint, typecheck, unit, integration, scripts
and both e2e shards. Unit, integration and e2e:
https://github.com/Neablis/travel-collab/actions/runs/44964864293 (unit job 137031516998, e2e jobs
137031517048 and 137031517059). Paths are under `apps/web/`.

- **MCP tool scopes.** `src/server/mcp/toolScopes.test.ts:23-32` adds a fixture tool and its scope
  appears in the rows with no second list to edit. `src/components/front/DevelopersScreen.test.tsx:212-221`
  renders one row per tool given, with its scope, including a tool no page edit knows about
  (`:9-12`). `src/app/(front)/developers/page.tsx:3,30` passes `TOOL_SCOPES`, which
  `src/app/api/mcp/tools.ts:226` builds from `TOOLS` with `mcpToolScopes`.
- **`/agents.md`.** `src/server/public-api/discovery.test.ts:203-208` answers 200 as
  `text/markdown; charset=utf-8` and lists every scope; `:233-240` shows no path entry of the proxy
  matcher reaches it, so it is served signed out. The scope text is built from `SCOPE_CATALOGUE` at
  `src/app/api/mcp/agentsMd.ts:29` (the test pins the scope names, the source line pins the
  catalogue). `llms.txt` links it at `discovery.test.ts:182-185` and the api-catalog at `:85-89`.
- **Surfaces.** `src/components/front/AiScreen.test.tsx:39-56` names the assistant, MCP server,
  scoped tokens, public API, Poppy, `llms.txt`, `agents.md` and Connected apps. `:121-141` checks
  every internal link reaches a served route, and every `#anchor` is one `/developers` renders.
- **One scope table.** `AiScreen.test.tsx:143-147`: no table on `/ai`, and a link to
  `/developers#scopes`.
- **Signed out.** `e2e/m63-ai-page.spec.ts:18-26` with JavaScript off and no session: status 200,
  one `h1`, and each of the six prompts visible. `AiScreen.test.tsx:102-105` also holds one `h1`.
- **No development details.** `/ai`: `AiScreen.test.tsx:186-208`, page text and metadata, bars the
  repository, hosts, framework and headers, and `AGENTS.md`. `/agents.md`:
  `discovery.test.ts:244-252` bars the same words.
- **One place for safety.** `AiScreen.test.tsx:156-163` answers in one line with a link to
  `/security`, and `:177-184` bars the sign-in and storage detail that `/security` owns.
  `src/components/front/SecurityScreen.test.tsx:105-123` checks every link on `/security` reaches a
  served route or an anchor the target renders.
- **Reporting.** `SecurityScreen.test.tsx:179-187` shows the page's contacts equal
  `SECURITY_CONTACTS` and the `Contact:` lines of `security.txt`. `discovery.test.ts:113-121`
  checks `Policy: https://caesura.today/security` and that `/security` is a served route.
- **No build details on `/security`.** `SecurityScreen.test.tsx:147-170` bars response headers
  (`strict-transport-security`, `content-security-policy`, `hsts`, `csp`), hosting and database
  vendors, libraries and `repository`; `:126-135` bars GitHub in text and hrefs. A grep of
  `SecurityScreen.tsx`, `security/page.tsx` and `securityContacts.ts` for the same words, plus
  Postgres, AWS and similar, finds only comments.

Left unticked, with what is proven:

- **Search** and **`/security` search and signed out:** everything except the production sitemap is
  proven. `src/app/(front)/ai/page.test.tsx:28-42` (title at most 60, description at most 160,
  canonical, `og:url`) and `:53-64` (`FAQPage` questions equal the visible ones);
  `src/app/(front)/security/page.test.tsx:28-42` and `:62-73` for `/security`;
  `e2e/m63-security-page.spec.ts:8-16` (200, `text/html`, one `h1`, JavaScript off).
  `src/app/sitemap.test.ts:36-42` lists both pages on the deployment origin only. The
  production-sitemap clause was checked after the merge and failed on the edge-cached file (see *Search on production*).
- **`/security` claims:** checked on production 2026-11-22 and ticked (see the evidence below).

*Examples* and *Connect your AI* were ticked 2026-11-22 once ChatGPT was cut and the Gemini CLI and
Muse were proven (decision 20). *Connect your AI*: the links, the anchors and the `#connect-claude`
anchor are proven by `AiScreen.test.tsx:107-141` and `DevelopersScreen.test.tsx:173-187`, now one
section per proven tool (Claude, Gemini CLI, Muse, Script).

### `/security` claims on production (gate box *Security claims*)

- **2026-11-21, Mitchell.** Checked the claims in PR 788's "Claims to check on production" table
  and confirmed them: "Confirmed and good".
- **2026-11-22, after the merge (PR 788 as ded937e; `https://caesura.today/api/health` reports
  `ded937ece6e8aa70de6cd06756937d78683a90dc`; `deploy-production` run 44983638699 success).** Fetched
  `https://caesura.today/security` with `curl` (200, `text/html; charset=utf-8`) and compared the page
  text with each claim. Every sentence below appears verbatim, and the page names no SOC 2, ISO 27001,
  certification, GDPR, HIPAA or "compliant" (searched case-insensitively), no GitHub, and no header name:
  - "You sign in to Caesura with Google." `https://caesura.today/signin` offers "Continue with Google".
  - "You can add a second step, and it is optional."
  - "A passkey lets your device confirm it is you, with Face ID, a fingerprint or a PIN."
  - "An authenticator app gives you a 6-digit code."
  - "When you turn the second step on, you also get recovery codes, for the day you lose a device."
  - "An AI tool or a token acts as you, holds only the permissions you give it, and can never do more
    than you can."
  - "Revoke a token under Account, then Security, and it stops working."
  - "API tokens and connected apps are on the Premium plan." (and the FAQ's "On the Premium plan")
  - "Disconnect an app in Connected apps, and it stops working immediately."
  - "When you turn the second step on or off, remove a passkey or an authenticator app, or make new
    recovery codes, every other device you are signed in on is signed out."
  - "Connections to Caesura are encrypted." `curl -sI https://caesura.today` returns
    `strict-transport-security: max-age=63072000`, and `curl -sI http://caesura.today` returns 301 to
    `https://caesura.today/`.
  - "We keep only a fingerprint of each API token and of each app connection's tokens, which cannot be
    turned back into them." and "The token itself is shown to you once, when you make it."
  - The three FAQ answers (second factor optional; lost phone and recovery codes; seeing what is
    connected).
  The account-behaviour claims (the ones needing a signed-in account) rest on Mitchell's 2026-11-21
  confirmation above; this check re-proves only that each still appears as written, so the page has not
  drifted from what he confirmed.
- **Decision 19's two new lines, 2026-11-22.**
  - "Anything served from caesura.today is in scope; preview sites are not." `SECURITY.md`, *Scope*, says
    the same: "Anything served from the production deployment is in scope. Preview deployments are not".
    Same policy, in the reader's words (production is `caesura.today`).
  - "There is no SLA and no bounty — this is one maintainer's project. Expect a first response in days,
    not hours." Identical to `SECURITY.md`'s *Reporting a vulnerability*, word for word.
  - The page's email (Cloudflare obfuscates the address in the HTML; decoded) is
    `mitchell@demarcosoftware.com`, the one `Contact:` line of `https://caesura.today/.well-known/security.txt`
    (`Expires: 2027-10-01T00:00:00.000Z`, `Policy: https://caesura.today/security`) and the address in
    `SECURITY.md`.

### Search on production, 2026-11-22 (gate boxes *Search*, */security search*)

Fetched with `curl` from `https://caesura.today` on `ded937e`.

- **`/ai`** answers 200 `text/html`; canonical `https://caesura.today/ai`; `og:url` the same; title "Caesura:
  the AI trip planner for Claude and Gemini" (50 characters); description 128 characters; one `<h1>`;
  `WebPage` and `FAQPage` JSON-LD whose four questions (*Does Caesura work with Claude?*, *with Gemini?*,
  *Is my data safe with an AI tool?*, *What can an agent not do?*) all appear in the visible text.
- **`/security`** answers 200 `text/html`; canonical and `og:url` `https://caesura.today/security`; title 53
  characters; description 119 characters; one `<h1>`; `WebPage` and `FAQPage` JSON-LD with three
  questions, all of them the visible ones.
- **The sitemap clause fails today.** `https://caesura.today/sitemap.xml` lists 445 URLs and neither
  `/ai` nor `/security`. It is Cloudflare's copy: `cf-cache-status: HIT`, `age: 10964`,
  `last-modified: Sun, 22 Nov 2026 01:33:21 GMT`, which is before the merge, with
  `cache-control: public, max-age=14400, s-maxage=86400, stale-while-revalidate=86400`. The same path with
  a cache-busting query (`/sitemap.xml?cb=<time>`, `cf-cache-status: MISS`) is the origin's answer: 447
  URLs, both `<loc>https://caesura.today/ai</loc>` and `<loc>https://caesura.today/security</loc>`
  present, as `src/app/sitemap.ts` and `sitemap.test.ts:36-42` say. A request with `Cache-Control: no-cache`
  still returned `HIT`, so a crawler gets the old file until the edge copy is purged or expires (about
  01:33Z on 2026-11-23). Both boxes stay unticked until `https://caesura.today/sitemap.xml` itself lists the two pages.

### Words, code samples and walk on the PR 788 preview (gate boxes *Words*, */security words*, *Code samples*, *[walk]*)

Mitchell, 2026-11-22, in the orchestrator session, on the PR 788 preview at 1eddf2f
(https://788.preview.caesura.today, the same tree as 21d4f01c).

- **Words.** Approved as shown on the preview: `/ai` title "Caesura: the AI trip planner for Claude,
  ChatGPT, Gemini", description "Ask Claude, ChatGPT, Gemini or another AI tool to plan in Caesura for
  you. You choose what it may do, and you can disconnect it any time.", headline "An AI trip planner
  that works with Claude, ChatGPT and Gemini"; and on `/developers` the labels "Any AI app" and "Pick
  your tool". *Re-approved 2026-11-22, on the preview at a321529, after decision 20 cut ChatGPT, so
  the earlier note that these words would change if decision 15 cut either is resolved.* The new
  `/ai` words: title "Caesura: the AI trip planner for Claude and Gemini", description "Ask Claude,
  Gemini or another AI tool to plan in Caesura for you. You choose what it may do, and you can
  disconnect it any time.", headline "An AI trip planner that works with Claude and Gemini", tab
  labels "Gemini CLI" and "Muse", and a new FAQ "Does Caesura work with Gemini?": "Yes. Add Caesura
  to the Gemini CLI as an MCP server, sign in, and choose what it may do." Mitchell was asked to
  approve them and replied "clean and finish this up and then let's merge", so approval is recorded
  as given by proceeding, not as a separate "approved".
- **`/security` words.** Approved as shown: title "Security at Caesura: your account, your data, your
  AI", description "How you sign in to Caesura, what an AI tool can do for you, how to take access
  back, and how to report a vulnerability.", headline "Security at Caesura".
- **Code samples.** "Code samples work": he saw `x-codeSamples` rendered on the preview's
  `/developers/reference`.
- **[walk].** "Walk worked fine": Rich Results Test on `/ai` with no errors, the Claude example from
  `/ai` through `/developers#connect-claude` to a published playbook, and the five tabs at phone
  width.
