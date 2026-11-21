# M63 part 4 — review r2 (fd83201..e5ebe40)

Verdict: **approve**. 0 blocking, 0 major.

Round 1, checked on e5ebe40:
1. NOT_DRAWN blocker: fixed (`scripts/route-artboard-index.mjs:66` has `/ai`). Part 5 needs the same for `/security`.
2. OG url: fixed (page.test.tsx asserts `/ai/opengraph-image.png`).
3. seo.spec sitemap: fixed (`/ai` at seo.spec.ts:101).
4. Prompts true to tools: fixed (ChatGPT names restaurants for search_places; Gemini says "the library"; Poppy is a signed-out Discover read). e2e PROMPTS match AiScreen.tsx.
5. "Disconnect" vs token revoke: soft, not addressed, not blocking.
6. Deny-list: fixed (both header names; also runs over metadata title and description).
7. "Names every surface": fixed, scoped to the `Ways in` region.
8. Rich Results Test: Mitchell's gate walk.

Minor (process, carried to the gate): the e2e red-first row in PR 787's body records a spec-before-source change and paraphrased failure text, not real Playwright output; the body still says "seen green only". Tidy at the gate, or re-record the e2e red with real output.

Not executed by the reviewer: tests, e2e, tsc, lint; the OG image was not viewed.
