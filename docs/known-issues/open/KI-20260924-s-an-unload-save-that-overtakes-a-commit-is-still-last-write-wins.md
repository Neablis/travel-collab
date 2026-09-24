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
