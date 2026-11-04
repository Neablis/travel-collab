# ADR-086: A stop's booking is for editors, and a short stop inside a long one is not a conflict

**Status:** **Accepted — 2026-11-02.** Mitchell answered M44's decisions D1–D5, each as
recommended.
**Deciders:** Mitchell (product); Claude — drafted
Related: M44 (`docs/milestones/M44-a-stop-knows-what-was-booked.md`), M52 decision 5 (the
`flightNumber` precedent), ADR-027 (share views are an opt-in allowlist), M25 (trip export), M43
(default notebooks).

## Context

An API consumer keeps confirmation numbers in `notes`, and a typed field was chosen over a notes
convention (2026-09-30). Every trip read today returns the whole `TripDetail` to any member: there
is no field-level role rule anywhere (`server/accessPolicy.ts` gates commands, not fields). Share
views (`server/access/sharedView.ts`) null actor ids and spread every other activity field, so a
new field reaches `/s/**` unless it is stripped. Trip export is readable by viewers.

Separately, `timeOverlapRule` (`packages/domain/src/trip/conflicts.ts`) warns on any two
overlapping windows, so lunch inside a day-long museum visit warns, every day (the Rochester run,
2026-08-02).

## Decision

1. **`booking: { confirmation?, provider?, url? } | null`** is an optional, defaulted field on
   the activity contract (`AddActivity`, `UpdateActivity`, `ActivitySnapshot` and the
   `ActivityAddedV1` / `ActivityUpdatedV1` payloads), following `flightNumber` (M52) end to end.
   An event written before the change has no `booking`, and it reads as `null`, so a replayed old
   log equals its stored projection. No migration.
2. **One redaction seam, `redactBookingFor(role)`**, applied wherever a trip leaves the server for
   someone below editor: the member trip read, the events poll, history replays, share views, saved
   and published playbook days, trip export, clone and the public API. Below editor, and on every
   share link and published day, `booking` becomes `{ provider }` (provider may be `null`, so a
   code-only booking still reads as booked) with `confirmation` and `url` dropped. The assistant's
   read tools get `booked` and `provider` only, whatever the asker's role. *(Amended 2026-11-02 at
   part 3's review: the events poll and history replays were found leaking and are named here;
   shares and published days keep the provider.)*
3. **Containment is a rule, not structure.** `time-overlap` is not raised when one window fully
   contains the other and the inner stop is at most 120 minutes or tagged `meal`. A `fast-check`
   property pins both halves: contained-and-short never warns, partial overlap always does.
4. **The booked list is a `stop.rows` filter** (`only: "booked"`), beside `needsBooking`, added to
   the templates that carry *Still to book*. No back-fill (Mitchell, 2026-11-02): new trips get it from
   the template; an existing notebook gets it only through "Reset to default" or by hand.

## Consequences

- The first field-level role rule on a trip read. A future member-only field reuses the seam
  rather than adding a second one.
- The public API takes a minor version for the new field.
- Nested activities remain unbuilt; containment only silences a warning.
