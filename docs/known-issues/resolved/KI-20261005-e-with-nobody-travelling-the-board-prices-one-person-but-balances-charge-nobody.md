### KI-2026-10-05-e — with nobody travelling, the board prices one person but "who owes what" charges nobody — RESOLVED

- **Severity:** correctness, low reach. Two money surfaces disagree, but only on a trip where every
  member, owner included, is marked not travelling.
- **Area:** `packages/contracts/src/costs.ts`: `stopHeadcount` (`Math.max(travellerCount, 1)`),
  `stopPeople` (returns `travellerIds`, which is empty) and `balances`. Callers include the
  `balances` / `person.share` widgets in `packages/pages`.
- **Symptom / What happens:** take a stop nobody is picked for, on a trip with zero travellers.
  Its total is `cost × 1` (D5's floor), so the board, the budget and the trip total all include
  it. `balances` gives it no people. No share is owed for it, and if it has a `bookedBy`, that
  person is credited a total nobody owes. The People section says "Nobody is marked as
  travelling, so costs are priced for one person." The balances widget does not say who that
  one person is.
- **Why not fixed here:** this is the travellers spec's W4, recorded as open and low stakes
  during the build. The fix is a product choice, not a mechanical one. Either charge the floor's
  one share to the owner, which makes `stopPeople` return `[owner]` when there are no
  travellers, or price zero travellers at zero and drop D5's floor. Both change an approved
  decision, so the choice is Mitchell's.
- **Assistant side: covered.** `read_trip`'s description says a stop nobody is picked for is
  priced for at least one person when nobody is travelling, and every `read_day` stop carries
  its `headcount` (1 here, not 0). So `travellers: 0` no longer leaves the model to call the
  trip free. The balances disagreement above is unchanged.
- **Cross-reference:** ADR-065 (*Consequences*), ADR-060 decision 6, spec D5 and W4.
- **First noted:** 2026-10-05, travellers spec T1 (W4), filed at T9.
- **Resolved:** 2026-10-25, Mitchell's decision: a stop nobody is travelling for is priced at
  **zero**, superseding D5's one-person floor, on his condition that travelling is **opt-out**.
  `stopHeadcount` no longer floors at 1, so with no traveller a stop nobody picked has headcount
  0 and `stopTotal` 0, which is what `balances` already charged for it. The one default that was
  not travelling, the invite preset by role (D3: suggester and viewer off), now presets
  travelling for every role, in `createInvite` and in the invite dialog. The owner, a direct
  grant, existing members (D2) and guests already defaulted to travelling, and
  `travellers.int.test.ts` now pins the owner and a direct grant too. Copy, `read_trip`'s
  description and the invite preview (which had carried its total on the floor) follow.
  Recorded as dated notes on ADR-060 decision 2, ADR-065 decisions 3 and 4 and *Consequences*,
  spec D3, D5, W4 and W14, and in `docs/contracts/CHANGELOG.md`. **Proof:** the
  `balances` property in `packages/contracts/test/costs.test.ts` now draws any subset of
  travellers, none included, and failed on the floor with `expected +0 to be 1` (shares 0,
  `stopTotal` 1). A concrete case failed with `expected 3000 to be +0`. A `@tc/pages` case
  (`cost` and `cost.balances` with nobody travelling) failed on the floor with `expected 'ok' to
  be 'empty'`. All three pass with the floor gone.
