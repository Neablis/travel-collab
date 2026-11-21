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
   approves them, as in M50 and M53). It targets *AI trip planner*, *trip planner MCP server*,
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
     page says only what works.
   - **Gemini**: function calling over the OpenAPI document with a scoped token (M60 D12 found
     no public sign that Gemini is a Poppy client).
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
   only marked up if it is visible on the page.
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
     anchored section per tool from decision 3 (`#connect-claude`, `#connect-chatgpt`, and so on).
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
    script are proven from the orchestrating session.
16. **Five parts, not eight.** Each page ships with its own search pieces; proving the examples is
    evidence in part 0, not a code part.
17. **The words are approved on the preview at the gate.** Builders draft from the working titles
    in decisions 1 and 14.

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

- [ ] **Examples:** every AI tool `/ai` or `/developers` names has a recorded production run of
  its example, and no tool without one is named.
- [ ] **Connect your AI:** `/developers` has one anchored section per proven tool, `/ai` links
  each tool to its section, and `#connect-claude` still resolves (unit test over the links).
- [ ] **MCP tool scopes:** `/developers` lists every MCP tool with the scope it needs, generated
  from `tools.ts`, which a test proves by adding a tool in a fixture.
- [ ] **Code samples:** every endpoint in the OpenAPI document carries `x-codeSamples` and
  `/developers/reference` shows them, or the part is recorded as cut because Scalar does not
  render them.
- [ ] **`/agents.md`:** it answers 200 as `text/markdown` signed out, its scopes are
  `SCOPE_CATALOGUE`, and `llms.txt` and the api-catalog link it (unit tests).
- [ ] **Surfaces:** the page names the assistant, the MCP server, scoped tokens, the public API,
  Poppy, `llms.txt`, `agents.md` and Connected apps, and every link on it reaches a route that
  exists (unit test).
- [ ] **One scope table:** `/ai` links to `/developers#scopes` and has no scope table of its own.
- [ ] **Search:** the page is in the production sitemap with a canonical, an `og:url`, a title
  of 60 characters or fewer, a description of 160 or fewer, and `FAQPage` JSON-LD that matches
  the visible questions.
- [ ] **Signed out:** with JavaScript off, `/ai` answers HTML with one `<h1>` and every prompt
  (`test:e2e:ci-like`, or CI on the PR).
- [ ] **Words:** the title, description and headline are the words Mitchell approved.
- [ ] **No development details:** neither the page nor `/agents.md` mentions the repository,
  its `AGENTS.md` or how Caesura is built.
- [ ] **[walk]** Mitchell runs `/ai` through Google's Rich Results Test with no errors, and
  follows the Claude example from `/ai`, through `/developers#connect-claude`, to a published playbook.
- [ ] **`/security` claims:** every statement on `/security` has a recorded check on production,
  and the page names no certification Caesura does not hold.
- [ ] **One place for safety:** `/ai`'s safety answer links to `/security` and does not repeat
  it, and every link on `/security` reaches a route or anchor that exists (unit test).
- [ ] **Reporting:** `/security`'s reporting section and `/.well-known/security.txt` read their
  contacts from one constant, and `security.txt` carries a `Policy:` line naming `/security`
  (unit tests).
- [ ] **`/security` search and signed out:** in the production sitemap with a canonical, an
  `og:url`, a title of 60 characters or fewer and a description of 160 or fewer; with JavaScript
  off it answers HTML with one `<h1>` (`test:e2e:ci-like`, or CI on the PR).
- [ ] **No build details on `/security`:** it names no response header, hosting or database
  vendor, library or repository.
- [ ] **`/security` words:** the title, description and headline are the words Mitchell
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
- **ChatGPT, Gemini:** Mitchell, before the gate (decision 15).
