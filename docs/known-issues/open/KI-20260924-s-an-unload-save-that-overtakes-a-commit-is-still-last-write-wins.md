### KI-2026-09-24-s — an unload save that overtakes an in-flight commit is still last-write-wins

- **Severity:** correctness (another traveller's words overwritten), narrow in practice. It needs a real conflict and an unload that lands during an ordinary commit's round trip.
- **Milestone:** M14, carried rather than gating. Filed from the stale-save fix on PR #222 (CodeRabbit thread `discussion_r4096852416`).
- **Area:** `apps/web/src/components/pages/useEditSession.ts` (`overtaking`), `apps/web/src/components/pages/PageScreen.tsx` (the commit function), `apps/web/src/server/pageCommands.ts` (the `expectedUpdatedAt` guard).
- **Symptom / What happens:**
  - A `pagehide` keepalive fired while an ordinary commit is in flight sends **no** `expectedUpdatedAt`. It can't: the revision it last saw is about to be moved by that commit, and naming it would refuse the author's own newest words.
  - If another device also changed the page in that window, the keepalive overwrites their document. It stays in the event log's history, so nothing is lost for good, but nothing on the page says it happened.
- **Second, smaller gap in the same guard:** the revision is `updatedAt`, which has millisecond precision (`occurredAt = new Date().toISOString()`). Two writes to one page in the same millisecond, with the older arriving second, compare as the same revision. A sequence-based page revision would close both gaps.
- **Why not fixed here:** a keepalive that can name a revision would need the in-flight commit's *result* before it is sent, and a `pagehide` handler cannot wait for it. That trade-off, relying on ordering for this one case, was accepted.
- **First noted:** 2026-09-24, stale-save fix (commits 6d3fa2e, ac4c933).
- **Re-verified 2026-09-25 (overnight sweep):** still true. `useEditSession`
  sets `overtaking = keepalive && inFlight.current` (`useEditSession.ts:131`);
  `PageScreen` then sends no `expectedUpdatedAt`
  (`const expected = overtaking ? null : baseRef.current`); the server guard
  compares `Date.parse` of `updatedAt` — millisecond instants — and only when a
  revision is sent (`pageCommands.ts:170-174`). No sequence-based page
  revision exists.
- **Re-verified 2026-10-25 (KI sweep 2):** unchanged. `PageScreen` still sends
  `const expected = overtaking ? null : baseRef.current`, and the server's
  `pageCommands.int.test.ts` "keeps last-write-wins for an edit that names no
  revision" passes on `main`. The re-verification left it open because each way to
  close it changes the trade-off this entry records as accepted:
  - **Wire flag (contracts change):** the keepalive names the in-flight commit's base
    revision with a flag meaning "or anything written since only by me". The server
    takes it if the page is at that revision or every page event after it is this
    actor's, and refuses another traveller's edit as `page-changed`. This touches
    `UpdatePageInput`, the route, `pagesClient` and the contracts CHANGELOG. Two
    devices of one person stay last-write-wins.
  - **Client only:** the keepalive always names `baseRef`. A `page-changed` answer
    whose fresh document is one this screen sent itself is rebased and sent again
    instead of being offered as someone else's. With the tab alive, nothing is lost.
    At unload nobody reads the refusal, so the draft kept before the send is offered
    on the next visit instead of landing. The common no-conflict race then saves
    later, and only with the author's click, unless the draft also records the
    in-flight document and the load treats "the page holds exactly that" as no
    conflict.
  - **Sequence revision** (this entry's own suggestion): a schema column and a
    contracts change. It lets the keepalive name "base or base+1", and it closes the
    millisecond gap as well.

