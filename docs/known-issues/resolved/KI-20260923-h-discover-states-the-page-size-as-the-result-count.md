### KI-2026-09-23-h — Discover's results sentence states the page size, not how many days match — RESOLVED

- **Severity:** correctness (a stated number that is false), cosmetic in effect.
- **Area:** `apps/web/src/components/playbooks/DiscoverScreen.tsx` — the
  `discover-results-line` renders `feed.data.days.length`; `server/playbooks.ts`
  caps a page at `PAGE_LIMIT` (24) and sets `truncated`.
- **Symptom:** with the whole imported library (148 published days) and no
  place selected, the line reads **"24 shared days · Most added ▾"**, followed
  by *"Showing the best matches. Narrow the places to see the rest."* 24 is the
  page, not the match count. Seen on M12's gate walk, 2026-09-23
  (`w7-01-dropdown.png`), and it predates M12 — the line has read
  `days.length` since M11b.
- **Why not fixed here:** it needs the endpoint to return a match count beside
  the capped page (a `DiscoverResponse` field, so a contract-change entry), and
  a decision on wording once it is truncated (`24 of 148 shared days`?). M12's
  gate does not cover it.
- **Cross-reference:** SPEC §33.2 (the results sentence), M11b link 5.
- **First noted:** 2026-09-23, M12 gate walk.
- **Resolved:** 2026-09-24. **Not a contract change**, correcting "Why not
  fixed here": `DiscoverResponse` lives in `apps/web/src/lib/playbooks.ts`, not
  `packages/contracts`, so this was a web-only change; `/api/v1/discover/playbooks`
  is served by `discoverPage`, which is untouched, so the public API and
  `openapi.json` did not change. The response gains `matchCount` and
  `matchCountExact`. `discoverDays` adds `count(*) over ()` to the query it
  already runs (no second query, no extra scan: the ranking already visits every
  matching row), so the total is a real count under the same WHERE — scope,
  places, length and rating — not the 200-row candidate window. Inside the
  window the count is `filtered.length` (band applied, unreadable rows dropped,
  so it agrees with the page); past it, the SQL total less the rows that did not
  parse; past it WITH a budget band on, the band cannot be a predicate (ADR-029)
  so the count is a floor and `matchCountExact` is false. Wording (SPEC §33.2
  gives only `128 shared days`): complete → `N shared days`; truncated →
  `24 of 148 shared days`; a floor → `24 of 187+ shared days`.
  **Proof:** reproduced first — `DiscoverScreen.test.tsx` "states how many days
  match…" failed on HEAD with `expected '24 shared days' to be '24 of 148 shared
  days'`, and `route.int.test.ts` "counts every matching day…" / "counts past the
  candidate window…" failed with `expected undefined to be 30` / `… 205`. All
  pass after the fix; breaking the server path (`Math.min(filtered.length,
  PAGE_LIMIT)`, `candidates.length`) turned them red with `expected 24 to be 30`
  and `expected 200 to be 205`, and reverting the sentence to `days.length`
  turned the component tests red again.
