### KI-2026-09-24-r — a page save already in flight can reach the server after the unload save, and win there

- **Severity:** data-integrity edge — rare, recoverable (see *Recovery*), not silent.
- **Milestone:** M14, carried rather than gating. Filed from CodeRabbit on PR #222 (thread on `useEditSession.ts`).
- **Area:** `apps/web/src/components/pages/useEditSession.ts`, `apps/web/src/components/pages/PageScreen.tsx`, `apps/web/src/server/pageCommands.ts`, and the `UpdatePage` command in `packages/contracts`.
- **Symptom / What happens:** commits are serialised on the client (c21ac2e): at most one ordinary PATCH in flight, and a stale result can no longer set `failed` or requeue content. The `pagehide` (keepalive) commit is the one exception — it cannot wait — so it can overtake an ordinary commit already in flight. If that older commit then reaches the server *after* the keepalive, the older document is appended last and wins. `appendToStream`'s `expectedSeq` does not catch it: each request reads the head current when it arrives, so neither conflicts.
- **Recovery:** every keepalive commit now writes a browser-local draft first (the other half of the same review). On the next load that draft's base no longer matches the page, so it is offered as "Restore mine / Discard" — never applied silently, never dropped. So the newer text is recoverable in the same browser, but it is on the reader to notice and restore it, and it is not there on another device.
- **The fix:** the server rejects a PATCH whose expected revision is no longer current. The client sends the page `updatedAt` (or stream position) captured when the commit started; `executePageCommand` compares it before appending and answers `stale` (the client then keeps its draft and offers it). That is a change to the page command contract — schema, CHANGELOG, every caller including `/api/v1` pages and the assistant's page tools — so it was deliberately left out of #222.
- **First noted:** 2026-09-24, CodeRabbit review of PR #222 (discussion_r4096852416).
- **Resolved:** 2026-09-24. The fix above was built in #222 (6d3fa2e, ac4c933), not left out after all.
  - `EditPage` / `UpdatePageInput` take an optional `expectedUpdatedAt`. `executePageCommand` compares it with the `pages` row inside the transaction and refuses with `page-changed` (409), appending nothing.
  - An overtaking keepalive names no revision, so the older commit is the one refused.
  - #226 closed the reverse race: an ordinary commit now waits for a keepalive in flight.
  - What is still open is in KI-2026-09-24-s: an overtaking keepalive during a real conflict is still last-write-wins, and the revision has millisecond precision.
