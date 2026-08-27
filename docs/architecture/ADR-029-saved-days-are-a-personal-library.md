# ADR-029 — A saved day is a personal, private, dateless fragment

**Status:** Proposed (M11 link 6, 2026-08-27). Open to reversal.

**Depends on:** ADR-003 (event sourcing is scoped to planning), ADR-025
(users), ADR-026 (roles at the seam), ADR-028 (lineage, and who may clone).

## Context

M11's fourth user story: *"Select parts of my trip and save them for reuse."*
The design handoff calls it "Keep this day": a pennant on a day in Timeline
opens a dialog, and the kept day can later be dropped into another trip
("Add a saved day", "the times reflow to fit").

Three shells stood for it — `keep-day-flag`, `keep-day-dialog`,
`add-saved-day` — and this link retires all three.

## Decision 1 — the library is CRUD, owned by a person

One table, `saved_days`, keyed on `owner_id`, with `stops` as a jsonb array.
Not event-sourced: a saved day is not planning state, because it does not
belong to a trip. ADR-003 scopes the log to planning, and this is the same
boundary Identity and Access sit on.

`stops` is jsonb rather than a child table because a saved day is a **value** —
copied in whole at save time, copied out whole at insert time, never queried
into. `source_trip_name` is a snapshot at save time, on exactly the terms
ADR-028 sets for lineage: the credit has to survive the source being renamed,
deleted, or becoming unreadable.

Authorization is not decided in the module. Saving *reads* a trip, so the route
requires `viewer` — matching ADR-028's argument for cloning: copying what you
can already read takes nothing from the source. Inserting *writes* one, so the
route requires `editor`, and the insert itself goes through
`executeTripCommandBatch`, meaning `AccessPolicy` decides even if a route ever
forgets to.

## Decision 2 — a fragment carries no dates and no ids

**No date.** A day's calendar date is derived from the trip's start
(`deriveDayDates`), so it is a property of the trip the day sat in, not of the
day. Carrying it would make a saved day only reusable in June. What *is* kept
is order, time windows and therefore gaps — which is what "the times reflow to
fit" means.

**No activity ids.** An id would tie the fragment to the activity it was copied
from, and inserting the same saved day into two trips would then put one id in
two streams — the KI-1 hazard, and the same reason `cloneTrip` remaps
(ADR-028). Fresh ids are minted per insert, so a saved day can go into two
trips, or twice into one.

The insert is **one batch**, so it is one history entry and one undo. Half an
inserted day is not a state anyone should be able to land in.

`stopsForDay` — the function that decides all of this — lives in `src/lib`, not
in `src/server`, because both sides need it: the server builds the row, and the
Keep-this-day dialog tells the user what it is about to save. Two copies of
"what's included" would be two chances to disagree, in the one place a person
is being asked to trust a summary.

## Decision 3 — saved days are private, and the shell's Visibility field is gone

The `keep-day-dialog` shell offered **Only me / Trip collaborators / Anyone with
the link**. Two of those three are surfaces this milestone does not build:
"anyone with the link" is a second public-read path with its own token,
revocation and abuse story, and "trip collaborators" needs a fragment scoped to
a trip it deliberately is not scoped to. Behind both sits M12 Community —
discovery, and everything that quarantines — which is explicitly out of M11's
scope.

So a saved day is private to the person who saved it, full stop, and the dialog
says so in one line instead of offering a select with one real option.

**This is the decision most likely to be worth overturning**, and the shape of
the reversal is already known: it is another bearer token on another table,
exactly like ADR-027's share links. It is deferred, not designed away.

## Decision 4 — "What's included" is a summary, not a field

The shell rendered it as a text `Input` placeholdered *"Stops, order, gaps and
notes — no dates"* — which is a **statement about what gets saved**, dressed as
a question. It is now a read-only line computed from the actual day
("2 stops, 9 am–2:30 pm. Order and gaps kept, no dates."). A field that looked
editable and changed nothing would be the same species of dishonesty the
`<Preview>` seam exists to avoid.

The prototype's `celebrate()` choreography — spring animation, ring burst,
sparks, the "Kept" pill — is **not built**. A toast says what was kept. The save
is real; the confetti is not.

## Consequences

- `preview-registry.test.ts`'s `PARKED` escape hatch is now **empty**.
  `add-saved-day` was its only occupant, parked since M10 Wave 2 moved the
  action out of the trip header (KI-31); it comes back where the design put it,
  in the plan flow at the end of the trip, mounted by `EndOfTrip` *outside* the
  still-shelled `<Preview id="insert-playbook">` that carries the Playbook
  shortcuts. The hatch's tests are kept, working, on an empty list — the next
  milestone to park a shell gets the guard already running.
- `TripProvider` now exposes `tripId`. Several controls need it to talk to an
  endpoint rather than to read state, and `trip` is null while loading.
- `AddSavedDayButton` is not rendered at all for a viewer. The server refuses
  the insert either way; a button that always fails is worse than no button.
- The pennant is **disabled** on an empty day rather than hidden: a row that
  loses a control as its last stop is removed is worse than one whose control
  greys out, and the `title` says why.
- **Playbooks remain unbuilt.** `home-playbooks-strip`, `playbooks-route`,
  `insert-playbook`, `wizard-playbook-panel` are M11's own separate scope and
  are still shells. A saved day is the private, personal ancestor of a
  Playbook, not a Playbook — no publishing, no browsing, no sharing.
