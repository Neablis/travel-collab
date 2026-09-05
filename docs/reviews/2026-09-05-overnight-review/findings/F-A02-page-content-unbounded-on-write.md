# F-A02 — Notebook page title and content are unbounded on the write path (L5, still open since 2026-08-28)

- **Stream:** A Security · **Severity:** LOW (downgraded: requires an authenticated editor; Vercel's body cap bounds each request) · **Confidence:** CONFIRMED (verified)
- **Area:** `packages/contracts/src/pages.ts:255,292,299` (`title: z.string().min(1)`, no `.max`); `pageDoc.ts:44,72` (`z.record(z.unknown())`), `:78,210` (`z.string()` text with no max; only `.max` in the file is the heading level at `:171`); `apps/web/src/app/api/trips/[tripId]/pages/route.ts:23`, `pages/[pageId]/route.ts:20`; `server/pages.ts:93-99`. Contrast `/ask`: `MAX_ASK_BODY_BYTES` 128 KiB measured on the raw body (`handleAskRequest.ts:295-297`).
- **What is wrong:** an editor can store unlimited pages of up to the platform body cap each; row count is unbounded. Storage abuse by an admitted population, not an anonymous vector.
- **Suggested fix:** `title: .max(200)`; a `MAX_PAGE_BODY_BYTES` check mirroring `/ask` in both pages routes (via F-E04's `readBody`); `.max()` on text nodes. Contract change → CHANGELOG.
- **Scope of the fix:** `pages.ts`, `pageDoc.ts` (+ CHANGELOG), two routes. Check subset: contracts touched → `pnpm check`.
- **Test that should exist:** PATCH a page with a 5 MB body → 413/400 and row unchanged.
- **Cross-reference:** 2026-08-28 review L5; ADR-038 (its consequences say `passthrough()`/`z.unknown()` "go" — they went from the write path only); F-E04, F-B01 (same insertion point).
- **Do not:** drop `PageContent`'s read-path `passthrough()` (`pages.ts:84-99` explains why).
