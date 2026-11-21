# External PR 788 review — verified at 5f19212 (Opus, read-only)

Source: `review-pr788-external-seo.md`. Verdicts below decide what is fixed.

## Fix now (top part, one push)
- **B2 Notebook — VALID.** `ConsentScreen.tsx:96` ticks every `:read` scope, leaves every write unticked; `notebook:read` starts ticked. Wrong copy at `DevelopersScreen.tsx:273` (also on main), `AiScreen.tsx:81`; wrong comment `DevelopersScreen.tsx:249-250`. Fix: reading starts ticked; anything that changes your data, Notebook included, starts unticked.
- **B3 per-page OG 404 — VALID, cause found.** In the `(front)` route group Next 16.4.6 serves the convention files at a hashed path (`/ai/opengraph-image-4tgthj.png`, `/security/opengraph-image-8sexud.png`, both 200); `pageMetadata` hard-codes `/ai/opengraph-image.png` (`ai/page.tsx:18`, same in `security/page.tsx`), which 404s. Tests only check the file exists. Fix: move the PNGs out of the convention (e.g. `public/og/ai.png`, `public/og/security.png`), point `image.url` at them, keep alt text; add an e2e check in `seo.spec.ts` that every page's `og:image` URL answers 200.
- **S4 error envelope — VALID (on main).** `public-api/route.ts:383-391` adds `details` only when given; copy at `DevelopersScreen.tsx:239`. Fix: `{ "error": { "code", "message" } }`, with `details` on some errors.
- **S5 fingerprint — VALID.** `SecurityScreen.tsx:138`; `oauth_grants` (`schema.ts:442-466`) stores client, redirect URI, scopes in plain text. Fix: "…of each API token and of each app connection's tokens, which cannot be turned back into them."
- **S6 Connected apps — VALID.** `AiScreen.tsx:182`, `:210`. Token-based tools (ChatGPT, Gemini, scripts) appear under API tokens. Fix: name API tokens next to Connected apps.
- **S7 /developers JSON-LD — VALID, optional.** Add a `webPageJsonLd` block.
- **No trip links on /ai — VALID.** Draft a link to `/playbooks` (Mitchell approves words).
- **SEO: no D1 keywords on /ai — VALID.** "trip planner", "travel planner", "trip planning", "API for agents" never appear; no sentence says what Caesura is. Draft (D17: approved on the preview): a title/H1 and a one-line definition using D1's keywords.

## Separate (not M63)
- **S3 scope copy — VALID, pre-existing on main, `packages/contracts`.** `current:read` vs `getPlaybookDef`/`exportPlaybookDef` (`playbooks.ts:305,371`) and saved-day GET (`library.ts:204`) lacking `orScope`; `current:write` second sentence overreaches (trip PATCH/DELETE, restore, cover, Notebook writes); base scopes ignore `current:` twins; `places:read` second sentence overreaches (trip geocode takes `trips:write`). Needs a contract CHANGELOG entry, openapi regen, full typecheck: its own PR.

## Invalid / no change
- **B1** — fixed by the STATUS.md trim (21,857/30,000).
- **S1** — /developers title and description are identical on main; D8 holds.
- **"D15 missing"** — true only of main; D15 is in the milestone file on part 0.
- **S2** — KI-20261111-a does not say Muse sends no Authorization header; Muse belongs under `#connect-poppy`. Real gap: Poppy's "takes it from there" is backed only by `poppy.json` 200 → Mitchell.

## For Mitchell
1. Approve the drafted /ai title, H1 and definition line (D1 keywords), and all titles/descriptions/headlines (D17).
2. Prove ChatGPT and Gemini on production, or cut them before merge (D15).
3. Production runs: a real `trips:read` token script, Claude publishing a playbook, Poppy end to end (or narrow its wording).
4. A recorded production check per `/security` claim.
5. Scalar shows the code samples on the preview `/developers/reference`.
6. Rich Results Test on /ai and the other walk items.
