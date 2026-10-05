### KI-2026-10-05-d — with nobody travelling, the board prices one person but "who owes what" charges nobody

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
- **Cross-reference:** ADR-065 (*Consequences*), ADR-060 decision 6, spec D5 and W4.
- **First noted:** 2026-10-05, travellers spec T1 (W4), filed at T9.
