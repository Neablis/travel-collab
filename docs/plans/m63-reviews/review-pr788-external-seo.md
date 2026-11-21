# PR 788 review — /security page, /ai page, /developers connect sections (M63 part 5, top of stack)

**PR:** https://github.com/Neablis/travel-collab/pull/788 — `feat(web): /security page, its search pieces and one list of contacts (M63 part 5)`
**Head:** `1c580da1` (`claude/m63-part5-security-page`), base `claude/m63-part4-ai-page` (stack, not `main` — retarget pending)
**Reviewed:** 2026-11-21, from the PR head (fetched as `origin/pr-788`), the live Coolify preview (`788.preview.caesura.today`), and the M63 milestone doc (`docs/milestones/M63-caesura-works-with-your-ai.md`).
**CI at head:** RED — `ci-ok` fails because `test / scripts` fails (docs/STATUS.md budget, see B1). Everything else green (unit, integration, e2e, typecheck, lint, CodeQL).
**PR state note:** the API reports `draft: false`, but the PR body still says "this PR is a draft" and both review checkboxes (part-reviewer, CI green) are unticked. One of the two is stale; the body needs updating.

## Verdicts

| Page | Verdict |
|---|---|
| `/developers` (Connect your AI + scopes + MCP tools) | **Ship with fixes** — three factual errors in the copy must be corrected first (F1–F3 below). The scope table itself is generated from the contract and is sound in structure. |
| `/ai` | **Needs rework as the SEO page it was commissioned to be.** As a connector page it is well built, but it contains zero of its own milestone's target keywords and never says what Caesura is. As a product page it can ship once the two factual errors are fixed; as the "AI travel planner" play it needs a copy second pass before merge, not after. |
| `/security` | **Ship with fixes** — one wording fix (F3). Every other claim checked out against the code. |
| **Overall** | **Do not merge yet.** Blockers: CI red (B1), the Notebook-unticked error on two pages (B2), the per-page share images 404 on the live preview (B3), and the M63 exit-gate items that are still open (no recorded production runs of the examples, words not yet approved — B4). |

## What verified well (so the fixes are scoped, not a rewrite)

- **SEO plumbing follows the M53 patterns, it is not hand-rolled.** Both new pages go through `pageMetadata()` (canonical + og:url + Twitter card), `webPageJsonLd` + `faqPageJsonLd` built from the same arrays as the visible FAQ (a question cannot be marked up without being shown), and the sitemap lists `/ai` and `/security` in `STATIC_PATHS` (verified live: preview sitemap has 279 URLs including both). `robots.txt` allows them; the preview correctly serves `noindex` via `siteRobots()`.
- **SSR verified live.** Full copy, H1, title, meta description, canonical, and JSON-LD are all present in the raw HTML of `/ai`, `/security`, and `/developers` (curl, no JS). The e2e specs run with JavaScript off. The M53 demo-page lesson does not repeat here.
- **Scope table cannot drift.** `/developers#scopes` renders `SCOPE_CATALOGUE` directly, and the MCP tools table is a join over each handler's declared scope (`toolScopes.ts`). All 11 API scopes are present with descriptions matching the Nov 15 decisions (current:read covers library + account + Notebook on current trips, never places:read). OpenAPI is 2.10.0 with `x-codeSamples` on 68/68 operations.
- **Tone rules hold.** Zero em dashes and zero "steal" in user-visible copy on all three pages (verified in the raw preview HTML). The only em dashes in the part-5 diff are in three code comments.
- **security.txt is correct live.** One `Contact:` (mailto), `Expires: 2027-10-01`, `Policy: https://caesura.today/security` (production URL, deliberate per the PR body's decision 18), `Canonical` naming the deployment.
- **`/agents.md` works.** Serves 200 as `text/markdown` on the preview, links absolute, api-catalog links it, llms.txt links both `/ai` and `/agents.md`.

## Blockers

### B1. CI is red: `test / scripts` fails on the docs/STATUS.md budget
- **What:** `docs/STATUS.md: only 5.9% headroom (28230/30000) — too tight to survive one real edit.` The check-run annotation names this exactly. `ci-ok` is red as a consequence.
- **Scope:** not caused by part 5 — STATUS.md is 28,230 bytes on the part-4 base too (vs 25,486 on `main`, so the stack as a whole grew it). But this PR is the stack's top and its one full CI run, so the stack cannot merge green until it is fixed.
- **Fix:** run a retirement pass on STATUS.md per `docs/guidelines/retiring-a-rule.md`, as the failure message itself instructs. Do not raise the budget.

### B2. The Notebook-unticked claim is wrong — and it appears on two pages
- **What:** `/developers` → Connect Claude, step 2: "Notebook access starts unticked." `/ai` FAQ: "Notebook access starts switched off."
- **Why wrong:** `ConsentScreen.tsx:96` initialises consent state as `scopes.filter(isRead)` where `isRead` = ends with `:read` — so `notebook:read` starts **ticked**; only `notebook:write` starts unticked. When a client sends no `scope` param the server defaults to all 11 scopes (`authorizeRequest.ts:142-145`). The code comment in `DevelopersScreen.tsx` (~:215-219, "ticks every scope but the two `notebook:` ones (D5)") repeats the same error.
- **Fix:** "Notebook *writing* starts unticked; reading the Notebook starts ticked." Fix the code comment too. (Accuracy check: `apps/web/src/components/front/DevelopersScreen.tsx`, `apps/web/src/components/front/AiScreen.tsx:80`.)

### B3. Both per-page share images 404 on the live preview
- **What:** `https://788.preview.caesura.today/ai/opengraph-image.png` → 404 (app's own not-found page). Same for `/security/opengraph-image.png`. The root `/opengraph-image.png` returns 200. The `og:image` meta tags point at the 404ing URLs, so share cards will fall back to the site-wide image (pageMetadata does list it second, so cards are not imageless — the per-page card is just dead).
- **Why it is not staleness:** the preview build is at the part-5 head (it contains part-5-only strings: "how access is protected" on `/developers`, "Premium" and "Face ID" on `/security`). The PNGs are in git at the head (52,889 and 22,175 bytes, added in parts 4 and 5). The unit tests assert only that the file exists on disk and metadata points at it — nothing checks servability.
- **Fix:** find why the segment-level `opengraph-image.png` files under the `(front)` route group do not serve (root-level file serves fine), fix it, and add a servability check — e.g. an e2e assertion that each `og:image` URL answers 200 — so a future image cannot silently 404. This is a claimed deliverable ("its own share image", M63 D7/D14), not a cosmetic extra.

### B4. M63 exit-gate items are still open (do not merge past the gate)
- **No recorded production run of any example.** The gate requires "every AI tool `/ai` or `/developers` names has a recorded production run of its example, and no tool without one is named." The PR body states no manual browser or preview walk was done. ChatGPT and Gemini are named with sections the code comment itself says "await a production proof (M63 D15)" — and that caveat exists only in a non-rendered comment, not in visible text. M63 D3 is explicit: "An example that cannot be shown working is cut, not described."
- **Words not yet approved.** The PR body calls the titles/descriptions "Strings drafted for Mitchell". The gate requires "the title, description and headline are the words Mitchell approved."
- **The `[walk]` item is Mitchell's click:** Rich Results Test on `/ai`, and following the Claude example from `/ai` through `/developers#connect-claude` to a published playbook. Note this cannot be a clean walk today: see S2 (Muse connector 401).
- **`/security` claims:** the PR body's claims table lists what to check on production, not results. The gate requires every statement to have a recorded production check.

## Should-fix

### S1. `/developers` title and description were rewritten — M63 decision 8 says they do not change
- **What:** the stack changed `/developers` title from "Developers" to "Build on Caesura: the trip planning API" and the description from "The Caesura API: how to get invited, make an API token, and find the OpenAPI reference." to "The Caesura API, from your first token to your first trip: sign up, make an API token, and read the OpenAPI reference." (`apps/web/src/app/(front)/developers/page.tsx`).
- **Why it matters:** M63 decision 8 states "/developers' title and description, approved in M53, do not change", and "Rewriting the rest of `/developers` or its M53 title and description" is in the milestone's Out of scope list. The new description is factually fine (signup is open since ADR-063 — verified), but the rewrite is out of scope and the copy is unapproved. The canonical addition in the same change is justified (the M53 audit flagged the missing canonical) and should stay.
- **Fix:** revert title and description to the M53-approved words; keep `canonical: "/developers"`.

### S2. The Claude section has no caveat for Muse — and a Muse user following it will fail
- **What:** `/developers#connect-claude` presents "add a custom connector → sign in and allow it" with no caveat, and `/ai` FAQ says "Any other app that speaks MCP connects the same way."
- **Why it matters:** diagnosed Nov 15, 2026 and still open (KI-20261111-a): the Muse Poppy connector sends **no `Authorization` header** to `/api/mcp`, so MCP tools 401 even after a successful sign-in. The page never distinguishes Claude's own custom connector from Muse's Poppy connector. A Muse user following "Connect Claude" will fail at the last step with no explanation on the page. (The MCP route itself is verified OAuth-only: `apps/web/src/app/api/mcp/route.ts:60` refuses anything whose `via !== "oauth"`; no session cookie, no `tc_` token.)
- **Fix:** add a visible note that these steps are for Claude's own connector, and that Muse's connector cannot yet complete the MCP sign-in (or prove the Claude path end-to-end first — see B4 — and say so). Do not leave the only caveat in a code comment.

### S3. Scope-description overstatements (the copy is the contract a user grants against)
All in `packages/contracts/src/publicApi.ts` (`SCOPE_CATALOGUE`), rendered verbatim on `/developers#scopes`, in the consent screen, the token form, and `openapi.json` — so each fix lands everywhere at once.
- **`current:read`** — "plus your saved-days library, Playbooks and account" overstates: the library/playbook *list* accepts `current:read`, but `GET /v1/playbooks/{id}` and playbook export require `library:read` with no `orScope`, so a `current:read`-only token cannot read a single Playbook. Fix: qualify as "Playbooks *listed*" — or add `orScope: "current:read"` to `getPlaybookDef`/`exportPlaybookDef` (the PR 761 precedent: copy promised share links, so the endpoint was changed, not the copy).
- **`current:write`** — "Changing a current trip needs this scope or `trips:write`" overstates: `PATCH /v1/trips/{id}` (name/dates/currency/budget), DELETE/restore, trip-cover PUT/PATCH, and Notebook PATCH/DELETE all need the full scopes. Fix: narrow to "Change the days and stops of a current trip, and undo, redo or revert those changes." (the description's first sentence is already right; it is the second sentence that overreaches).
- **Base scopes' "needs this scope" sentences ignore the `current:*` twins.** `trips:read`, `trips:write`, `notebook:read`, `library:read`, `account:read` are each also satisfiable by `current:read`/`current:write` on endpoints declaring `orScope`. Fix: add "or its current twin" or soften to "needs this scope for trips that aren't current".
- **`places:read`** — "Finding a place by name needs this scope" overstates: trip-scoped `GET /v1/trips/{tripId}/geocode` takes `trips:write`. Fix: "Finding a place by name *outside a trip* needs this scope."

### S4. Error-envelope shape is overstated on `/developers`
- **What:** "Every error is `{ "error": { "code", "message", "details" } }`."
- **Why wrong:** `fail()` builds `{ error: { code, message, ...(details only if provided) } }` (`apps/web/src/server/public-api/route.ts:383-391`); `details` is optional. Most errors carry no `details`.
- **Fix:** "Every error is `{ "error": { "code", "message" } }`, with `details` on some."

### S5. `/security` fingerprint wording overclaims
- **What:** "We keep only a fingerprint of each API token and app connection, which cannot be turned back into it."
- **Why wrong in part:** API tokens are stored only as a keyed HMAC digest, as are OAuth access/refresh/code tokens and recovery codes — that half is right. But no fingerprint of an "app connection" exists: the `oauth_grants` row stores `clientId`/`clientName`/`redirectUri`/`scopes` in plaintext (`apps/web/src/server/db/schema.ts:441-466`); only the grant's *tokens* are fingerprinted.
- **Fix:** "We keep only a fingerprint of each API token and of each app connection's tokens, which cannot be turned back into them." (`apps/web/src/components/front/SecurityScreen.tsx`, "Your data" section.)

### S6. `/ai` "Ways in" overstates Connected apps
- **What:** "Connected apps, under Account and Security, lists every tool you have connected."
- **Why wrong:** tools connected by token (ChatGPT, Gemini, a script) appear under **API tokens**, not Connected apps. Only OAuth-connected apps appear in Connected apps.
- **Fix:** "lists every *app* you have connected; tools using a token are listed under API tokens." (`apps/web/src/components/front/AiScreen.tsx`.)

### S7. `/developers` has no JSON-LD (pre-existing gap, cheap to close while here)
- `/ai` and `/security` ship `WebPage` + `FAQPage` matching their visible content. `/developers` ships none (verified in the raw preview HTML; also true on `main`). A `WebPage` block would cost one `JsonLd` element and match the M53 pattern. Nice-to-have, not a blocker.

## Nice-to-have / observations

- **"M63 D15" is cited but does not exist in the committed milestone doc.** `DevelopersScreen.tsx`'s comment says the ChatGPT/Gemini sections "await a production proof (M63 D15)", but `docs/milestones/M63-caesura-works-with-your-ai.md` has decisions 1–14 only. If decision 15 lives in the plan file (`docs/plans/2026-11-21-M63-caesura-works-with-your-ai.md`), that file is not in the repo on `main`, on the part-4 base, or on this PR head — commit it or fix the citation.
- **`/ai` links to no core trip content.** Its outbound links go to `/developers`, `/security`, `/llms.txt`, `/agents.md`, `/signin`, and home — nothing to `/playbooks`, `/demo`, or a sample playbook. For a page meant to earn search traffic, link the thing it is selling at least once.
- **Em dashes in code comments only.** Three in the part-5 diff (openapi.ts comment, security/page.tsx comment, route-artboard-index.mjs). The no-em-dash rule governs site copy, which is clean; leave the comments or tidy them, no strong view.
- **`/developers` title carries the layout's em dash** ("Build on Caesura: the trip planning API — Caesura") via the `%s — Caesura` template. Pre-existing template behaviour, not this PR's copy; noted only because the title was touched here anyway.
- **Scalar rendering of `x-codeSamples` is unverified.** The CHANGELOG asserts "Scalar draws them in the reference in place of its own snippet", and 68/68 operations carry samples, but nothing in the PR evidences Scalar rendering them. M63's gate item requires it ("or the part is recorded as cut because Scalar does not render them"). Check on the preview's `/developers/reference` before merge.
- **`/security` "Connections to Caesura are encrypted" is true for production with a caveat:** HSTS is production-only in `next.config.ts`, and the http→https redirect lives at the front proxy, outside the repo. Fine as written; just do not strengthen the claim.
- **"Every other device is signed out" is true with a timing nuance:** enforcement happens on the other device's next server-side `auth()` read, not as a push; the proxy's DB-free JWT instance does not check the epoch. The page's plain wording is acceptable.
- **Premium FAQ is true but narrower than reality:** the token/connected-apps lists render on every plan; only minting/connecting is Premium-gated. The "On the Premium plan" condition is true but unnecessary. Leave as is or soften.

## SEO section — can these pages capture "AI travel planner" traffic?

### The short answer
**Not as built.** The `/ai` page is a well-made connector page that targets none of its own milestone's keywords. M63 decision 1 says it "targets *AI trip planner*, *trip planner MCP server*, *Claude trip planning* and *travel planning API for agents*". The live page contains **none** of those phrases — the words "travel planner" and "trip planner" do not appear anywhere in its raw HTML, the word "travel" does not appear at all, and the page never defines what Caesura is (that definition — "a trip planner for a group going somewhere together" — lives only on `/developers`). A searcher landing on `/ai` from "AI travel planner" finds connector instructions, not a travel-planning pitch. The plumbing is all correct (see "What verified well"); the copy is aimed at the wrong query.

### Per-page SEO facts (verified live on the preview)
- **`/ai`** — title "Caesura works with your AI: Claude, ChatGPT, Gemini" (51 chars, within limits, wrong keywords); description 137 chars ("Ask Claude, ChatGPT, Gemini or another AI tool to plan in Caesura for you…"); H1 "Caesura works with your AI"; H2s "Ways in / Try asking / Safe by design / Questions"; `WebPage` + `SoftwareApplication` + `FAQPage` JSON-LD (4 Q&A, matching visible FAQ); canonical + og:url present; in sitemap; SSR confirmed. No BreadcrumbList — correct, there is no visible breadcrumb trail to mark up.
- **`/security`** — title "Security at Caesura: your account, your data, your AI" (53 chars); description 119 chars; H1 "Security at Caesura"; `WebPage` + `FAQPage` (3 Q&A); canonical + og:url; in sitemap; SSR confirmed. Reasonable for branded trust queries ("caesura security", "is caesura safe") — though the word "safe" appears in its copy only via the `/ai` FAQ link, not in its own title/H1. Fine as is.
- **`/developers`** — title "Build on Caesura: the trip planning API — Caesura" (49 chars); description changed by this stack (see S1); canonical added by this stack (good, the M53 audit flagged its absence); no JSON-LD (see S7). Anchors `#connect-claude`, `#connect-mcp`, `#connect-chatgpt`, `#connect-gemini`, `#connect-poppy`, `#connect-script`, `#scopes`, `#mcp-tools` all present in the raw HTML.
- **Cannibalization:** none serious. `/ai` and `/developers` target different intents (non-developer vs developer); the homepage targets "trip planner" generically. The problem is the inverse: `/ai` targets nothing, so it neither cannibalises nor captures.
- **AI Overview risk:** unverified. `browser.search` surfaces no AI Overview block, so whether Google answers these queries above the fold could not be confirmed from here — check in a live browser before forecasting clicks.

### Winnability of the three target queries (competitive check, 2026-11-21)
- **"AI travel planner" — not winnable near term.** Top results are freshly-updated listicles from established publishers (unite.ai "10 Best AI Tools for Travel Planning", ClickUp "11 Best AI Travel Planner Assistants"), plus tested-comparison niche sites (aitravel.tools, thebestsuperintelligence.io). Small sites do rank (#3–4) but only with deep, tested, frequently-updated comparison content — not a product pitch page. Top 10 is a stretch; top 3 is not on the table.
- **"using ai to build my trip" — weakest head SERP, most winnable of the three, but only as a how-to guide.** All top results are small sites with generic how-to guides (breazely.com, buildaiq.com, monkeytravel.app, billshometech.com); no big publisher, no major brand. The ranking intent is "teach me how", so `/ai` would need a genuine guide (brief → prompts → verification), not a connect pitch, to match it.
- **"Claude ai trip builder" — most open SERP, but the intent is tutorial, not product.** No authority publisher and no planner product page in the top 5; all small creators selling/teaching Claude skills and prompts (Substack skill, affpapa skill directory, uknowhow.ai tutorial, learnaiwithmariah.com). A page that *teaches* Claude trip-building and shows Caesura as the place the plan lands could plausibly compete — but only by matching the tutorial intent with copyable prompts/skills.
- **"best AI trip planner 2026" (the listicle angle) — most dominated.** Mindtrip (usually #1–2), Layla, Wanderlog, ChatGPT, Gemini/AI Mode, Wonderplan recur in every listicle. Inclusion *in* these listicles matters more than outranking them; a Caesura listicle would compete against pages updated days ago.

### Top 5 SEO improvements, ranked by expected impact
1. **Retarget `/ai` copy to the queries it is supposed to win (D1).** Put "AI trip planner" in the H1/title area (e.g. H1 "Caesura is the AI trip planner that works with your AI" — Mitchell approves the words), add a one-line definition of what Caesura is for a cold visitor, and add a short "plan a trip with Claude" how-to section with copyable prompts (brief → prompts → verify). This single change addresses the D1 miss and the "using ai to build my trip" intent at once.
2. **Own the "real places, not hallucinations" angle.** The ranking pages document the pain: theairankings.com cites a survey where 55% of AI-trip-planners hit ≥1 bad recommendation and 16% were sent to a nonexistent place; other guides report wrong hours and impossible schedules. Caesura's differentiator — playbooks are real days from real trips, stops are verified places on a map — is nowhere on `/ai`. Make it a section with quotable facts; it is the one headline no ranking page owns.
3. **Add AI-citation-ready facts.** Give answer engines something quotable: a compact "Caesura in one paragraph" (what it is, playbooks from real trips, 11 fine-grained scopes, MCP + Poppy + tokens + API, Premium-gated AI access, disconnect any time). The current copy has the pieces scattered across sections; a tight summary block near the top is what gets cited.
4. **Target the winnable long tail instead of (or in addition to) the head terms.** In priority order: "plan a trip with Claude" (tutorial intent, small-site SERP); "connect Claude to trip planner" / "Claude trip planner MCP" (direct competitors TripHelm, aitrips.io, Roadbook are small sites — winnable); "MCP trip planner" (no end-user guide exists, open gap); "Claude trip planner with real places" (the hallucination pain point); "AI assistant that plans trips from my saved places" (Caesura's saved-days library; nothing in the Claude SERPs covers starting from already-saved places); "use ChatGPT/Claude to plan a trip then save it in a trip planner" (the unowned seam between chatbot guides and planner listicles — exactly where `/ai` sits).
5. **Fix the internal linking and the share images.** Link `/ai` to core content (`/playbooks`, `/demo`, one sample playbook) so earned traffic has somewhere to go, and get the per-page OG images serving (B3) — a page that cannot render its own share card will underperform everywhere it is shared, including the AI-answer citations in (3).

### Follow-up, not this PR
- Per-tool landing pages ("A page per AI tool. One page first; per-tool landing pages are a candidate if the one page ranks") — M63 explicitly defers these. Do the `/ai` rework first and measure.
- Third-party directory listings (MCP registries, GPT store, Poppy directory) are out of scope for M63 and are Mitchell's accounts.

## Factual corrections needed on `/developers` (short list)
1. Notebook: only *writing* starts unticked; *reading* starts ticked. (Also fix the D5 code comment and the `/ai` FAQ repeat.)
2. Error envelope: `{ "error": { "code", "message" } }`, with `details` on some errors — not on every error.
3. `current:read`: a token holding it can *list* Playbooks but cannot read a single Playbook or export one — qualify the description or add the `orScope`.
4. `current:write`: covers days/stops/undo/redo/revert on a current trip only — not renaming a trip, deleting/restoring it, changing its cover, or editing Notebook pages.
5. Base scope descriptions: add "or its current twin" where an `orScope` alternative exists.
6. `places:read`: finding a place by name needs this scope only *outside a trip* (trip-scoped geocode takes `trips:write`).
7. Claude section: visible caveat that this is Claude's own connector; Muse's connector cannot yet complete the MCP sign-in (KI-20261111-a). ChatGPT/Gemini sections likewise need their proof status visible or the sections cut per D3.
8. Revert the `/developers` title/description rewrite to the M53-approved words (keep the new canonical).

## Unverified (marked, not passed)
- Whether Scalar renders the `x-codeSamples` in `/developers/reference` (68/68 operations carry them in the document; rendering not checked — needs a JS render or a look at the preview reference page).
- Whether Claude's own custom connector completes the OAuth → MCP flow end-to-end on production (no recorded run in evidence; the only recorded MCP runs are Muse's, which 401).
- Whether Google shows an AI Overview for the three target queries (could not be confirmed via text search; check in a live browser).
- The M63 plan file's decision 15, cited in a code comment; the plan file is not in the repo.
- Production checks for the `/security` claims table and the `/ai` prompt walk (M63 gate items; listed as to-do in the PR body, not results).

## Method note
PR details, file list (45 files vs the part-4 base; part 5 itself is 23 files, 558 insertions), and check runs via `gh_api.py`; the branch fetched as `origin/pr-788`. Scope catalogue read from `packages/contracts/src/publicApi.ts` at the head; scope/flow/security claims re-checked against code at the head (16 claims, by a delegated accuracy pass); preview pages fetched as raw HTML via curl (title/meta/canonical/JSON-LD/SSR/anchors/OG servability) and via text fetch; sitemap/robots/security.txt/agents.md checked live on the preview; competitive SERPs via `browser.search` (note: each query returned 4–5 results, not a full top 10 — absence from these lists is not absence from Google's top 10). Nothing was changed, published, or merged.
