# ADR-060: A stop's price is per person; who is going multiplies it, and Booked by pays

**Status:** **Accepted — 2026-10-02, Mitchell's decisions, in chat** (four answers to the
M19 kickoff questions; the consequences in *Decision* 2-7 are drafted from them and
stated for review).
**Deciders:** Mitchell (product/eng); Claude — drafted
Related: **ADR-008** (one currency per trip), **ADR-054** (three kinds), M13 link 5
(`bookedBy`, `participants`), invariants 1, 2 and 5. Milestone:
`docs/milestones/M19-cost-model.md`.

## Context

A stop's cost is one optional `Money`. Nothing says whether that is the whole bill or one
person's share. Every total in the app sums the prices as entered, and `savedDayFacts`
carried an unwritten assumption that a price was already per head (M19 §1). M13 has since
given every stop `participants` (who is going) and `bookedBy` (who booked it). Splitting a
cost needs both of those plus an answer to what a price means.

Mitchell, 2026-10-02, asked four questions at M19's kickoff:

| Question | Answer |
|---|---|
| What does a typed price mean? | **Always per person** |
| Settled vs estimate | **Derive from kind**, no new field |
| How a cost is divided | **Even across who is in, and Booked by pays** |
| Delivery | **Stacked PRs** |

## Decision

1. **A stop's `cost` is the price for one person.** The contract does not change shape:
   `Money` stays `{ amountMinor, currency }`. What changes is what every reader does with it.
2. **A stop's headcount is the number of distinct ids in `participants`, or the trip's member count when nobody is
   picked.** "Nobody picked" means everyone, which is what the editor's *Who is in* already
   implies. **A stop's total is `cost × headcount`.** Day subtotals, the backlog subtotal,
   the trip total and `budgetRemaining` all sum stop totals. A solo trip reads exactly as
   before.
   **Every member counts, viewers included** (Mitchell, 2026-10-02, after #289's preview
   walk showed a view-only invite raising every unpicked stop). A viewer who is not going
   is excluded by picking *Who is in* on the stops they are not part of.
   **Amended by ADR-065 (2026-10-05): empty = all *travellers*.** Who is travelling is Access
   data, counted at read time, and a member who is not travelling counts only where picked.
3. **One pure function computes it, in `packages/contracts`** (`costs.ts`: `stopHeadcount`,
   `stopTotal`, `isCommittedCost`). The domain, the web helpers and every `@tc/pages` cost
   widget call it. A second copy is the drift invariant 5 forbids.
4. **The totals are computed when the trip is read, not stored as truth.** The member count
   is Access & Membership data. It is not in the planning log, so a projection that baked it
   in would go stale when someone joins. The server already overlays `effectiveMembers` onto
   `TripDetail` when it reads it (`trip-access.ts`). It recomputes the cost fields in the same
   overlay through the same pure function, so adding a member changes the total without any
   event. The stored projection keeps computing them from the log's own members, which keeps
   rebuild equal to stored (invariant 2).
5. **Committed vs estimate is the stop's kind.** A `pending` stop's cost is an estimate. A
   `planned` or `transit` stop's cost is committed. There is no new field, and *free vs
   unknown* (KI-82) is **not** solved by this ADR.
6. **Booked by pays.** For each stop, every person in it owes `cost` to the stop's `bookedBy`.
   A stop with no `bookedBy` is **not paid yet**: its people owe the trip, not a person. A
   person's balance is what they paid for others minus what they owe others, so the payer's
   own share cancels. This is a model of who owes what. It moves no money (M19 *Explicitly not
   here*).
7. **A saved day's price stays per person.** `SavedStop` carries no people, so a day's sum is
   already what it costs each. The shared-day rail and Discover's band say *each*, as SPEC §15
   draws them.

## Consequences

- **Existing multi-member trips change their totals.** A price entered on a shared trip
  before today is now multiplied by its headcount. That is the intended reading ("always per
  person"). There is no migration, because no stored value changes.
- **A per-person price is wrong for a shared room or a taxi.** Mitchell chose that, knowing
  it. The editor states *per person* beside the Cost input and shows the stop total, so the
  multiplication is visible where the price is typed.
- **The trip budget stays one number for the whole group.** A per-person budget is still out
  of scope.
- **The assistant prices per person.** Its write tools and their descriptions say so.
