### KI-5 — Optimistic commands can be silently lost on abrupt navigation before the send queue drains
- **Severity:** correctness (data loss, no error surfaced)
- **Area:** `apps/web/src/components/trip/context/TripProvider.tsx` /
  `optimistic.ts` (M6's optimistic-update overlay + sequential send queue)
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
  | Navigating away / reloading / closing the tab with work queued | **Open — this entry.** The queue is in memory and nothing persists it. |
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
