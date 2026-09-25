# ADR-054: Three activity kinds — planned, pending, transit — with the retired five read on the way in

**Status:** **Accepted — 2026-09-25, Mitchell's decision, in chat.**
**Deciders:** Mitchell (product/eng); Claude — drafted
Related: **ADR-003** (the event log owns planning), **ADR-038** (a page document is a
versioned AST, migrated on read), **ADR-039** (widget presets are never stored),
**ADR-048** (a saved day's stored shape changes by a migration on read), invariants 1, 2
and 5. Milestone: `docs/milestones/M28-three-kinds.md`.

## Context

M18 gave every stop one `ActivityKind` from five: `planned` (the default), `idea`,
`hold`, `booked` and `transit`. Mitchell, 2026-09-25: *"I think we can simplify the types
a bit. Planned = Default, Pending = Combo Idea / Hold, Transit = Travel. The rest feel too
small to be worth complicating ui"* — and, asked about the one kind that list left out,
*drop Booked too*.

The difficulty is not the enum. It is that the old values are written down in places this
app must keep reading for ever:

- **Event payloads.** `ActivityAddedV1` and `ActivityUpdatedV1` carry the kind, the log is
  the source of truth (invariant 1), and every projection is rebuilt from it (invariant 2).
- **`trip_details.doc`** and **`saved_days.stops`**, jsonb parsed on every read.
- **Content bundles** — the repo's own files and any export somebody has downloaded.
- **Notebook pages**, whose widgets can be filtered to a kind (`stop.rows{kind: "booked"}`).

Asked whether old values should keep working, Mitchell: *"Idea and hold just aren't
supported anymore, simplify."* Read against the invariants that means: nothing offers,
writes or names them again, and nothing that was stored stops loading.

## Decision

1. **`ActivityKind` is `planned | pending | transit`.** It is the write vocabulary:
   commands (`AddActivity`, `UpdateActivity`), the editor, the assistant, the public API.
   A command carrying a retired kind is refused — a command is never stored, so a caller
   still sending one has not moved, and a 400 tells it.
2. **Retired kinds translate on read:** `idea → pending`, `hold → pending`,
   `booked → planned` (`RETIRED_ACTIVITY_KINDS`). `StoredActivityKind` is
   `z.preprocess(readActivityKind, ActivityKind)` and sits exactly where a stored shape is
   parsed: `ActivitySnapshot` (so both event payloads and replay), `ActivityView`,
   `SavedStop` and the bundle `BundleStop`. Nothing past the parse ever sees a retired
   kind. No event is rewritten and no row is migrated: the translation is the migration,
   the same "migration on read" ADR-048 names for `saved_days`.
3. **A stored page's kind filter translates too**, through the page-document chain
   (ADR-038): a v3 → v4 step rewrites `params.kind` on every widget. `KindRef` stays
   strict, like a command.
4. **`needsBooking` is `kind === "pending"`.** The `planned` + `ticketed` exception goes:
   it existed because `booked` was where a ticketed stop went once settled, and with
   `booked` gone it would flag every ticketed stop for ever. A ticketed stop that still
   needs a ticket is `pending`.
5. **`trip.bookedCount` is removed** from the trip globals, through a `FIELD_CHANGES`
   removal (document v5), so a page that printed it reads a placeholder rather than
   refusing to load.
6. **The UI.** Badges: `Pending` in `hold`'s amber, `Travel` in blue; `planned` stays
   unbadged. The kind picker offers the three. A new stop starts `pending` in the editor
   and when the assistant creates one without stating a kind (the 2026-08-29 default,
   which was `hold`); a command with no kind still means `planned`.
7. **Presets and templates** built on `booked` are reworked: "How many are booked" is
   "How many are still to book" (`count.pending`); "A line for every booking" and "The
   days, bookings only" are gone; the seeded Overview's "What's booked" is "Still to book".
   Presets are never stored (ADR-039), so none of this migrates anything. The retired name
   `booking.line` now finds "Still to book" in the picker.

## Rejected

- **Keeping `booked` as a fourth kind.** Offered, and declined: the UI cost of a kind is a
  badge, a picker option and a rule, and Mitchell judged the difference too small.
- **Making `booked` a tag.** A tag is what a stop IS (meal, lodging); whether it is settled
  is workflow, which is what `kind` is for. The M18 argument against two fields that can
  disagree applies: `booked` tag on a `pending` stop would say two things at once.
- **Rejecting retired kinds everywhere** — the literal reading of "not supported". Every
  trip older than today holds them in its log; refusing them would 500 the board for every
  such trip and make projections unrebuildable, which invariants 1 and 2 forbid.
- **Rewriting the event log.** Events are facts already decided and append-only; the
  translation on read gets the same result without touching history.
- **Translating `booked → pending`.** A booked stop is settled, and `pending` means the
  opposite; it would have put every confirmed hotel on the "still to book" list.
- **Leaving `KindRef` tolerant instead of a page migration.** The page chain exists for
  exactly this, and a migrated document is then honest about what it says; a tolerant
  schema would keep "booked" in stored pages indefinitely.

## Consequences

- The kind vocabulary is three for every writer, and five for every reader of stored data.
  `RETIRED_ACTIVITY_KINDS` is append-only in spirit: removing an entry would make old
  events unparseable.
- `RETIRED_ACTIVITY_KINDS`, `readActivityKind` and `StoredActivityKind` are exported from
  `@tc/contracts`, so a reader of external data in the old vocabulary (the design export's
  `status`, `upstreamDrift.test.ts`) uses the same translation rather than a copy.
- The OpenAPI document lists the three kinds everywhere, including where a stored shape
  would still read an old one: the published contract is the write vocabulary.
- `unwrapSchema` sees through a `z.preprocess` (only preprocess), so the attribute manifest
  still publishes `stop.kind` with its values.
- The Japan fixture now counts 55 planned, 8 pending and 9 transit stops.
