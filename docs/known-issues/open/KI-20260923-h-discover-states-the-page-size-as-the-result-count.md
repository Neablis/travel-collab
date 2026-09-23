### KI-2026-09-23-h — Discover's results sentence states the page size, not how many days match

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
