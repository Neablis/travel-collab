### KI-2026-09-08-a — `NewTripWizard`'s retry is permanently stuck: it re-sends dates that are now a no-op, and reports that as the failure — RESOLVED

- **Severity:** correctness (a live, user-facing dead end — the wizard's own "Try again" cannot succeed, and the error it shows names the wrong command)
- **Area:** `apps/web/src/components/home/NewTripWizard.tsx:186-232` (the create → dates → budget → currency sequence and its `createdTripId` latch); `packages/domain/src/trip/decide.ts:202` (`SetTripDates` returns through `okUnlessNoOp`), `:23-30` (`okUnlessNoOp` itself)
- **Symptom / What happens:** the wizard issues four calls in sequence — `createTrip`, then `SetTripDates`, `SetTripBudget`, `SetTripCurrency` — and each failure stops with an inline *"Trip created, but setting X failed: … Try again."* Only the **trip id** is latched (`createdTripId`, `:186-196`), so a retry correctly avoids minting a second trip but **re-sends `SetTripDates` with identical values**. The domain answers that through `okUnlessNoOp`, which rejects an event set that changes nothing:

  > `Trip created, but setting dates failed: This change would have no effect. Try again.`

  So a transient failure on **budget or currency** — the two commands that run *after* dates — converts into a permanent one. Every subsequent retry fails at step 2, the real failure at step 3 or 4 is never reached again, and the message blames dates, which had in fact already succeeded. The only way out is to abandon the wizard; the trip exists, named and dated, with no budget.
- **Why the latch alone is not the fix:** the latch answers "don't create a second trip". It does not answer "don't re-send a command that already landed". Those are two different pieces of state, and the second one is what a multi-command sequence needs.
- **The shape of the fix, already built next door:** `AddToTripDialog` hit the identical trap on 2026-09-08 and latches `{ tripId, datedAs }` rather than `tripId` alone — step 2 is skipped when the date already applied equals the one in the field, and re-sent when the user changes it. The same widening applies here, per applied command (dates / budget / currency). See `apps/web/src/components/playbooks/AddToTripDialog.tsx` and its tests in `SharedDayScreen.test.tsx` ("starting a new trip from a shared day").
- **Why it was not fixed here:** found in passing while building the shared-day → new-trip branch, which is a different component and a different milestone's scope. Fixing the wizard is a self-contained change with its own tests and did not belong in that diff.
- **Reachability:** live, not latent — it needs only a transient failure (offline, a 500, a dropped connection) on the budget or currency call, both of which the wizard sends for any user who fills those fields. Not reproduced at runtime; established by reading the two call sites above, and the no-op rejection is the same one asserted for `AddToTripDialog` in `SharedDayScreen.test.tsx`.
- **Cross-reference:** KI-92 (a different `SetTripDates` defect — calendrically impossible dates — and not this one); ADR-013 (why these are separate commands rather than one batch).
- **First noted:** 2026-09-08, by the implementer of the shared-day → new-trip branch.
- **Fix:** applied exactly the widening this entry proposed, in the wizard only —
  `apps/web/src/components/home/NewTripWizard.tsx`'s `createdTripId: string | null` latch
  became `progress: { tripId, datedAs, budgetAppliedAs, currencyAppliedAs } | null`, mirroring
  `AddToTripDialog`'s `{ tripId, datedAs }`. Each of the three post-create commands now
  compares the value it's about to send against what's already latched (`datedAs` by
  `startDate`/`endDate`, `budgetAppliedAs` by `amountMinor`/`currency`, `currencyAppliedAs` by
  the code itself) and skips the dispatch — and the `setProgress` update that would move the
  latch forward — when they already match, so a changed value before retrying still re-sends.
  `okUnlessNoOp` and `decide.ts` were not touched — the fix is entirely in the wizard's own
  retry sequencing, as the entry's "shape of the fix" suggested and the sweep constraints
  required.
- **Proof:** reproduced first with a new test, `NewTripWizard.test.tsx` ("retrying after dates
  succeeded but budget failed does not re-send dates"), whose `dispatch` stub enforces the same
  no-op rule `okUnlessNoOp` enforces for real (a repeat `SetTripDates` with identical
  `startDate`/`endDate` is rejected). Against the pre-fix code it timed out waiting for
  `SetTripBudget` ever to be dispatched, printing only a single repeated `SetTripDates` call:
  `expected "vi.fn()" to be called with arguments: [ObjectContaining{"type": "SetTripBudget"}] … Number of calls: 1` (the one call being `SetTripDates`, not `SetTripBudget`) — exactly the
  dead end this entry describes, reached from a real (simulated) transient budget failure
  rather than by inspection. After the fix, the same test passes: the retry skips the
  already-applied `SetTripDates` and reaches `SetTripBudget`. Full file:
  `pnpm --filter web exec vitest run -c vitest.unit.config.ts src/components/home/NewTripWizard.test.tsx`
  → 11/11 passed (10 pre-existing + the new regression test). `pnpm --filter web typecheck`
  and `pnpm --filter web lint` both clean.
