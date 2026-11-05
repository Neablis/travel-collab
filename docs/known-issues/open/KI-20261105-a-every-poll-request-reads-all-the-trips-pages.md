### KI-2026-11-05-a — every poll request reads all of the trip's pages to find the poll

- **Severity:** performance, at scale only. Fine at normal sizes; slow on a trip with hundreds of pages.
- **Area:** `apps/web/src/server/polls/votes.ts`, `pollOnTrip`: selects the `content` of every page on the
  trip and walks each document with `pollsIn` until one holds the poll id. The poll route's results read,
  a vote, a close and a reopen each call it.
- **Symptom / What happens:** each poll request costs one full read and parse of the trip's notebooks,
  however small the poll. Nothing is wrong at the sizes trips have today.
- **Why not fixed here:** scope (PR 693). Mitchell, 2026-11-05: file it.
- **Fix path:** an index from poll id to page id, written when a page is saved (the page write path in
  `apps/web/src/server/pages.ts`, `checkPageDocForWrite`, already sees every poll) and rebuildable from the
  pages like any projection. `pollOnTrip` then reads one page. A pasted copy of a poll on one trip is the
  same poll (the first copy's options win), so the index keeps the first.
- **Tripwire:** a trip with hundreds of pages, or poll requests showing up in slow-route logs.
- **Cross-reference:** PR 693, M58 decision 8.
- **First noted:** 2026-11-05, from the PR 693 review.
