### KI-2026-10-05-g — an Access change made before a page's first poll is never shown on that page — RESOLVED

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
- **Resolved:** 2026-10-05 (spec W22, amending W19). The baseline now comes from the access read
  `load` makes, not from the first poll. This is the entry's first option.
  - `TripAccess` carries an optional `accessRev` (contracts CHANGELOG, same date).
    `GET /access` and the `TripAccess` that `PATCH`/`DELETE …/members/:userId` answer with fill
    it via `accessRevForRead` (`server/access/members.ts`). It is read **before** the members
    and invites, so it is never newer than the list it is served with.
  - `TripProvider`'s `adoptAccess` takes it as seen on every read it adopts. A first poll whose
    rev differs then re-reads, and a local write's re-read re-baselines.
  - The first-poll baseline stays only as a fallback, for a read with no rev (the demo trip, or
    a failed rev read).
  - `e2e/travellers.spec.ts` no longer waits for the owner's first poll before Join.
- **Proof:**
  - Reproduced first. With the e2e wait removed and the provider unchanged, a ci-like run failed
    as this entry describes, at `travellers.spec.ts:137`: `expect(locator).toBeVisible() failed`
    for `getByRole('list', { name: 'Not travelling · 1' })…traveller-dev-advisor…`, after
    `Timeout: 15000ms`.
  - `TripProvider.test.tsx` › "re-reads when the first poll's revision differs from the one the
    load read": the load reads "1" and the first poll reports "2". On the unfixed provider it
    failed with `Expected: "editor" Received: "owner"`. It failed the same way with the seeding
    line in `adoptAccess` commented out, and passes with it restored.
  - `TripProvider.test.tsx` › "takes a local write's re-read revision as seen…": went red with
    that line out (`expected "vi.fn()" to be called 2 times, but got 3 times`).
  - `access/route.int.test.ts` › "carries the access revision the poll reports…": went red with
    `accessRev` dropped from the route's response (`expected undefined to be '0'`). The members
    route's PATCH test also asserts the field.
  - After the fix, `pnpm --filter web test:e2e:ci-like e2e/travellers.spec.ts --project=desktop
    --retries=0` passed twice in a row, without the wait (`2 passed (12.3s)`, `2 passed (12.2s)`).
  - `pnpm check` (contracts changed, so not narrowed) exited 0. The web unit lane passed 359
    files / 4883 tests and the int lane 105 files / 1362 tests.
