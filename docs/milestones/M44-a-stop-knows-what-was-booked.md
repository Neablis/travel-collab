# M44 — A stop knows what was booked, and what it sits inside

**Status:** **Scoped 2026-11-02 by Mitchell; current.** All four decisions answered as
recommended, plus a fifth (where the booked list lives), below. Mechanisms in ADR-086; the plan is
`docs/plans/2026-11-02-M44-booking-and-containment.md` (deleted at gate close). Part 0 is
`claude/next-milestone-5o3kip`.

*2026-10-22:* `booking` was moved to M52 for flight details, then **handed back on 2026-10-23**
(M52 decision 5, as amended: M52 built only `flightNumber`). M44 owns `booking` and containment.

## Why this exists

Two entries ask the activity contract to say something it cannot say today. Both are changes to
`packages/domain` and to event payloads that are replayed forever (invariants 1 and 2). Doing them
in one milestone means one contracts review, one public API minor version and one migration
window.

- **Booking details.** An external API consumer keeps confirmation numbers in `notes`. Mitchell
  chose, on 2026-09-30, not to adopt a notes convention, because parsing free text is fragile and
  gives API callers nothing typed. The shape if it comes: `booking: { confirmation?, provider?,
  url? }`.
- **Containment.** A lunch inside a day-long museum visit raises `time-overlap`, and every day of
  the Rochester run did (2026-08-02). *"three warns on a three-day trip is the AI teaching users to
  ignore the conflict UI"*.

Candidates absorbed (each deleted by this gate):
- *Structured booking fields on a stop: confirmation number, provider, link* (2026-09-30)
- *Contained activities: a meal inside a day-long activity is not a conflict* (2026-08-02)

## Decisions (answered 2026-11-02 by Mitchell, each as recommended)

1. **`booking` is an optional object on any stop**: `booking: { confirmation?, provider?, url? }`,
   set and cleared through the existing `UpdateActivity` command (clearing all three clears it,
   stored as `null`). Additive: old events carry no `booking` and replay as `null`; no migration
   (activities live in event payloads and the `trip_details` projection). The public API takes a
   minor version. **Interaction:** the stop editor has a collapsed *Booking* section with
   Confirmation, Provider and Link fields; the river card shows a *Booked · Provider* chip, and an
   editor's tap on it copies the code or opens the link.
2. **A confirmation code and link are for editors and owners.** Viewers and suggesters see that a
   stop is booked and its provider, not the code or link. The code is stripped from share links
   (`/s/**`), saved and published playbook days, and trip export unless the caller is at least an
   editor. The assistant sees only *booked: yes/no* and the provider. This is the first field-level
   role rule on a trip read (ADR-086).
3. **Check-in and check-out times stay in the time window**, not in `booking`.
4. **Containment is rule (c)**: in `conflicts.ts`, `time-overlap` is suppressed when one window
   fully contains the other and the inner stop is at most 2 hours long or tagged `meal`. A partial
   overlap still warns. Nested activities stay out.
5. **The booked list is a new `stop.rows` filter, `only: "booked"`**, a *Booked* list under
   *Still to book* in the notebook templates that already carry it. Each row shows the provider,
   and the code for editors and owners. Existing notebooks pick it up through M43's template sync.
   (Scope named "the Money notebook's booked list", which never existed; Mitchell, 2026-11-02.)

## Scope

- `booking` across the contract, the domain, the editor, the card, the Money notebook's booked
  list, the public API and trip export (M25).
- The containment rule and its property test.

## Out of scope

- Parsing confirmation emails.
- Nested activities.

## Exit gate

- [ ] **Decisions 1–5 are answered and recorded here**, with the contracts changelog entry.
- [ ] **A trip replayed from a log written before the change equals its stored projection**, which
      a test shows, because old events carry no `booking`.
- [ ] **A confirmation number never reaches a share link or a published day**: an integration test
      reads both.
- [ ] **A short stop inside a long one raises no overlap**, and a partial overlap still does.
      Shown by a `fast-check` property, seen red with the rule removed.
- [ ] **The Rochester-shaped fixture produces no `time-overlap` warnings.**
- [ ] **The e2e spec passes on `pnpm --filter web test:e2e:ci-like`**: add a booking, see it on the
      card, open the share link, and see no code.
- [ ] A retro is appended at gate close.
