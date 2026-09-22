### KI-90 — The same history reconcile still clears a queue that fills while the command is IN FLIGHT — RESOLVED
- **Severity:** correctness (silent loss of one or more user edits — the KI-5 family; the half of KI-70 its one-line fix does not reach)
- **Area:** `apps/web/src/components/trip/context/TripProvider.tsx` (`dispatch`'s `HISTORY_TYPES` branch, after the `await`)
- **Symptom:** the branch now guards correctly on `optimisticRef.current` before sending (KI-70, resolved), but the send is awaited and the reconcile that follows is unconditional: `setOptimistic((prev) => (prev ? { confirmed: result.value, pending: [] } : prev))`. Nothing stops the user editing during that round trip — `runDispatch` has no gate of its own — so any unit enqueued while the undo/redo/revert is in flight is discarded by `pending: []` when it lands. Same loss, same line, a window measured in network latency rather than in one React tick.
- **Why it is filed rather than fixed:** unlike KI-70's guard, this one has no obviously right answer. The queued units were predicted against a state the server has since replaced, so keeping them means re-predicting against the authoritative outcome — which is `confirmHead`'s job and `confirmHead` drops the head, so it does not fit — and the honest alternatives (refuse the reconcile, or disable editing for the duration of a history command) are both product decisions about a control that is currently instantaneous-feeling. Widening `confirmHead` into a general "adopt this outcome, re-predict what is queued" reducer is the shape that would fix KI-77, KI-5's `applyOutcome` precondition and this at once, and that is a design pass, not a line.
- **Found by:** the M11-fallout KI cluster, 2026-08-29, while fixing KI-70 — reading the branch it was fixing. Not fixed there under that PR's own "report a seventh problem, do not fix it" rule.
- **A second, much milder site of the same stale read:** `enter` (the history *preview*) still tests the render-time `pending`, so a preview can be entered in the same tick as an enqueue. Nothing is lost when it happens — `enter` only sets `previewSeq`/`previewTrip` and `exit` restores — so it is noted here rather than filed on its own.
- **Cross-reference:** KI-70 (resolved — the same-tick half), KI-5 (the hub entry for this loss class), KI-36 (resolved).
- **First noted:** 2026-08-29.

- **Numbering:** filed as 77 on 2026-08-29, when several sibling branches each filed a different KI-77/78 the same night. Renumbered to 90 on merge. Nothing outside this file references it.
- **2026-09-05 overnight review ([F-E02](../../reviews/2026-09-05-overnight-review/findings/F-E02-optimistic-queue-needs-interleaving-property.md)):**
  re-confirmed live at `TripProvider.tsx:315` (`await sendTripCommand`) then
  `:322` (unconditional `setOptimistic(… pending: [] …)`) — literally the
  KI-70 line again, after the `await`. The review's recommendation is to stop
  fixing this family a line at a time and add the interleaving property
  (KI-2026-09-05-p), which also forces the one product decision this entry
  defers: gate edits during a history command, or re-predict the queue on top
  of the reconciled state.

- **RESOLVED 2026-09-22 (M13 link 3).** The fix is the shape this entry named
  and declined to build: `confirmHead` was widened into a general *"adopt this
  outcome, re-predict what is queued"* reducer. The two halves are now
  `confirmHead` (the outcome answers the unit at the head, so the head is
  consumed) and **`adoptOutcome`** (the outcome came from somewhere the queue
  did not produce, so nothing is consumed), sharing one `rePredictOnto` body —
  so KI-42's retention rule and KI-55's suffix rule are inherited rather than
  re-implemented. Both `{ confirmed: X, pending: [] }` sites now call it:
  `dispatch`'s history branch and `applyOutcome`.
- **The product decision this entry deferred was not taken, and did not need to
  be.** It framed the choice as "refuse the reconcile, or disable editing for
  the duration" — both product calls about an instantaneous-feeling control.
  Re-predicting is a third option that costs neither: the reconcile stops being
  lossy, so there is no window left to guard. The pre-send guard
  (`pending.length > 0` → return) is KEPT, but it is now a product rule rather
  than a correctness one, and `TripProvider.tsx` says so at the line. Whether a
  history command *should* start while work is queued — and whether that silent
  `return` should say something — is still open and is still a decision.
- **`failure` is preserved by `adoptOutcome` and dropped by `confirmHead`**, which
  is not symmetry worth having: a successful send clears the failed state, but
  here the queue is retained in full, so dropping the failure would unlatch the
  sender's gate and re-fire a head the server already rejected. `failHead`'s own
  note measured 41 sends of one command in 300ms the last time that gate was
  missing. There is a test for it.
- **Proof.** Reproduction: `TripProvider.test.tsx`, *"$type with an edit queued
  while it is IN FLIGHT (KI-90)"* — `describe.each` over all three
  `HISTORY_TYPES`, as KI-70's sibling suite does, because the branch is keyed on
  set membership and a regression reachable through Redo but not Undo would
  otherwise pass. The history send is held open, the edit is dispatched into
  that window, then the send is settled with a **different** trip from the one
  the edit was predicted against — so the assertion (three days) proves the unit
  was RE-PREDICTED onto the new base, not merely preserved with a stale
  prediction. Restoring `{ confirmed: result.value, pending: [] }` fails all six
  with `expected '2' to be '3'`: the edit eaten, exactly this entry's symptom.
  The `applyOutcome` site has its own reproduction (KI-5's ledger row), which
  fails the same way on the same revert.
  Reducer-level tests in `optimistic.test.ts`; reverting the failure-preservation
  gives `expected undefined to deeply equal { at, message }`, and making
  `adoptOutcome` consume the head gives `expected [ 'u2' ] to deeply equal
  [ 'u1', 'u2' ]`.
  Checks: unit lane green (93 in `components/trip/context`), `pnpm typecheck`
  and `pnpm lint` clean, integration lane 809/809.
- **The second, milder site named above is NOT closed**: `enter` (the history
  preview) still reads a render-time `pending`. Nothing is lost when it races —
  `enter` only sets `previewSeq`/`previewTrip` — which is why this entry noted
  it rather than filing it, and why it is recorded here rather than silently
  inherited by whoever reads this as fully closed.
- **A numbering correction, because three files repeated it.** This entry's
  *"would fix KI-77, KI-5's `applyOutcome` precondition and this at once"* is a
  **stale self-reference**: the Numbering note above records that this entry was
  *filed as 77* and renumbered to 90 on merge. The only KI-77 that exists is
  `resolved/KI-077-geocoder-name-check-rejects-three-correct.md`, a geocoder
  tokenisation bug with no relationship to the optimistic queue. So link 3 closes
  **two** things, not three — this entry and KI-5's `applyOutcome` precondition.
  `M13-collaboration.md`, `TODO.md` and `ADR-049` all carried the third number
  and have been corrected. The note's own *"Nothing outside this file references
  it"* had stopped being true.
