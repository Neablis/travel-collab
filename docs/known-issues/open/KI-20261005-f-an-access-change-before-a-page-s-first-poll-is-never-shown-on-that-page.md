### KI-2026-10-05-f — an Access change made before a page's first poll is never shown on that page

- **Severity:** correctness, narrow window. An owner with the trip open can miss a join, a revoke
  or a travelling toggle until they reload. KI-2026-10-04-b's fix has this hole in it.
- **Area:** `apps/web/src/components/trip/context/TripProvider.tsx`, `onAccessRevision`: the first
  `accessRev` it sees is taken as the baseline (spec W19). Also
  `apps/web/src/components/trip/context/broadcast.ts`: the timer starts only once there is a
  second member or an invite out (W73).
- **Symptom / What happens:** the owner creates an invite. That starts the 2s poll timer, and the
  first poll is about 2s later. If the invitee accepts inside that interval, the first poll's
  `accessRev` already includes the accept. It becomes the baseline, nothing is re-read, and the
  panel keeps showing the invite as pending. The totals stay as they were. Every later poll
  reports the same rev, so nothing changes until another Access write or a reload. The same
  happens to any Access write between a page's `load` and its first poll.
- **Reproduction:** `e2e/travellers.spec.ts` before it waited for the owner's first poll. In the
  ci-like lane the invitee signed in and joined about 1.5s after the invite was created, and
  the owner's sheet still read "Invited · 1" after 15s, failing on both attempts. Trace:
  invite `POST` 08:31:17.39, accept 18.90, first `events` poll 19.44, then every 2s with no
  `/access` re-read. The spec now waits for that first poll before the join, which is the
  human-speed case, and cites this entry.
- **Why not fixed here:** `TripProvider.tsx` is T8's file, and T9's scope is e2e and docs. The
  likely fix is to take the baseline from the read `load` makes, not from the first poll. That
  means returning `accessRev` with `GET /access` (a contract field, so it needs a changelog
  entry) or making one poll as part of `load`. Then a rev that moved after `load` is news.
- **Cross-reference:** KI-2026-10-04-b (resolved; this narrows it), spec D11, W19 and W73, ADR-065.
- **First noted:** 2026-10-05, travellers spec T9, in the new e2e spec's first ci-like run.
