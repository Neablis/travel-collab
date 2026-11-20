# M63 — One page says Caesura is AI first, and shows it working with your AI

**Status (2026-11-20): proposed, not scoped.** Minted by Mitchell the same day: *"adding a SEO page
about how caesura is a AI first tool, document all the AI tools we have like mcp, fine scoped
tokens, the api, agents.md, poppy, and give examples how caesura is a partner to your favorite ai
tools."* Placed **last**, after M62, until Mitchell places it (see `docs/milestones/README.md`,
*2026-11-20 — minted: M62 and M63*). Every decision below is a recommendation; none has been
answered.

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

`/developers` (M53's static copy) is written for someone who already wants a token. Nothing
speaks to the person who asks *"does this work with Claude?"* or *"can ChatGPT plan my trip in
it?"*, and nothing ranks for those searches.

## Decisions

### Open

1. **The URL and the words it targets.** *Recommendation:* `/ai`, titled *"Caesura works with
   your AI: Claude, ChatGPT, Gemini and agents"* (the build proposes the final words, and Mitchell
   approves them, as in M50 and M53). It targets *AI trip planner*, *trip planner MCP server*,
   *Claude trip planning* and *travel planning API for agents*. It is in the sitemap, linked from
   the landing's footer, `/developers`, and `/llms.txt`.
2. **What "agents.md" is here.** There is no public `agents.md` today. The repository's own
   `AGENTS.md` is the operating manual for the agents that *build* Caesura. *Recommendation:*
   publish a site-level **`/agents.md`**, the instructions file for an agent that *acts on*
   Caesura: how to authenticate (token, OAuth, Poppy), which surface to use for which job, the
   scopes, the rate limits, and what never to do (publish without asking, for example). It is a
   sibling of `/llms.txt` and is generated from the same `SCOPE_CATALOGUE`. The page also gets a
   short *Built with agents* section that says Caesura itself is built by AI agents under one
   `AGENTS.md`. That section only describes the practice and does not link the private repo.
   Mitchell decides whether that section ships.
3. **Which AI tools the examples name.** *Recommendation:* only what has been seen working on
   production, each with its setup in three steps or fewer:
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
4. **Fine scoped tokens, explained to a non-developer.** *Recommendation:* one table generated
   from `SCOPE_CATALOGUE` (never a copy), with each scope's title and description, and a line
   that says *a token can never do more than you can, and you can revoke it at any time*. The
   same goes for OAuth grants and *Connected apps*.
5. **Structured data.** *Recommendation:* `WebPage` with `about` the `SoftwareApplication`, and
   an `FAQPage` block for the four or five questions the page answers (*Does Caesura work with
   Claude? With ChatGPT? Is my data safe with an AI tool? What can an agent not do?*). The FAQ is
   only marked up if it is visible on the page.
6. **How the examples stay true.** *Recommendation:* the page's surface list and its MCP tool
   names are read from code (`tools.ts`, `API_SCOPES`, the OpenAPI paths), not typed, and a unit
   test follows every link on the page to a route that exists, as `discovery.test.ts` does for
   `llms.txt`. The written prompts are prose, so each one is walked on production before the gate.
7. **Signed out and fast.** *Recommendation:* a static server-rendered page outside `proxy.ts`'s
   matcher, like `/developers`, with no client JavaScript beyond the shared shell. It is
   cached, has its own OG image, and stays inside M53's title and description limits.

## Scope

A first cut of the parts, for the plan to settle:

1. **Proving the examples** (decision 3): run each named tool against production and record what
   works. This decides the page's list.
2. **`/agents.md`** (decision 2): the route, generated from the contracts, linked from
   `llms.txt` and the api-catalog, with a discovery test.
3. **The `/ai` page** (decisions 1, 4, 6, 7): the surfaces, the scope table, the examples, and
   the *Built with agents* section if Mitchell keeps it.
4. **Search** (decisions 1, 5): metadata, JSON-LD, the OG image, the sitemap entry and the
   inbound links.
0. **The gate**: the evidence, the approved words, the retro.

## Out of scope

- New AI capability. This milestone describes what exists, and a gap found in part 1 becomes a
  known issue or a candidate.
- Listing in third-party directories (MCP registries, the GPT store, Poppy's directory). They
  are Mitchell's accounts and a candidate.
- A page per AI tool. One page first; per-tool landing pages are a candidate if the one page
  ranks.

## Exit gate

- [ ] **Examples:** every AI tool the page names has a recorded production run of its example,
  and no tool without one is named.
- [ ] **`/agents.md`:** it answers 200 as `text/markdown` signed out, its scopes are
  `SCOPE_CATALOGUE`, and `llms.txt` and the api-catalog link it (unit tests).
- [ ] **Surfaces:** the page names the assistant, the MCP server, scoped tokens, the public API,
  Poppy, `llms.txt`, `agents.md` and Connected apps, and every link on it reaches a route that
  exists (unit test).
- [ ] **Scopes:** the scope table is rendered from `SCOPE_CATALOGUE`, which a test proves by
  adding a scope in a fixture.
- [ ] **Search:** the page is in the production sitemap with a canonical, an `og:url`, a title
  of 60 characters or fewer, a description of 160 or fewer, and `FAQPage` JSON-LD that matches
  the visible questions.
- [ ] **Signed out:** with JavaScript off, `/ai` answers HTML with one `<h1>` and every example
  (`test:e2e:ci-like`, or CI on the PR).
- [ ] **Words:** the title, description and headline are the words Mitchell approved.
- [ ] **[walk]** Mitchell runs `/ai` through Google's Rich Results Test with no errors, and
  follows the Claude example from the page to a published playbook.
