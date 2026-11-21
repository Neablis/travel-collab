# Review: PR 787 (M63 part 4, /ai) at fd83201, base 60af404 (part 3)

## Reviewed
Branch claude/m63-part4-ai-page, head fd83201afc2c170b102b84a3da94da65170043c8, base 60af4040. Read in full: page.tsx, page.test.tsx, AiScreen.tsx, AiScreen.test.tsx, jsonLd.ts and test, sitemap.ts and test, llms.txt route, landing/phone/developers diffs, e2e/m63-ai-page.spec.ts, the OG png (1200x630 PNG), plus DevelopersScreen (anchors), tools.ts, siteMetadata.ts, proxy.ts matcher, JsonLd component, scripts/route-artboard-index.mjs and its test. Plan Part 4 and milestone decisions 1, 4-7. Nothing was executed (read only).

## Findings

1. BLOCKER scripts/route-artboard-index.mjs (NOT_DRAWN, ~line 60), not in the diff.
   `scripts/__tests__/route-artboard-index.test.mjs:68` fails when `appRoutes()` returns a route in neither ROUTES nor NOT_DRAWN ("these routes have no artboard decision"). `appRoutes()` walks every `page.tsx`, so the new `(front)/ai/page.tsx` yields `/ai`, which has no entry. `/developers` and `/developers/reference` each have one. The suite goes red on CI. Fix: add `["/ai", "M63 part 4: ... no artboard"]` to NOT_DRAWN. Check whether the README index block needs regenerating (NOT_DRAWN routes are not printed in it today). Part 5 will need the same for `/security`.

2. MINOR apps/web/src/app/(front)/ai/page.test.tsx:46-49. The OG-image test only reads that the png and alt files are non-empty. It never checks that `metadata.openGraph.images[0].url` is "/ai/opengraph-image.png". A typo in the `image.url` passed to `pageMetadata` (page.tsx:19) leaves it green and ships a broken og:image. Fix: assert `images[0].url` and that it is followed by the site card. The file and URL wiring itself is right: the Next file convention serves `opengraph-image.png`, `pageMetadata` restates it because a segment `openGraph` replaces the file-derived one (siteMetadata.ts:25-33), and the image is 1200x630.

3. MINOR apps/web/e2e/seo.spec.ts:101. The sitemap e2e lists static paths and does not include "/ai". The unit test (sitemap.test.ts) covers it, so this is only a gap in the e2e list. Not blocking.

4. MINOR AiScreen.tsx:42-48 (prompts vs tools). Each prompt is within what the tool can do, with caveats:
   - Claude: "Turn my Lisbon trip into a three-day playbook and publish it." Maps to get_trip, create_playbook (kept from days), publish_playbook. True. Needs trips:read and playbooks:write (names not checked against SCOPE_CATALOGUE). OK.
   - MCP clients: "Which of my trips has a day with nothing planned yet?" list_trips and get_trip return days and stops. True.
   - ChatGPT: "Find three places to eat near my hotel in Kyoto and draft a playbook day". search_places only geocodes a named place (tools.ts:59-66, "by name"). It cannot find restaurants. The model must name them from its own knowledge, and "near my hotel" needs trips:read. Possible, but the prompt implies a discovery ability Caesura lacks. Suggest "Draft a playbook day in Kyoto around these three restaurants: ..." or accept it as is.
   - Gemini: "my library" is the published Discover library (list_discover_playbooks, search_library_cities), which is everyone's, not "my". list_my_playbooks is a different thing. Suggest "the library".
   - Poppy: "Read my trips" needs a signed-in OAuth token. Signed out, Poppy reads Discover only (discovery.ts header comment). The /developers section says "nothing to set up", which hides the sign-in. Suggest a Discover prompt or say it signs in.
   - Script: `GET /api/v1/trips` with trips:read. True. "save them to a file" is the shell's job. Fine.
   Production runs of these prompts are a gate item for Mitchell, not checked here.

5. MINOR AiScreen.tsx:68-80 (safety claims). Confirmed true: the token form's scopes default to ["trips:read"] (TokensSection.tsx:164) and the consent screen starts with the two notebook scopes unticked (per DevelopersScreen:211-218). "Notebook access starts switched off" and the Premium line match. "can never do more than you can" matches /developers wording. Two soft points: "it stops the moment you disconnect the tool" is true for a connected app, but a token is revoked, not disconnected. The FAQ's ChatGPT and Gemini "Yes" answers are unproven until Mitchell runs them (D15), so the build is allowed to ship them but the gate must remove them if they fail. The FAQ JSON-LD is derived from the same AI_FAQ array, so removal stays in sync.

6. MINOR AiScreen.test.tsx deny-list (last test). The plan names `Strict-Transport-Security`, `Content-Security-Policy`, "Hetzner" and "Coolify". The test lacks the two header names. It covers body text only, not the metadata title or description. Add the two words, and run the deny-list over `metadata` too.

7. MINOR AiScreen.test.tsx "names every surface". It checks that substrings appear anywhere in `main`, so "Poppy" is satisfied by the prompt label alone, and "assistant" by the intro. It would stay green if the "Ways in" list lost the Poppy or assistant bullet. Cheap fix: scope the check to the "Ways in" region.

8. NOTE (gate walk, unverified). `softwareApplicationJsonLd` has no `offers` or `aggregateRating`. Google's Rich Results Test may report a "Software app" item with missing fields, and FAQ rich results are limited to some site types. Structure is valid schema.org: WebPage.about is a SoftwareApplication, FAQPage.mainEntity is Question with acceptedAnswer Answer, and JsonLd serialises an array correctly (JsonLd.tsx, serializeJsonLd). The milestone [walk] box says "no errors". Mitchell should check it at the walk. Nothing to change before then.

## e2e spec and CLAUDE.md rule 3 (m63-ai-page.spec.ts)
The assertions would fail on an error page. It requires status 200, exactly one h1 (the Next not-found and error pages carry no copy of the six exact prompt strings), and all six prompts via `getByText(exact)` `toBeVisible` with JS disabled. It cannot pass on a 404 or 500. Weaknesses: it does not check the content type, the JSON-LD script or the canonical meta (the unit tests cover those on data only, and page.test.tsx mocks the JsonLd component, so the real serialised script is never asserted anywhere). Cheapest way to see it red: in AiScreen.tsx, change one prompt string, or add a second `<Heading level={1}>`, then `pnpm --filter web test:e2e:ci-like e2e/m63-ai-page.spec.ts` (no `--`), then restore. A `git stash` of nothing is not needed; this is one edit. A one-line alternative: temporarily rename the `/ai` dir and watch the status 200 fail.

## Clean
- Correctness of jsonLd.ts helpers and their tests (the test would fail if @type, mainEntity order or `about` changed).
- Search metadata: title "Caesura works with your AI: Claude, ChatGPT, Gemini" is about 51 chars, the description about 138, canonical "/ai" and og:url "/ai" are asserted. `absolute` is used so the layout template cannot push the title past 60.
- FAQPage matches the visible questions (same array; asserted by name).
- Static rendering and cache: no `auth`, `cookies`, `headers`, fetch or `dynamic` export; `deploymentOrigin()` reads configuration; same shape as /developers. `/ai` and `/ai/opengraph-image.png` are not in `proxy.ts`'s matcher (proxy.ts:309-322 is an explicit list; `ref`-param is the only wildcard).
- One scope table: no table, `/developers#scopes` linked and asserted.
- Link test: every internal href must be a served route (llms.txt and agents.md exist) and every hash a rendered id on /developers (the ConnectSection ids are on `<section>`, matching the test's region read). `/security` is the allowed upcoming route per the plan.
- Inbound links: landing footer (desktop and phone) and /developers, plus llms.txt with its test. All present.
- Data paths: nothing is written. Static copy only.
- Accessibility: one h1, h2 sections with aria-labelledby, h3 questions, real links. The footer link text "AI" is terse but labelled.
- Conventions: no "#nnn" in code, comments explain why.

## Not checked
No tests, e2e, typecheck or lint were run (read only, no checkout). I did not view the OG image visually. I did not verify scope names for each prompt against SCOPE_CATALOGUE, the real Rich Results Test output, the phone footer at narrow width, or production behaviour of any prompt or the ChatGPT/Gemini sections.
