### KI-5 — Optimistic commands can be silently lost on abrupt navigation before the send queue drains — NARROWED 2026-09-25 (race windows only; see the last section)
- **Severity:** correctness (data loss, no error surfaced)
- **Area:** `apps/web/src/components/trip/context/TripProvider.tsx` /
  `optimistic.ts` (M6's optimistic-update overlay + sequential send queue);
  since 2026-09-25 also `unloadFlush.ts` beside them
- **Symptom:** every trip-mutating command now applies to the UI instantly
  (client-side prediction) while the real persist happens in the background,
  one command at a time. If the user (or a script) fires several commands in
  quick succession and then navigates away, reloads, or closes the tab
  **before the queue has drained**, every command still queued behind the one
  currently in flight is silently dropped from the server's event log — with
  no error, no warning, and no visual difference from a fully-persisted state
  (the UI already showed everything as "done"). Root-caused by reproducing a
  CI-only e2e failure (`m2-history.spec.ts`, initially misdiagnosed as a
  narrower pre-existing reload/in-flight-request race — see below): throttling
  the commands endpoint by 400ms and replaying the spec's rapid drag+dismiss
  sequence deterministically reproduced the loss — after `page.reload()`, the
  persisted history contained **only the very first command** of six; the
  other five (two `AddActivity`, two `MoveActivity`, one `DismissConflict`)
  never reached the server at all.
- **Not a data-integrity violation of the event log itself** (Invariant 1
  holds — nothing partially-written, nothing corrupted; commands that never
  arrive simply never get an event) but is a real UX/correctness gap: the
  optimistic overlay gives no user-visible signal that unconfirmed work exists
  before a destructive-to-in-memory-state action (navigation, reload, tab
  close), unlike e.g. a native app's "unsaved changes" prompt.
- **The e2e test symptom is fixed** in this same change
  (`apps/web/e2e/m2-history.spec.ts` now waits for each mutating action's
  confirming response before proceeding, matching the pattern already used in
  `m6-optimistic.spec.ts`), so the CI flake itself is resolved. This entry
  tracks the underlying **product** risk, which is not fixed.
- **Fix path (not yet built; Mitchell's direction, 2026-07-20):** favor a
  synced/caught-up UI indicator over blocking navigation — surface `pending`
  (already exposed on `useTrip()`) as a visible "syncing…" / "all changes
  saved" affordance so the user can SEE when it's safe to navigate away,
  rather than a `beforeunload` prompt or forced queue flush. Worth deciding
  alongside M13 (collaboration), where concurrent multi-actor writes make
  silent client-side loss more consequential.
- **M8 (Task C4) landed the first half of the fix path:** `TripHeader` now
  renders a `SyncIndicator` (`role="status"`, "Saving…" / "All changes
  saved") fed from `useTrip().pending`, so unconfirmed work is visible before
  the user navigates away. Deliberately no `beforeunload` guard — that was
  never the recorded direction. **The underlying silent-drop-on-navigation
  risk is still open**: the indicator makes the risk visible, it doesn't
  close it, and it remains real for anyone who navigates away without
  reading it. Revisit alongside M13, where concurrent multi-actor writes
  make the silent loss more consequential.
- **This entry is the hub for one queue with several triggers. Trigger ledger, reconciled 2026-08-28** — read it before describing any of these as live:
  | Trigger | State |
  |---|---|
  | Navigating away / reloading / closing the tab with work queued | **Narrowed 2026-09-25.** Everything the sender had not yet sent is flushed as one keepalive batch on `pagehide` and on provider unmount. What is still open is the race windows listed in the last section. |
  | A send that *resolves* failed (`failHead` emptied the queue) | **Resolved 2026-08-25** — KI-36. The queue is retained and a manual retry is offered. |
  | `confirmHead` dropping units that no longer re-predict on a *successful* send | **Resolved 2026-08-28** — KI-42 (PR #73). |
  | A send that *rejects* (offline, DNS) wedging the sender for the life of the page | **Resolved 2026-08-28.** All 24 fetching helpers in `apiClient.ts` are total, the sender's `inFlight` reset moved into a `finally`, and a throw is converted into the `{ok:false}` the retry machinery already handles. |
  | `applyOutcome` clearing a non-empty queue from an ungated caller — inserting a saved day, asking the assistant | **Resolved 2026-08-28** by both callers gating their own affordance; **the precondition itself is gone as of 2026-09-22 (M13 link 3)**. `applyOutcome` now re-predicts the queue onto the outcome (`adoptOutcome`) instead of clearing it, so an ungated third caller no longer costs the user unsent work. The callers still gate, because being told why a control is unavailable beats watching it do something subtler than expected — but that is now a UX choice, not the only thing standing between a caller and data loss. |
  | A history command dispatched in the same tick as an accepted enqueue | **Resolved** — KI-70 (the guard reads `optimisticRef.current`). |
  | A unit enqueued WHILE an undo/redo/revert is in flight | **Resolved 2026-09-22 — KI-90** (M13 link 3). The reconcile re-predicts the queue onto the authoritative outcome rather than clearing it, so the window the pre-send guard cannot reach no longer loses anything. |
  | A unit queued after a KI-42 retention previewing over a base that skips the retained work | **Open — KI-55**, and no work is lost: the preview is wrong, the queue is not. |
- **What is left of the original framing, restated 2026-09-22:** **one** open trigger — this entry's own, abrupt navigation with work queued — plus one preview-only inaccuracy (KI-55). The same-tick race (KI-70) and the in-flight window (KI-90) are both closed, and the `applyOutcome` precondition is gone rather than merely observed. So "the optimistic queue loses work on N different triggers" is now **one persistence gap**: the queue lives in memory and nothing persists it. That one is not a reducer problem and no reducer will close it — it needs a `pagehide`/`keepalive` mitigation, which the 2026-09-05 review confirmed does not exist anywhere in `apps/web/src`.
  *(The previous wording — "two open triggers (this one and KI-70)" — was already stale when it was written against the ledger above, which had KI-70 as open; KI-70 is recorded as resolved in its own file.)*
- **First noted:** 2026-07-20 (M6, post-merge CI investigation).
- **2026-09-05 overnight review — the guard this family has never had ([F-E02](../../reviews/2026-09-05-overnight-review/findings/F-E02-optimistic-queue-needs-interleaving-property.md)):**
  KI-5, 36, 42, 55, 70, 90 and the 2026-08-28 review's §1.1/§1.4 are one
  sentence — "an accepted unit vanished with no failure record" — and every one
  was fixed as a line, with the next window opening beside it.
  `optimistic.test.ts` uses `fast-check` zero times while ten other test
  files do. A single interleaving property would have caught KI-42, 55, 70 and
  90 at once. Filed as KI-2026-09-05-p. This entry's own trigger (abrupt
  navigation) is still the one the property cannot reach — it needs a
  `pagehide`/`keepalive` mitigation, which the review confirms does not exist
  anywhere in `apps/web/src`.
- **Narrowed 2026-09-25 (overnight KI sweep): the queue is flushed when the page or the provider goes.**
  - **Reproduced first**, with the entry's own method, as `apps/web/e2e/m6-unload-flush.spec.ts`: responses from `/api/trips/*/commands` delayed 400ms, "Add a day" clicked four times (board shows +4), reload, then the server's `GET /api/trips/:id` polled. Before the fix, via `pnpm --filter web test:e2e:ci-like e2e/m6-unload-flush.spec.ts`: `Expected: 4 / Received: 1`, on both attempts — the first unit and nothing behind it, exactly the symptom above. (Holding the *request* inside Playwright instead gave `Received: 0`: the unit in flight is cancelled by the reload before it was ever sent. No real network holds a request that small, which is why the spec delays the response.)
  - **Fix.** `TripProvider` now tracks, by unit id, what its sender has put on the wire (`sentIds`). On `pagehide`, and in the cleanup that runs when the provider unmounts (an in-app navigation away from the trip, which fires no `pagehide` and used to strand the queue just as surely), every queued unit NOT in that set is sent as ONE batch to the existing `/commands/batch` endpoint with `fetch(..., { keepalive: true })` (`sendTripCommandBatch` grew a `keepalive` option). The flushed units are handed off: the sender will not send them too. If the page survives (back/forward cache), the flush's answer reconciles — applied units leave the queue and the trip is re-read; a refused flush hands its units back to the sender, which sends them one at a time under KI-36's rules. `unloadFlush.ts` decides the body: the batch endpoint is atomic and decides in order, so one batch cannot half-apply or reorder the queue it carries; a keepalive body over the browser's 64 KiB limit is refused outright, so an unloading page sends the longest **prefix** of whole units that fits in 48 KiB (the rest of the quota is left for the notebook's own `pagehide` save) and never skips a unit to fit a later one.
  - **Proof.** The same spec after the fix: `2 passed` (setup + the spec) through `pnpm --filter web test:e2e:ci-like e2e/m6-unload-flush.spec.ts`; then red again with only the flush disabled (`Expected: 4 / Received: 1`), and green once restored — the final run, `test:e2e:ci-like e2e/m6-unload-flush.spec.ts e2e/m6-optimistic.spec.ts`, `4 passed`. Five provider tests in `TripProvider.test.tsx` ("unload flush (KI-5)") and five in `unloadFlush.test.ts`, each seen red for its own reason by breaking the line it protects: no `pagehide` listener → `expected "vi.fn()" to be called 1 times, but got 0 times`; the in-flight unit not excluded → `expected "vi.fn()" to be called with arguments: [ 'x', …(2) ]`; no hand-off gate in the sender → `expected "vi.fn()" to be called 1 times, but got 3 times`; no failure gate → `expected "vi.fn()" to not be called at all, but actually been called 1 times`; prefix that skips → `expected [ 'a', 'b' ] to deeply equal [ 'a' ]`. Checks: `pnpm --filter web typecheck`, `pnpm --filter web lint`, the docstring/sleep/lint/loading walls, and `vitest run -c vitest.unit.config.ts` over `src/components/trip/context`, `src/lib/apiClient.test.ts` and `src/components/playbooks` (505 tests), all green.
  - **Decision (2026-09-25 overnight sweep):** flush only units the sender has NOT sent, as one keepalive batch through the existing endpoint, with no `beforeunload` prompt and nothing that delays leaving (Mitchell, 2026-07-20). Rejected: *including the unit in flight* — the batch endpoint has no idempotency key, and if that unit had already reached the server it would be applied twice (a `MoveActivity` re-decided after a later move of the same stop is not a no-op); *one keepalive request per unit* — requests from a dying page race, and ordered edits applied out of order persist a trip nobody made; *an `expectedSeq` precondition on the flush* — the right one is "the in-flight unit's events have landed", and the client cannot know that unit's event count, so any seq it could name either refuses the common case or admits a double apply; *flushing a queue KI-36 has marked failed* — nothing re-sends a refused change without the user asking, and leaving is not asking; *also flushing on `visibilitychange` → hidden*, as `useEditSession` does — the page is still alive there, and the queue would then need a full two-owner reconcile on every tab switch. Cost accepted: the flushed units land as ONE history entry, so they undo together.
  - **What is still open — the whole remaining window.** Each of these is a loss the user is still not told about, because the page that could say so is gone:
    1. **The flush overlaps the unit in flight.** If `pagehide` comes while that unit's server transaction is still open, both append at the same seq and the event store's unique-seq check refuses one of them whole — normally the flush, so the flushed units are lost. Nothing is applied twice or half-applied. A server-side retry of the batch on an append conflict (with no caller `expectedSeq` it is semantically the same as the request arriving a moment later) would close most of this; it is outside this entry's Area and was not made.
    2. **The flush overtakes the unit in flight** — that unit never reached the server (a fetch started but not yet transmitted when the page died), or its transaction read the stream after the flush committed. The flushed units are then decided without it: refused whole if they depend on it, otherwise persisted *without* it, which is not a prefix of what the user did. Closing 1 and 2 properly needs a client-supplied idempotency key per unit so the flush can carry the in-flight unit too and the server can skip it if it already landed — a change to both command routes, not made here.
    3. **A queue KI-36 has marked failed** is not flushed (decision above).
    4. **Units beyond the 48 KiB keepalive budget** on an unloading page are not sent. Board commands are a few hundred bytes, so this takes an unusually long queue.
    5. **A mobile tab killed in the background without a `pagehide`** (mobile Safari does this; `useEditSession` notes it) sends nothing.
  - **Adjacent, not fixed:** units flushed on an in-app navigation are persisted after the provider has gone, so a return to the trip can read the board before they land — that is KI-2026-09-14-e's stale board, now reachable for these units where before they were simply lost. The data is right; the board is behind until a re-read.
