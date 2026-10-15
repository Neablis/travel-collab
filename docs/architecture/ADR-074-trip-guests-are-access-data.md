# ADR-074: Named guests are Access data — `trip_guests`, counted at read time

**Status:** **Accepted — 2026-10-15.** Mitchell approved the design (his ask, the family-of-three
example below).
**Deciders:** Mitchell (product); Claude — drafted
Related: **ADR-065** (who is travelling is Access data, counted at read time; D1, D4, D6, D7),
**ADR-026** (membership is Access CRUD), **ADR-003** (the history substrate is scoped to
planning), **ADR-060** (a price is per person). Source: the candidate *"Travellers who are not on
the app count toward per-person cost"* (asked 2026-10-10).

## Context

Mitchell: *"set people going on trip (we kinda have that now with those invited) but also add
people who arent in the app who are going on trip so you can get the per person trip price
correct"*. His example: a family of three, husband, wife, and a baby. The husband and wife both
edit the trip; the baby has no account but is still coming, and per-person cost has to know there
are three people.

ADR-065 made travelling a per-person Access attribute on `trip_travellers(trip_id, user_id, …)`,
counted at read time. But every traveller is a member with an account: a trip could count only the
people who had been invited and accepted. A named person with no account had nowhere to live.

## Decision

1. **A guest is Access data, not a planning event** (ADR-065 D1, extended). Guests live in their
   own CRUD table, `trip_guests(trip_id, guest_id, name, travelling, linked_user_id, created_by,
   created_at)` (migration `0053`, `server/access/guests.ts`), served at 1.18.0 by
   `GET`/`POST /v1/trips/:tripId/guests`, `PATCH`/`DELETE …/:guestId`, and
   `POST …/:guestId/link` / `…/unlink`. It is **not** a nullable `user_id` on `trip_travellers`:
   that table's contract is per-member rows, a missing row means travelling (D2), the owner has
   no row there at all, and a guest is not a member with a missing account. A nullable foreign
   key would have punched a hole in every "one row per member" assumption to save one table.
2. **Guest ids are `guest_<uuid>` strings.** `users.id` is opaque text, often a UUID, and guest
   ids drop into person-keyed fields (`participants` picks, the cost overlay), so the prefix
   makes the two namespaces disjoint by construction. A guest id can never collide with a user
   id, and a reader can tell which is which without a lookup.
3. **A linked guest IS the user** (`linked_user_id`, nullable). Linking resolves the record to
   that member everywhere, one headcount, never two (`travellerIds` emits the linked id,
   deduped, and two guests linked to the same user still count once), and picks of the guest id
   carry over to the user. **Link: the owner for anyone, any other member for themselves only**
   (self-claim is identity, not content, a viewer may claim their own record). **Unlink: the
   owner only**, unclaiming takes an identity away, a membership operation, not content.
4. **Guests get balance lines: share owed, paid 0.** A guest is in for their share of the stops
   they are part of and has paid nothing. The app does not settle, Mitchell's call, so a
   guest's line reads what they owe and nothing more. Guests are never "Booked by": they are
   cost centers, not payers. ADR-065 D7 stands: any *member*, travelling or not, may be Booked
   by.
5. **Editors and up manage guests** (add, rename, toggle travelling, remove), `mayManageGuests`:
   a guest is trip content, *who is coming*, not a membership grant. Viewers are read-only;
   suggesters suggest. A guest defaults to travelling: adding a guest who is not coming is a
   contradiction. The explicit-pick rule stands (D6): a picked non-traveller still counts on
   that stop.
6. **Every headcount that counts travellers counts `travellerIds(members, guests)`.** The
   overlay's recost (board totals and every notebook cost widget reading the overlaid detail),
   shares, the public API, the assistant's reads, the board's pickers, the notebook's person
   picker, `WidgetContext.guests`, and the assistant's `get_widget` people list. One reading,
   in `packages/contracts` (invariant 5), no second copy.

## Consequences

- **The baby counts.** A trip with two accounts and one guest prices per-person totals for
  three. Zero extra invites, zero accounts.
- **History stays silent about guests** (ADR-065's price, paid again). Adding "Baby" is an
  Access write, not a planning event: no History entry, no undo, no replay. The People section
  is where guests are seen.
- **Guest writes ride `accessRev`.** Every guest write bumps the same per-trip counter ADR-065
  D11 added, so the board, the Who-is-in picker and the notebook widgets re-read on the events
  poll, no new transport, no new staleness.
- **A removed guest is gone from the lists but not from the log.** A stop that named them keeps
  the id (the read path keeps departed ids, and `stopHeadcount` still prices them); pickers
  label them by the last name they saw, else "Former member".
- **One known exception.** `cost.balances` and `person.share` resolve guest *names* (Part 2)
  but still compute their nobody-picked headcount over `travellerIds(trip.members)`, members
  only, so a notebook's balances can divide by fewer people than the board does. Left
  member-only in Part 2; a follow-up, not this decision.
